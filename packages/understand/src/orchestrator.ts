// @mirepoix/understand — orchestrator.
//
// Three compositions live here, each building on the previous:
//
//   deterministicScan(projectRoot) — four LLM-free phases of upstream
//   Understand-Anything (scan → import-map → write minimal scan-result.json
//   → compute-batches via Louvain).
//
//   scanWithNarrative(projectRoot, providerConfig) — deterministicScan +
//   the first LLM phase (runProjectScanner via @mirepoix/acp). Merges the
//   narrative (name, description, frameworks, languages) into scan-result.json.
//
//   scanWithFileAnalyses(projectRoot, providerConfig, options?) —
//   scanWithNarrative + the first MULTI-SESSION LLM phase (file-analyzer
//   fan-out via @mirepoix/acp, one session per batch, bounded concurrency).
//   Writes file-analyses.json with one record per analyzed file (combining
//   deterministic structural data + LLM summary/complexity).
//
//   scanWithArchitecture(projectRoot, providerConfig, options?) —
//   scanWithFileAnalyses + the first SYNTHESIS-pass LLM phase (single
//   architecture-analyzer session). Writes architecture.json with the
//   normalized ArchitecturalLayer[] — every code file is in exactly one
//   layer's fileIds.
//
//   scanWithDomains(projectRoot, providerConfig, options?) —
//   scanWithArchitecture + the second SYNTHESIS-pass LLM phase (single
//   domain-analyzer session). Writes domains.json with the normalized
//   BusinessDomain[] — every architectural layer is in exactly one
//   domain's layerIds, and each domain's fileIds is the union of its
//   member layers' fileIds.
//
//   scanWithAssembler(projectRoot, providerConfig, options?) —
//   scanWithDomains + the deterministic assembler + the in-product face-off
//   review (two parallel @mirepoix/acp reviewer sessions). Writes the
//   unified knowledge-graph.json with the face-off verdicts embedded in
//   `meta.faceOffVerdicts[]`. This is the architectural climax of α-3a:
//   multi-reviewer validation goes from "applied to our dev workflow" to
//   "baked into the product itself" per ADR-013.
//
//   scanWithGraph(projectRoot, providerConfig, options?) —
//   scanWithAssembler + the tour-builder LLM phase + the second in-product
//   face-off review (graph-reviewer pair, against the graph-with-tour).
//   Rewrites knowledge-graph.json in place at the same path the assembler
//   wrote, now carrying the populated tour + the `meta.faceOffVerdicts.graph`
//   audit trail. This is the last LLM phase before Commit 10's runUnderstand()
//   composition.
//
// Commit 10 will wire runUnderstand() as a thin composition over scanWithGraph.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assembleKnowledgeGraph } from "./assembler";
import {
  type ArchitectureAnalyzerResult,
  type RunArchitectureAnalyzerOptions,
  runArchitectureAnalyzer,
} from "./llm/architecture-analyzer";
import {
  type DomainAnalyzerResult,
  type RunDomainAnalyzerOptions,
  runDomainAnalyzer,
} from "./llm/domain-analyzer";
import { type RunFaceOffReviewOptions, runFaceOffReview } from "./llm/face-off-reviewer";
import {
  type BatchAnalysisResult,
  type FileAnalysis,
  type RunFileAnalyzerOptions,
  runFileAnalyzerOnBatch,
} from "./llm/file-analyzer";
import { runWithConcurrency, type SettledResult } from "./llm/concurrency";
import { type RunGraphReviewerOptions, runGraphReviewer } from "./llm/graph-reviewer";
import {
  type ProjectNarrative,
  type ProviderConfig,
  type RunProjectScannerOptions,
  runProjectScanner,
} from "./llm/project-scanner";
import { type RunTourBuilderOptions, type TourAnomalies, runTourBuilder } from "./llm/tour-builder";
import type { ArchitecturalLayer, BusinessDomain, KnowledgeGraph } from "./types";
import {
  type BatchesResult,
  type ImportMapResult,
  type ScanProjectResult,
  runComputeBatches,
  runExtractImportMap,
  runScanProject,
} from "./scripts";

/** Output of `deterministicScan` — combines typed results from all four phases
 *  with on-disk paths to the intermediate artifacts they wrote. */
export interface DeterministicScanResult {
  scan: ScanProjectResult;
  importMap: ImportMapResult;
  batches: BatchesResult;
  scanResultPath: string;
  batchesPath: string;
}

