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
  //
  //      Zero-file layer guard (Commit 9 / round-3 Codex finding #7): the
  //      architecture-analyzer's normalizer already drops empty layers via a
  //      post-filter (architecture-analyzer.ts L743-746), but a hand-edited
  //      architecture.json or a future LLM-phase regression could re-introduce
  //      one. Surface that as a fatal here rather than as silent corruption
  //      downstream — every emitted layer MUST anchor at least one file, or
  //      the graph reviewer pair will catch it as a representativeness defect
  //      anyway. Defensive duplication of the upstream invariant; cheap to
  //      enforce, surfaces drift immediately at the assembler boundary.
  const emptyLayers = layers.filter((l) => l.fileIds.length === 0);
  if (emptyLayers.length > 0) {
    throw new Error(
      `assembleKnowledgeGraph: ${emptyLayers.length} layer(s) have empty fileIds ` +
        `(${emptyLayers.map((l) => l.id).join(", ")}). Upstream architecture-analyzer ` +
        "must drop zero-file layers; surfacing as fatal so the regression is visible.",
    );
  }
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
  //
  //      Node-id shape (Commit 9 / round-3 Codex finding #5): the legacy form
  //      `<kind>:<path>:<name>` already differentiates a same-named function
  //      and class IN THE SAME FILE via the leading `<kind>:` segment, but it
  //      silently dropped same-kind same-name OVERLOADS (e.g. two functions
  //      both named `foo` in `src/util.ts` — TypeScript declaration merging,
  //      Python `@overload`, etc.) by `if (nodeIds.has(fnId)) continue`.
  //      That dropped a real symbol from the graph without telling anyone.
  //      We now derive `<kind>:<path>:<name>:<kind>` (the trailing kind tag
  //      makes the disambiguator explicit even if a downstream consumer
  //      parses only on the last `:` segment) and append `#<n>` for the
  //      second+ occurrence of the same kind+name in the file, so every
  //      symbol the file-analyzer surfaced lands as its own node.
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

    // Per-file occurrence counter for overload disambiguation. Keyed by the
    // (kind, name) pair so a same-named function and class don't share a
    // slot — they wouldn't have collided anyway via the leading prefix, but
    // keying jointly makes the counter mirror the actual ID shape exactly.
    const occurrenceCount = new Map<string, number>();

    for (const fn of analysis.functions) {
      const fnId = buildSymbolNodeId(path, fn.name, "function", occurrenceCount, nodeIds);
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
      const clsId = buildSymbolNodeId(path, cls.name, "class", occurrenceCount, nodeIds);
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
      faceOffVerdicts: { assemble: [], graph: [] },
    },
  };
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Build a stable, collision-resistant node id for a function / class symbol.
 *
 * Shape: `<kind>:<escapedPath>:<escapedName>:<kind>` for the first occurrence,
 * then `<kind>:<escapedPath>:<escapedName>:<kind>#<n>` (n ≥ 2) for subsequent
 * same-kind same-name occurrences in the same file (overload disambiguation
 * per finding #5).
 *
 * The kind appears at BOTH ends of the id deliberately:
 *   - Leading `<kind>:` matches upstream Understand-Anything's ID convention
 *     and keeps the dashboard's prefix-based filtering working without
 *     touching downstream consumers.
 *   - Trailing `:<kind>` makes the disambiguator explicit even if a consumer
 *     parses only the LAST `:` segment, which a few of upstream's analyzer
 *     scripts do (cross-checked against the cached upstream 2.7.5 plugin).
 *
 * The `#<n>` suffix is only appended when the deterministic base would
 * collide — most ids in any given codebase have no suffix at all.
 *
 * Field safety (Commit 9 / round-2 Codex findings #1 + #10, refined in
 * round-3 Probes #1 + #7): a `:` in `path` or `name` would collapse field
 * boundaries and let two distinct symbols generate the same baseId fragment;
 * the cross-file `nodeIds.has` guard below would then treat them as
 * overloads of each other and emit unstable `#n` ids. Round-2 enforced this
 * via a fatal throw on any colon, but POSIX paths can legitimately contain
 * `:` (a file literally named `src/foo:bar.ts` is valid on Linux/macOS) and
 * the upstream Ruby extractor emits class names like `Foo::Bar`. Round-3
 * switches to percent-encoding: any `%` becomes `%25`, then any `:` becomes
 * `%3A`. The order matters (encode `%` first to avoid double-encoding the
 * substitution sequence). The encoded baseId is field-safe — distinct
 * (path, name) tuples produce distinct baseIds because the encoding is
 * injective — and round-tripping is trivial (URI percent-decoding) for any
 * downstream consumer that needs the original strings.
 */
function buildSymbolNodeId(
  path: string,
  name: string,
  kind: "function" | "class",
  occurrenceCount: Map<string, number>,
  nodeIds: ReadonlySet<string>,
): string {
  const safePath = escapeIdField(path);
  const safeName = escapeIdField(name);
  const key = `${kind}:${safeName}`;
  const baseId = `${kind}:${safePath}:${safeName}:${kind}`;
  const prior = occurrenceCount.get(key) ?? 0;
  occurrenceCount.set(key, prior + 1);
  if (prior === 0) {
    // First occurrence of (kind, name) in this file. With injective field
    // encoding, baseId is collision-free across (path, name) tuples — no
    // cross-file collision can exist that wasn't itself a duplicate-id
    // contract violation. If nodeIds already contains baseId, surface as a
    // fatal invariant violation rather than silently re-labelling as an
    // overload (which would mislead downstream consumers indexing by `#n`).
    if (nodeIds.has(baseId)) {
      throw new Error(
        `buildSymbolNodeId: cross-file id collision on "${baseId}". This should be impossible ` +
          "under the field-safe id contract — surface as fatal so the assembler invariant is " +
          "visible at the call site.",
      );
    }
    return baseId;
  }
  // Subsequent same-(kind, name) occurrence in the SAME file (TypeScript
  // declaration merging, Python `@overload`, etc.). Walk the in-file counter
  // forward to the first unused suffix. The nodeIds set is also checked as
  // defense-in-depth in case the same file is somehow re-entered, but with
  // the field-safe baseId + per-file counter it should be redundant.
  let next = prior + 1;
  while (nodeIds.has(`${baseId}#${next}`)) next += 1;
  return `${baseId}#${next}`;
}

/** Percent-encode the two characters that would otherwise collide field
 *  boundaries in `<kind>:<path>:<name>:<kind>` symbol ids. `%` MUST be
 *  encoded first; otherwise the `:` → `%3A` substitution introduces new
 *  `%` characters that would themselves need encoding. The encoding is
 *  injective on the input alphabet (every distinct input string produces
 *  a distinct output) and trivially reversible via URI percent-decoding,
 *  so downstream consumers that need the original strings can recover them.
 */
function escapeIdField(s: string): string {
  return s.replaceAll("%", "%25").replaceAll(":", "%3A");
}
