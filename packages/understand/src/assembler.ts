// @mirepoix/understand — deterministic assembler.
//
// Pure-function merge of every prior phase's output into the unified
// `KnowledgeGraph` shape upstream's React dashboard renders. No LLM call —
// the LLM contributions (project narrative, per-file summary/complexity,
// architectural layers, business domains) have already been produced and
// normalized by Commits 4-7. The assembler only stitches them together,
// derives the function/class nodes upstream's schema requires, emits the
// structural edges (imports, contains) the dashboard expects, and
// normalizes the layer/domain `fileIds` from raw project-relative paths
// (the internal pipeline convention from Commits 6-7) to `file:<path>`
// node-id form (upstream's dashboard convention).
//
// What this is NOT:
//   - Not a re-implementation of upstream's `merge-batch-graphs.py`. That
//     script merges raw per-batch LLM JSON; in our pipeline the file-analyzer
//     phase already does the per-batch merge (Commit 5's mergeBatchAnalyses).
//     We start from already-merged FileAnalysis records.
//   - Not the assemble-reviewer LLM phase. The assemble-reviewer in upstream
//     reviews what merge-batch-graphs.py produced; in our pipeline that
//     reviewer is folded into the in-product face-off review applied to the
//     fully assembled graph (see llm/face-off-reviewer.ts).
//   - Not the tour-builder. Tour generation is deferred to Commit 9. v0 emits
//     an empty `tour: []`.
//
// Contract invariants (validated before emit; thrown on violation):
//   - Every file path in any `layer.fileIds` resolves to an emitted file node.
//   - Every file in `scan.files` appears in EXACTLY ONE `layer.fileIds`
//     (coverage + uniqueness). Catches an upstream-normalizer regression
//     where the catch-all sweep into `layer:shared` stopped working.
//   - Every layer in `layers` appears in EXACTLY ONE `domain.layerIds`
//     (coverage + uniqueness). Same shape for the domain catch-all.
//   - Every emitted `domain.fileIds` equals the union of its member layers'
//     fileIds — domain file membership is derived, never independent. The
//     domain-analyzer computes this deterministically; the assembler
//     recomputes and asserts so a hand-edited domains.json can't ship
//     contradicting data.
//   - Every edge endpoint references a node in the emitted node set.
//
// Upstream architecture-analyzer and domain-analyzer already enforce the
// layer/domain uniqueness invariants via their normalizers. The assembler
// asserts them defensively so a future contract drift in an upstream phase
// surfaces here as a fatal error rather than as silent graph corruption.

import type { DeterministicScanResult } from "./orchestrator";
import type { FileAnalysis } from "./llm/file-analyzer";
import type { ProjectNarrative } from "./llm/project-scanner";
import type {
  ArchitecturalLayer,
  BusinessDomain,
  GraphEdge,
  GraphNode,
  KnowledgeGraph,
} from "./types";

/** Schema version of the emitted graph. Tracks upstream's expected dashboard
 *  contract; bump when a downstream consumer requires a new field. */
const SCHEMA_VERSION = "1.0.0";

/** Generator version stamped into `meta.generatorVersion`. Matches the
 *  v0.2.0-α-3a track this commit belongs to. */
const GENERATOR_VERSION = "@mirepoix/understand@0.2.0-alpha-3a";

export interface AssembleKnowledgeGraphInput {
  projectRoot: string;
  deterministicScan: DeterministicScanResult;
  narrative: ProjectNarrative;
  fileAnalyses: Record<string, FileAnalysis>;
  layers: ArchitecturalLayer[];
  domains: BusinessDomain[];
}

/**
 * Merge all prior-phase outputs into the unified KnowledgeGraph shape.
 *
 * Deterministic — given the same inputs, the same graph comes out. No I/O,
 * no randomness; the one wall-clock read is `meta.generatedAt` (caller can
 * override via `nowIso` for reproducibility).
 *
 * Input convention (Commits 6-7): `ArchitecturalLayer.fileIds` and
 * `BusinessDomain.fileIds` are RAW project-relative paths (e.g.
 * `.github/workflows/ci.yml`). The assembler normalizes them to the upstream-
 * dashboard convention (`file:<path>`) when emitting the final graph, while
 * preserving the internal contract that every raw path resolves to a file
 * node we just emitted.
 *
 * @throws Error if any contract invariant is violated. Callers should let
 *   these propagate — an invariant violation here means an upstream phase's
 *   normalizer regressed and the operator needs to see it.
 */