/**
 * Run the deterministic-only portion of /understand against a project root.
 *
 * Side effects (matches upstream's on-disk layout):
 *   - Creates `<projectRoot>/.understand-anything/intermediate/`
 *   - Writes `scan-result.json` (deterministic subset)
 *   - Writes `batches.json` (via compute-batches.mjs)
 *
 * Both files are gitignored on Mirepoix repos by the .gitignore committed
 * in 523b687 (`.understand-anything/`). They are the contract surface that
 * later LLM phases consume, so they must match upstream's expected shapes.
 */
export async function deterministicScan(projectRoot: string): Promise<DeterministicScanResult> {
  // Phase 1 — deterministic file inventory.
  const scan = await runScanProject(projectRoot);

  // Phase 2 — deterministic import resolution.
  const importMap = await runExtractImportMap(projectRoot, scan.files);

  // Phase 3 — write the minimal scan-result.json. We include the diagnostic
  // fields (totalFiles, filteredByIgnore, estimatedComplexity, stats) for
  // future readers / debugging, but compute-batches only needs files +
  // importMap.
  const intermediateDir = join(projectRoot, ".understand-anything", "intermediate");
  mkdirSync(intermediateDir, { recursive: true });
  const scanResultPath = join(intermediateDir, "scan-result.json");
  writeFileSync(
    scanResultPath,
    JSON.stringify(
      {
        scriptCompleted: true,
        files: scan.files,
        totalFiles: scan.totalFiles,
        filteredByIgnore: scan.filteredByIgnore,
        estimatedComplexity: scan.estimatedComplexity,
        stats: scan.stats,
        importMap: importMap.importMap,
        importStats: importMap.stats,
      },
      null,
      2,
    ),
  );

  // Phase 4 — Louvain batching over the import graph.
  const batches = await runComputeBatches(projectRoot);

  return {
    scan,
    importMap,
    batches,
    scanResultPath,
    batchesPath: join(intermediateDir, "batches.json"),
  };
}

/** Output of `scanWithNarrative` — deterministic results plus LLM narrative. */
export interface ScanWithNarrativeResult extends DeterministicScanResult {
  narrative: ProjectNarrative;
}

/**
 * Run the deterministic phase followed by the LLM project-scanner phase.
 *
 * Side effects:
 *   - Everything `deterministicScan` does, plus
 *   - Rewrites `<projectRoot>/.understand-anything/intermediate/scan-result.json`
 *     with the narrative fields merged in at the top level (`name`,
 *     `description`, `frameworks`, `languages`).
 *
 * The merged shape matches upstream's full Phase 1 output, so downstream
 * phases (Commit 5+ file-analyzer fan-out, architecture-analyzer, etc.) read
 * the same fields they would from a `claude /understand` run.
 *
 * @param projectRoot — absolute path to the repository under analysis.
 * @param providerConfig — local Ollama endpoint + model name. Required because
 *   ACP-server defaults assume `qwen2.5-coder:32b-instruct` and we ship with
 *   `qwen3-coder:30b` on kavara-builder.
 * @param scannerOptions — optional knobs (README char limit, acp entry path,
 *   timeout, stderr handler).
 */
export async function scanWithNarrative(
  projectRoot: string,
  providerConfig: ProviderConfig,
  scannerOptions: RunProjectScannerOptions = {},
): Promise<ScanWithNarrativeResult> {
  const deterministic = await deterministicScan(projectRoot);
  const narrative = await runProjectScanner(projectRoot, providerConfig, scannerOptions);

  // Read-merge-write the on-disk scan-result.json so the narrative fields
  // land alongside the deterministic ones. We read the file we just wrote
  // (vs. reconstructing in-memory) to be the single source of truth — any
  // future tweak to the deterministic-write step automatically carries
  // through to this merged file.
  const existing = JSON.parse(readFileSync(deterministic.scanResultPath, "utf8")) as Record<
    string,
    unknown
  >;
  const merged = {
    ...existing,
    name: narrative.name,
    description: narrative.description,
    frameworks: narrative.frameworks,
    languages: narrative.languages,
  };
  writeFileSync(deterministic.scanResultPath, JSON.stringify(merged, null, 2));

  return { ...deterministic, narrative };
}

/** Default file-analyzer fan-out concurrency. Empirically tuned for local
 *  qwen3-coder:30b on a single A100. Upstream's `claude /understand` uses 5
 *  concurrent subagents in Phase 2; 4 matches that order of magnitude while
 *  leaving headroom for the GPU's KV cache eviction patterns. */
const DEFAULT_FILE_ANALYZER_CONCURRENCY = 4;

export interface ScanWithFileAnalysesOptions {
  /** Max concurrent file-analyzer batches in flight. Default 4. Each batch
   *  is one @mirepoix/acp child process + one ACP session, so concurrency=N
   *  ⇒ N Bun processes + N concurrent Ollama requests at peak. */
  concurrency?: number;
  /** Per-batch knobs (source preview chars, acp entry path, timeout, stderr). */
  perBatch?: RunFileAnalyzerOptions;
  /** Per-narrative-call knobs (forwarded to scanWithNarrative). */
  scannerOptions?: RunProjectScannerOptions;
  /** Emit progress lines to this sink as each batch completes (default: stderr). */
  onProgress?: (line: string) => void;
}

/** Per-batch outcome with failures preserved. */
export interface BatchOutcome {
  batchIndex: number;
  ok: boolean;
  /** Present when ok=true. */
  result?: BatchAnalysisResult;
  /** Present when ok=false — the captured error message. */
  error?: string;
  /** Wall-clock for this batch's slot (includes the time spent waiting for
   *  a concurrency slot, then the actual work). Approximate. */
  elapsedMs?: number;
}

/** Output of `scanWithFileAnalyses` — everything from scanWithNarrative plus
 *  the fan-out results. */
export interface ScanWithFileAnalysesResult extends ScanWithNarrativeResult {
  /** Aggregated per-file analyses (merged across all successful batches), keyed by path. */
  fileAnalyses: Record<string, FileAnalysis>;
  /** Per-batch outcomes — useful for surfacing partial failures. */
  batchOutcomes: BatchOutcome[];
  /** Counts for the smoke CLI to render at a glance. */
  filesAnalyzed: number;
  filesTotal: number;
  batchesSucceeded: number;
  batchesFailed: number;
  /** Absolute path of the file-analyses.json written. */
  fileAnalysesPath: string;
}

/**
 * Run the full Phase 1 pipeline plus the parallel file-analyzer fan-out.
 *
 * Behavior:
 *   - Per-batch failures are isolated: one bad batch records its error and
 *     does NOT abort the others (matches the architectural decision; the
 *     handoff explicitly calls this out: "Per-batch failures are isolated,
 *     not fatal").
 *   - Concurrency is bounded by `options.concurrency` (default 4). Each
 *     batch spawns its own @mirepoix/acp subprocess with a sandboxed cwd.
 *   - Writes `<projectRoot>/.understand-anything/intermediate/file-analyses.json`
 *     with the merged per-file analyses (one record per successfully analyzed
 *     file). Gitignored upstream — safe to land on developer repos.
 *
 * The result includes counts so the smoke CLI can render `N/M files`.
 */
export async function scanWithFileAnalyses(
  projectRoot: string,
  providerConfig: ProviderConfig,
  options: ScanWithFileAnalysesOptions = {},
): Promise<ScanWithFileAnalysesResult> {
  const concurrency = options.concurrency ?? DEFAULT_FILE_ANALYZER_CONCURRENCY;
  const progress = options.onProgress ?? ((line: string) => process.stderr.write(`${line}\n`));

  const narrative = await scanWithNarrative(projectRoot, providerConfig, options.scannerOptions);
  const batches = narrative.batches.batches;

  progress(
    `[scanWithFileAnalyses] dispatching ${batches.length} batches at concurrency=${concurrency}`,
  );

  const t0 = Date.now();
  const settled: SettledResult<BatchAnalysisResult>[] = await runWithConcurrency(
    batches,
    concurrency,
    async (batch) => {
      const r = await runFileAnalyzerOnBatch(projectRoot, batch, providerConfig, options.perBatch);
      progress(
        `[scanWithFileAnalyses]   batch ${r.batchIndex}: ${r.fileCount}/${batch.files.length} files in ${(r.elapsedMs / 1000).toFixed(1)}s`,
      );
      return r;
    },
  );
  const elapsedMs = Date.now() - t0;
  progress(`[scanWithFileAnalyses] fan-out done in ${(elapsedMs / 1000).toFixed(1)}s`);

  const outcomes: BatchOutcome[] = batches.map((b, i) => {
    const s = settled[i];
    if (s.ok) {
      return { batchIndex: b.batchIndex, ok: true, result: s.value, elapsedMs: s.value.elapsedMs };
    }
    progress(
      `[scanWithFileAnalyses]   batch ${b.batchIndex}: FAILED — ${s.error.message.slice(0, 200)}`,
    );
    return { batchIndex: b.batchIndex, ok: false, error: s.error.message };
  });

  const fileAnalyses: Record<string, FileAnalysis> = {};
  for (const o of outcomes) {
    if (!o.ok || !o.result) continue;
    Object.assign(fileAnalyses, o.result.analyses);
  }

  const intermediateDir = join(projectRoot, ".understand-anything", "intermediate");
  mkdirSync(intermediateDir, { recursive: true });
  const fileAnalysesPath = join(intermediateDir, "file-analyses.json");
  writeFileSync(fileAnalysesPath, JSON.stringify(fileAnalyses, null, 2));

  const filesTotal = batches.reduce((sum, b) => sum + b.files.length, 0);
  const batchesSucceeded = outcomes.filter((o) => o.ok).length;
  const batchesFailed = outcomes.length - batchesSucceeded;

  return {
    ...narrative,
    fileAnalyses,
    batchOutcomes: outcomes,
    filesAnalyzed: Object.keys(fileAnalyses).length,
    filesTotal,
    batchesSucceeded,
    batchesFailed,
    fileAnalysesPath,
  };
}