export function assembleKnowledgeGraph(
  input: AssembleKnowledgeGraphInput,
  nowIso: string = new Date().toISOString(),
): KnowledgeGraph {
  const { projectRoot, deterministicScan, narrative, fileAnalyses, layers, domains } = input;

  // ── 1. Emit file nodes (one per scan.files entry). Build the path →
  //      node-id map both for edge construction and for translating the
  //      layer/domain raw-path fileIds into upstream-compatible node ids
  //      in the final output.
  const nodes: GraphNode[] = [];
  const nodeIds = new Set<string>();
  const filePathToNodeId = new Map<string, string>();

  for (const f of deterministicScan.scan.files) {
    const nodeId = `file:${f.path}`;
    if (nodeIds.has(nodeId)) {
      throw new Error(
        `assembleKnowledgeGraph: duplicate file node id "${nodeId}". ` +
          "scan-project.mjs returned duplicate paths.",
      );
    }
    nodeIds.add(nodeId);
    filePathToNodeId.set(f.path, nodeId);
    nodes.push({
      id: nodeId,
      type: "file",
      name: basename(f.path),
      path: f.path,
      language: f.language,
      summary: fileAnalyses[f.path]?.summary ?? "",
      complexity: fileAnalyses[f.path]?.complexity ?? "moderate",
      // Layer assignment is set below after the layer membership map is
      // built; default unset.
    });
  }

  // ── 2. Build the layer-membership lookup (raw path → layer id). Fail loud
  //      on duplicate (one path in two layers) — the upstream architecture-
  //      analyzer's normalizer enforces uniqueness, so a duplicate here
  //      means that contract regressed.
  const pathToLayerId = new Map<string, string>();
  for (const layer of layers) {
    for (const fileId of layer.fileIds) {
      if (pathToLayerId.has(fileId)) {
        throw new Error(
          `assembleKnowledgeGraph: path "${fileId}" appears in multiple layers ` +
            `("${pathToLayerId.get(fileId)}" and "${layer.id}"). Upstream layer ` +
            "normalizer contract violation.",
        );
      }
      if (!filePathToNodeId.has(fileId)) {
        throw new Error(
          `assembleKnowledgeGraph: layer "${layer.id}" references file path ` +
            `"${fileId}" which is not in the scanned file set.`,
        );
      }
      pathToLayerId.set(fileId, layer.id);
    }
  }

  // Backfill `node.layer` for every file node now that the map is built.
  // Enforce the coverage half of the file-in-exactly-one-layer invariant:
  // every scanned file MUST have a layer assignment. The architecture-
  // analyzer's normalizer sweeps unassigned files into `layer:shared` as a
  // catch-all, so this should hold. If it doesn't, the upstream normalizer
  // regressed and we surface that as a fatal here rather than as silent
  // "file nodes with no layer" in the emitted graph.
  const unassignedFilePaths: string[] = [];
  for (const node of nodes) {
    if (node.type !== "file") continue;
    const layerId = pathToLayerId.get(node.path);
    if (layerId) {
      node.layer = layerId;
    } else {
      unassignedFilePaths.push(node.path);
    }
  }
  if (unassignedFilePaths.length > 0) {
    const preview = unassignedFilePaths.slice(0, 5).join(", ");
    const more =
      unassignedFilePaths.length > 5 ? `, … (+${unassignedFilePaths.length - 5} more)` : "";
    throw new Error(
      `assembleKnowledgeGraph: ${unassignedFilePaths.length} file(s) not assigned to ` +
        `any layer (${preview}${more}). Upstream architecture-analyzer's ` +
        "catch-all sweep into layer:shared regressed.",
    );
  }

  // ── 3. Build the domain → layer lookup. Every layer MUST be in exactly
  //      one domain's layerIds. Surface drift on uniqueness (a layer in
  //      two domains) AND on coverage (a layer in no domain — the domain-
  //      analyzer's catch-all sweep into `domain:shared` regressed).
  const layerIdSet = new Set(layers.map((l) => l.id));
  const layerToDomainId = new Map<string, string>();
  for (const domain of domains) {
    for (const layerId of domain.layerIds) {
      if (!layerIdSet.has(layerId)) {
        throw new Error(
          `assembleKnowledgeGraph: domain "${domain.id}" references unknown ` +
            `layer "${layerId}". Upstream domain normalizer contract violation.`,
        );
      }
      if (layerToDomainId.has(layerId)) {
        throw new Error(
          `assembleKnowledgeGraph: layer "${layerId}" appears in multiple domains ` +
            `("${layerToDomainId.get(layerId)}" and "${domain.id}"). Upstream ` +
            "domain normalizer contract violation.",
        );
      }
      layerToDomainId.set(layerId, domain.id);
    }
  }
  const unassignedLayerIds: string[] = [];
  for (const layer of layers) {
    if (!layerToDomainId.has(layer.id)) {
      unassignedLayerIds.push(layer.id);
    }
  }
  if (unassignedLayerIds.length > 0) {
    throw new Error(
      `assembleKnowledgeGraph: ${unassignedLayerIds.length} layer(s) not assigned ` +
        `to any domain (${unassignedLayerIds.join(", ")}). Upstream ` +
        "domain-analyzer's catch-all sweep into domain:shared regressed.",
    );
  }

  // ── 4. Emit function + class derived nodes from per-file analyses. Only
  //      when we have a FileAnalysis for the parent file — without the
  //      analysis the file-analyzer hasn't surfaced the structural members
  //      in a shape we can pin to.
  const containsEdges: GraphEdge[] = [];
  for (const [path, analysis] of Object.entries(fileAnalyses)) {
    const fileNodeId = filePathToNodeId.get(path);
    if (!fileNodeId) {
      // FileAnalysis for a path that scan.files doesn't know about. Should
      // not happen given Commit 5's mergeBatchAnalyses keys by batch.files,
      // but if it does, skip — adding orphan parents would corrupt edges.
      continue;
    }
    const layerId = pathToLayerId.get(path);

    for (const fn of analysis.functions) {
      const fnId = `function:${path}:${fn.name}`;
      if (nodeIds.has(fnId)) continue;
      nodes.push({
        id: fnId,
        type: "function",
        name: fn.name,
        path,
        language: analysis.language,
        summary: "",
        complexity: analysis.complexity,
        layer: layerId,
      });
      nodeIds.add(fnId);
      containsEdges.push({ from: fileNodeId, to: fnId, type: "contains" });
    }

    for (const cls of analysis.classes) {
      const clsId = `class:${path}:${cls.name}`;
      if (nodeIds.has(clsId)) continue;
      nodes.push({
        id: clsId,
        type: "class",
        name: cls.name,
        path,
        language: analysis.language,
        summary: "",
        complexity: analysis.complexity,
        layer: layerId,
      });
      nodeIds.add(clsId);
      containsEdges.push({ from: fileNodeId, to: clsId, type: "contains" });
    }
  }

  // ── 5. Emit imports edges from the deterministic import map.
  //      importMap[srcPath] = list of internal target paths (already
  //      resolved by extract-import-map.mjs; non-internal imports filtered
  //      upstream).
  const importsEdges: GraphEdge[] = [];
  for (const [srcPath, targets] of Object.entries(
    deterministicScan.importMap.importMap as Record<string, readonly string[]>,
  )) {
    const srcNodeId = filePathToNodeId.get(srcPath);
    if (!srcNodeId) continue;
    if (!Array.isArray(targets)) continue;
    for (const tgtPath of targets) {
      if (typeof tgtPath !== "string" || !tgtPath) continue;
      const tgtNodeId = filePathToNodeId.get(tgtPath);
      if (!tgtNodeId) continue;
      if (srcNodeId === tgtNodeId) continue;
      importsEdges.push({ from: srcNodeId, to: tgtNodeId, type: "imports" });
    }
  }

  const edges = [...importsEdges, ...containsEdges];

  // ── 6. Final cross-edge sanity check. Both edge sets reference only
  //      nodes we emitted; we built them from the same node-id maps. A
  //      failure here means the construction above has a bug, not data
  //      drift — fail loud.
  for (const e of edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) {
      throw new Error(
        `assembleKnowledgeGraph: edge ${e.from} → ${e.to} (${e.type}) references ` +
          "missing node — assembler invariant violation.",
      );
    }
  }

  // ── 7. Normalize layer + domain fileIds to file-prefixed node ids for the
  //      emitted graph. Internal pipeline convention is raw paths; upstream
  //      dashboard convention is `file:<path>`. We checked above that every
  //      raw path in layer.fileIds resolves; assert once more after the
  //      translation for defense.
  const normalizedLayers: ArchitecturalLayer[] = layers.map((layer) => ({
    ...layer,
    fileIds: layer.fileIds.map((p) => {
      const nid = filePathToNodeId.get(p);
      if (!nid) {
        throw new Error(
          `assembleKnowledgeGraph: layer "${layer.id}" fileIds path "${p}" lost ` +
            "during node-id translation — assembler invariant violation.",
        );
      }
      return nid;
    }),
  }));

  // Index layers by id for the domain-fileIds recomputation below.
  const layerById = new Map<string, ArchitecturalLayer>();
  for (const layer of layers) layerById.set(layer.id, layer);

  const normalizedDomains: BusinessDomain[] = domains.map((domain) => {
    // Recompute fileIds as the union of member layers' fileIds, in stable
    // member-layer order. The domain-analyzer computes this deterministically
    // upstream; we recompute here so a hand-edited domains.json carrying a
    // contradicting fileIds list can't ship as the authoritative answer.
    const computed: string[] = [];
    const seenPath = new Set<string>();
    for (const layerId of domain.layerIds) {
      const layer = layerById.get(layerId);
      if (!layer) continue; // already asserted above; defensive
      for (const path of layer.fileIds) {
        if (seenPath.has(path)) continue;
        seenPath.add(path);
        computed.push(path);
      }
    }
    // Verify the input fileIds set equals the recomputed union — by
    // cardinality AND by membership. The count check alone passes when the
    // input has the right count but disjoint members (e.g. computed=[a,b],
    // input=[x,y]); the membership check above closes that hole. Originated
    // as Codex round-2 finding: the prior cardinality-only assertion let
    // same-count contradictions through, weakening the "fail loud on hand-
    // edited domains.json" contract.
    const expectedSet = new Set(computed);
    const inputSet = new Set(domain.fileIds);
    if (expectedSet.size !== inputSet.size) {
      throw new Error(
        `assembleKnowledgeGraph: domain "${domain.id}" fileIds count (${inputSet.size}) ` +
          `disagrees with the union of its member layers (${expectedSet.size}). ` +
          "domain.fileIds must equal the deterministic union of `domain.layerIds[*].fileIds`.",
      );
    }
    for (const path of inputSet) {
      if (!expectedSet.has(path)) {
        throw new Error(
          `assembleKnowledgeGraph: domain "${domain.id}" fileIds contains path "${path}" ` +
            "that is NOT in the union of its member layers. domain.fileIds must equal " +
            "the deterministic union of `domain.layerIds[*].fileIds`.",
        );
      }
    }
    return {
      ...domain,
      fileIds: computed.map((p) => {
        const nid = filePathToNodeId.get(p);
        if (!nid) {
          throw new Error(
            `assembleKnowledgeGraph: domain "${domain.id}" derived path "${p}" ` +
              "has no file node — assembler invariant violation.",
          );
        }
        return nid;
      }),
    };
  });

  // ── 8. Project metadata.
  const project = {
    name: narrative.name,
    description: narrative.description,
    rootPath: projectRoot,
    languages: narrative.languages,
    frameworks: narrative.frameworks,
    fileCount: deterministicScan.scan.files.length,
  };

  return {
    project,
    nodes,
    edges,
    layers: normalizedLayers,
    domains: normalizedDomains,
    tour: [],
    meta: {
      generatedAt: nowIso,
      generatorVersion: GENERATOR_VERSION,
      schemaVersion: SCHEMA_VERSION,
      faceOffVerdicts: [],
    },
  };
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}