export interface ScanWithArchitectureOptions extends ScanWithFileAnalysesOptions {
  /** Per-call knobs for the architecture-analyzer LLM phase. */
  architectureOptions?: RunArchitectureAnalyzerOptions;
}

/** Output of `scanWithArchitecture` — everything from scanWithFileAnalyses
 *  plus the architectural-layer synthesis. */
export interface ScanWithArchitectureResult extends ScanWithFileAnalysesResult {
  /** Normalized architectural layers — every input file appears in exactly
   *  one layer's fileIds. */
  layers: ArchitecturalLayer[];
  /** Diagnostic anomalies from layer normalization (unassigned files,
   *  unassigned/duplicate/unknown directory groups, unusual layer IDs). */
  architectureAnomalies: ArchitectureAnalyzerResult["anomalies"];
  /** Number of directory groups the LLM was asked to assign in this run. */
  architectureGroupCount: number;
  /** Wall-clock for the architecture-analyzer LLM call alone. */
  architectureElapsedMs: number;
  /** Absolute path of the architecture.json written. */
  architecturePath: string;
}

/**
 * Run the full pipeline through the architecture-analyzer synthesis phase.
 *
 * Behavior:
 *   - Composes scanWithFileAnalyses (deterministic + narrative + per-file
 *     fan-out) and feeds its output into runArchitectureAnalyzer.
 *   - Architecture-analyzer is a SINGLE @mirepoix/acp session (synthesis pass,
 *     not parallelizable).
 *   - Writes `<projectRoot>/.understand-anything/intermediate/architecture.json`
 *     with the normalized layer set.
 *
 * Contract:
 *   - Every file in `scan.files` appears in exactly one layer's fileIds
 *     (uniqueness enforced post-hoc by runArchitectureAnalyzer's normalizer;
 *     unassigned files are swept into a synthetic "layer:shared").
 *
 * Failure modes:
 *   - If the LLM session fails or the response can't be parsed,
 *     runArchitectureAnalyzer throws. Unlike file-analyzer (which isolates
 *     per-batch failures), there is only one session here — its failure is
 *     fatal to this call. The deterministic + narrative + file-analyses
 *     artifacts already on disk remain valid.
 */
export async function scanWithArchitecture(
  projectRoot: string,
  providerConfig: ProviderConfig,
  options: ScanWithArchitectureOptions = {},
): Promise<ScanWithArchitectureResult> {
  const progress = options.onProgress ?? ((line: string) => process.stderr.write(`${line}\n`));
  const phase1 = await scanWithFileAnalyses(projectRoot, providerConfig, options);

  progress(
    `[scanWithArchitecture] running architecture-analyzer over ${phase1.scan.files.length} files (${phase1.filesAnalyzed} with per-file analysis)`,
  );

  const tArch0 = Date.now();
  const archResult = await runArchitectureAnalyzer(
    {
      files: phase1.scan.files,
      fileAnalyses: phase1.fileAnalyses,
      narrative: phase1.narrative,
      importMap: phase1.importMap.importMap,
    },
    providerConfig,
    options.architectureOptions,
  );
  const tArchElapsed = Date.now() - tArch0;
  progress(
    `[scanWithArchitecture] architecture-analyzer done in ${(tArchElapsed / 1000).toFixed(1)}s — ${archResult.layers.length} layer(s)`,
  );

  const intermediateDir = join(projectRoot, ".understand-anything", "intermediate");
  mkdirSync(intermediateDir, { recursive: true });
  const architecturePath = join(intermediateDir, "architecture.json");
  writeFileSync(
    architecturePath,
    JSON.stringify(
      {
        scriptCompleted: true,
        layers: archResult.layers,
        anomalies: archResult.anomalies,
      },
      null,
      2,
    ),
  );

  return {
    ...phase1,
    layers: archResult.layers,
    architectureAnomalies: archResult.anomalies,
    architectureGroupCount: archResult.groupCount,
    architectureElapsedMs: archResult.elapsedMs,
    architecturePath,
  };
}

export interface ScanWithDomainsOptions extends ScanWithArchitectureOptions {
  /** Per-call knobs for the domain-analyzer LLM phase. */
  domainOptions?: RunDomainAnalyzerOptions;
}

/** Output of `scanWithDomains` — everything from scanWithArchitecture plus
 *  the business-domain synthesis. */
export interface ScanWithDomainsResult extends ScanWithArchitectureResult {
  /** Normalized business domains — every architectural layer appears in
   *  exactly one domain's layerIds. */
  domains: BusinessDomain[];
  /** Diagnostic anomalies from domain normalization (unassigned/duplicate/
   *  unknown layers, unusual domain IDs, layer-id collisions). */
  domainAnomalies: DomainAnalyzerResult["anomalies"];
  /** Number of layers the LLM was asked to assign in this run. */
  domainLayerCount: number;
  /** Wall-clock for the domain-analyzer LLM call alone. */
  domainElapsedMs: number;
  /** Absolute path of the domains.json written. */
  domainsPath: string;
}

/**
 * Run the full pipeline through the domain-analyzer synthesis phase.
 *
 * Behavior:
 *   - Composes scanWithArchitecture (deterministic + narrative + per-file
 *     fan-out + architectural layers) and feeds its output into
 *     runDomainAnalyzer.
 *   - Domain-analyzer is a SINGLE @mirepoix/acp session (synthesis pass,
 *     not parallelizable). Input cardinality is layers (~5-10), not files.
 *   - Writes `<projectRoot>/.understand-anything/intermediate/domains.json`
 *     with the normalized domain set.
 *
 * Contract:
 *   - Every layer in `architecture.layers` appears in exactly one domain's
 *     layerIds (uniqueness enforced post-hoc by runDomainAnalyzer's
 *     normalizer; unassigned layers are swept into a synthetic
 *     "domain:shared").
 *   - Each domain's `fileIds` is the union of its member layers' fileIds.
 *
 * Failure modes:
 *   - If the LLM session fails or the response can't be parsed,
 *     runDomainAnalyzer throws. The deterministic + narrative +
 *     file-analyses + architecture artifacts already on disk remain valid;
 *     a re-run can pick up from here once the failure is resolved.
 */
export async function scanWithDomains(
  projectRoot: string,
  providerConfig: ProviderConfig,
  options: ScanWithDomainsOptions = {},
): Promise<ScanWithDomainsResult> {
  const progress = options.onProgress ?? ((line: string) => process.stderr.write(`${line}\n`));
  const phase2 = await scanWithArchitecture(projectRoot, providerConfig, options);

  progress(`[scanWithDomains] running domain-analyzer over ${phase2.layers.length} layer(s)`);

  const tDom0 = Date.now();
  const domResult = await runDomainAnalyzer(
    {
      layers: phase2.layers,
      fileAnalyses: phase2.fileAnalyses,
      narrative: phase2.narrative,
    },
    providerConfig,
    options.domainOptions,
  );
  const tDomElapsed = Date.now() - tDom0;
  progress(
    `[scanWithDomains] domain-analyzer done in ${(tDomElapsed / 1000).toFixed(1)}s — ${domResult.domains.length} domain(s)`,
  );

  const intermediateDir = join(projectRoot, ".understand-anything", "intermediate");
  mkdirSync(intermediateDir, { recursive: true });
  const domainsPath = join(intermediateDir, "domains.json");
  writeFileSync(
    domainsPath,
    JSON.stringify(
      {
        scriptCompleted: true,
        domains: domResult.domains,
        anomalies: domResult.anomalies,
      },
      null,
      2,
    ),
  );

  return {
    ...phase2,
    domains: domResult.domains,
    domainAnomalies: domResult.anomalies,
    domainLayerCount: domResult.layerCount,
    domainElapsedMs: domResult.elapsedMs,
    domainsPath,
  };
}

export interface ScanWithAssemblerOptions extends ScanWithDomainsOptions {
  /** Per-call knobs for the in-product face-off review phase. */
  faceOffOptions?: RunFaceOffReviewOptions;
}

/** Output of `scanWithAssembler` — the v0 final shape. Composes everything
 *  from `scanWithDomains` and adds the assembled KnowledgeGraph + the
 *  on-disk path to `knowledge-graph.json` + wall-clock for the face-off
 *  reviewer phase. */
export interface ScanWithAssemblerResult extends ScanWithDomainsResult {
  /** The unified KnowledgeGraph, with `meta.faceOffVerdicts[]` populated. */
  graph: KnowledgeGraph;
  /** Absolute path of the knowledge-graph.json written. */
  graphPath: string;
  /** Wall-clock for the parallel face-off reviewer phase alone. */
  faceOffElapsedMs: number;
}

/**
 * Run the full pipeline through assembly + in-product face-off review.
 *
 * Behavior:
 *   - Composes scanWithDomains (deterministic + narrative + per-file
 *     fan-out + architectural layers + business domains) and feeds the
 *     full output into the pure-function assembler.
 *   - Dispatches the in-product face-off review (two parallel
 *     @mirepoix/acp reviewer sessions per ADR-013). Verdicts are merged
 *     into `graph.meta.faceOffVerdicts[]`.
 *   - Writes `<projectRoot>/.understand-anything/intermediate/
 *     knowledge-graph.json` with the verdicts embedded.
 *
 * V0 surfacing rules:
 *   - If either reviewer BLOCKs, the orchestrator does NOT throw — it
 *     records the verdict and returns the graph anyway. Downstream
 *     consumer (caller or human) decides what to do. v0 contract is
 *     "verdicts captured," not "verdicts converged."
 *   - Per-reviewer session failure is downgraded to a BLOCK verdict
 *     (see llm/face-off-reviewer.ts). The audit trail always has
 *     exactly 2 entries.
 */
export async function scanWithAssembler(
  projectRoot: string,
  providerConfig: ProviderConfig,
  options: ScanWithAssemblerOptions = {},
): Promise<ScanWithAssemblerResult> {
  const progress = options.onProgress ?? ((line: string) => process.stderr.write(`${line}\n`));
  const phase3 = await scanWithDomains(projectRoot, providerConfig, options);

  progress("[scanWithAssembler] assembling unified knowledge graph");
  const graph = assembleKnowledgeGraph({
    projectRoot,
    deterministicScan: {
      scan: phase3.scan,
      importMap: phase3.importMap,
      batches: phase3.batches,
      scanResultPath: phase3.scanResultPath,
      batchesPath: phase3.batchesPath,
    },
    narrative: phase3.narrative,
    fileAnalyses: phase3.fileAnalyses,
    layers: phase3.layers,
    domains: phase3.domains,
  });
  progress(
    `[scanWithAssembler] assembled — ${graph.nodes.length} node(s), ${graph.edges.length} edge(s)`,
  );

  progress("[scanWithAssembler] dispatching in-product face-off review");
  const tFaceOff0 = Date.now();
  const verdicts = await runFaceOffReview(graph, providerConfig, {
    onProgress: progress,
    ...(options.faceOffOptions ?? {}),
  });
  const faceOffElapsedMs = Date.now() - tFaceOff0;
  graph.meta.faceOffVerdicts.assemble = verdicts;
  progress(
    `[scanWithAssembler] face-off review done in ${(faceOffElapsedMs / 1000).toFixed(1)}s — ` +
      `${verdicts.length} verdict(s) recorded`,
  );

  // Write final knowledge-graph.json with verdicts embedded.
  const intermediateDir = join(projectRoot, ".understand-anything", "intermediate");
  mkdirSync(intermediateDir, { recursive: true });
  const graphPath = join(intermediateDir, "knowledge-graph.json");
  writeFileSync(graphPath, JSON.stringify(graph, null, 2));

  return {
    ...phase3,
    graph,
    graphPath,
    faceOffElapsedMs,
  };
}

export interface ScanWithGraphOptions extends ScanWithAssemblerOptions {
  /** Per-call knobs for the tour-builder LLM phase. */
  tourOptions?: RunTourBuilderOptions;
  /** Per-call knobs for the graph-reviewer face-off phase. */
  graphReviewerOptions?: RunGraphReviewerOptions;
}

/** Output of `scanWithGraph` — everything from scanWithAssembler plus the
 *  tour-builder output and a second face-off verdict pair. */
export interface ScanWithGraphResult extends ScanWithAssemblerResult {
  /** Diagnostic anomalies from the tour-builder normalization. */
  tourAnomalies: TourAnomalies;
  /** Wall-clock for the tour-builder LLM call alone. */
  tourElapsedMs: number;
  /** Wall-clock for the parallel graph-reviewer face-off phase alone. */
  graphFaceOffElapsedMs: number;
}

/**
 * Run the full pipeline through tour-builder + graph-reviewer face-off.
 *
 * Behavior:
 *   - Composes scanWithAssembler (which already runs the assemble-reviewer
 *     face-off) and chains the Commit-9 phases on top.
 *   - Tour-builder is a SINGLE @mirepoix/acp session over a candidate-hub
 *     brief; produces ~12 ordered TourStep entries. Result is stamped onto
 *     `graph.tour` BEFORE the graph-reviewer runs — the reviewers need to
 *     see the tour as the final artifact's documentation.
 *   - Graph-reviewer is a parallel pair of @mirepoix/acp sessions on the
 *     graph-with-tour. Verdicts land in `graph.meta.faceOffVerdicts.graph`.
 *   - Final knowledge-graph.json is rewritten in-place at the same path the
 *     assembler wrote, so the on-disk artifact always has the latest tour +
 *     verdict shape.
 *
 * V0 surfacing rules:
 *   - Tour-builder failure throws (synthesis pass, no in-product retry yet).
 *     The assembled graph + assemble verdicts already on disk remain valid;
 *     a re-run can pick up from here once the failure is resolved.
 *   - Graph-reviewer per-reviewer failure is downgraded to BLOCK (the shared
 *     runOneReviewer dispatcher in face-off-reviewer.ts owns this); the audit
 *     trail always has exactly 2 entries.
 */
export async function scanWithGraph(
  projectRoot: string,
  providerConfig: ProviderConfig,
  options: ScanWithGraphOptions = {},
): Promise<ScanWithGraphResult> {
  const progress = options.onProgress ?? ((line: string) => process.stderr.write(`${line}\n`));
  const phase4 = await scanWithAssembler(projectRoot, providerConfig, options);

  progress("[scanWithGraph] running tour-builder over assembled graph");
  const tTour0 = Date.now();
  const tour = await runTourBuilder(phase4.graph, providerConfig, options.tourOptions);
  const tourElapsedMs = Date.now() - tTour0;
  progress(
    `[scanWithGraph] tour-builder done in ${(tourElapsedMs / 1000).toFixed(1)}s — ${tour.tour.length} step(s)`,
  );
  // Stamp the tour onto the graph BEFORE the graph-reviewer phase — the
  // reviewers need to see it.
  phase4.graph.tour = tour.tour;

  progress("[scanWithGraph] dispatching graph-reviewer face-off");
  const tGraphRev0 = Date.now();
  const graphVerdicts = await runGraphReviewer(phase4.graph, providerConfig, {
    onProgress: progress,
    ...(options.graphReviewerOptions ?? {}),
  });
  const graphFaceOffElapsedMs = Date.now() - tGraphRev0;
  phase4.graph.meta.faceOffVerdicts.graph = graphVerdicts;
  progress(
    `[scanWithGraph] graph-reviewer done in ${(graphFaceOffElapsedMs / 1000).toFixed(1)}s — ` +
      `${graphVerdicts.length} verdict(s) recorded`,
  );

  // Rewrite knowledge-graph.json in place — same path the assembler wrote,
  // now carrying the populated tour + graph face-off verdicts.
  writeFileSync(phase4.graphPath, JSON.stringify(phase4.graph, null, 2));

  return {
    ...phase4,
    tourAnomalies: tour.anomalies,
    tourElapsedMs,
    graphFaceOffElapsedMs,
  };
}
