// @mirepoix/understand — codebase comprehension layer.
//
// Public API for the Mirepoix-native port of the Understand-Anything multi-
// agent pipeline. Replaces the upstream Claude Code Task-tool dispatch with
// @mirepoix/acp parallel sub-sessions against local Qwen (default
// qwen3-coder:30b on kavara-builder / scotty-gpu). Output is schema-
// compatible with the upstream React dashboard.
//
// runUnderstand() composes the orchestrator's scanWithGraph end-to-end:
//   deterministic scan → project-scanner → file-analyzer fan-out →
//   architecture-analyzer → domain-analyzer → assembler → assemble-reviewer
//   face-off → tour-builder → graph-reviewer face-off → KnowledgeGraph.
//
// See ./orchestrator.ts for the partial-pipeline functions (scanWith*) that
// downstream packages can drive directly when they only need a prefix of the
// pipeline.

import { resolve as resolvePath } from "node:path";

import { scanWithGraph } from "./orchestrator";
import type { KnowledgeGraph, Language, PerModuleSummary } from "./types";

/** Configuration for an Understand run — the public input contract. */
export interface UnderstandConfig {
  /** Absolute path to the legacy codebase. */
  repoPath: string;

  /** Language being modernized FROM. Recorded as a hint; current pipeline
   *  derives languages from the project-scanner's manifest read, so this
   *  field is informational in v0 and not yet threaded into the LLM phases. */
  sourceLanguage: Language;

  /** Optional: language being modernized TO. Informational hint; not yet
   *  threaded into the LLM phases in v0. */
  targetLanguage?: Language;

  /** Optional override for the @mirepoix/acp entry script path. Defaults to
   *  the workspace-relative entry resolved by AcpClient — leave undefined
   *  unless running outside the monorepo or testing against a fork. */
  acpEndpoint?: string;

  /** Provider config (typically local Qwen). */
  providerConfig: {
    url: string;
    model: string;
  };

  /** Maximum concurrent ACP sessions for the file-analyzer fan-out. Defaults
   *  to the orchestrator's empirically-tuned value (4) for qwen3-coder:30b on
   *  a single A100. */
  maxConcurrency?: number;
}

/**
 * Main entry point for the Understand layer.
 *
 * Thin composition over `scanWithGraph` — the orchestrator owns every phase
 * boundary. This wrapper exists so callers can program against
 * `UnderstandConfig` (the public contract) rather than the orchestrator's
 * positional + per-phase options shape.
 *
 * **Partial-failure caveat (v0):** the return type is `Promise<KnowledgeGraph>`,
 * which carries the assembled artifact but does NOT carry per-batch
 * diagnostics (`batchOutcomes`, `filesAnalyzed/filesTotal`,
 * `batchesSucceeded/batchesFailed`). `runUnderstand` will NOT throw when
 * file-analyzer batches yield zero analyses or when individual files are
 * dropped during a successful batch's merge — the graph is still returned
 * with whatever per-file summaries the LLM produced. Programmatic consumers
 * that need this signal must call `scanWithGraph` from `./orchestrator`
 * directly; its richer return shape exposes the partial-failure counters.
 * Stamping these counters into `KnowledgeGraph.meta` is α-3b scope (requires
 * schema evolution).
 *
 * Pipeline (mirrors upstream Understand-Anything):
 *
 *   1. Deterministic scan (scan-project.mjs + extract-import-map.mjs +
 *      Louvain batch assignment). Local subprocesses. No LLM.
 *   2. Project scanner — single @mirepoix/acp session synthesizing the
 *      project-level narrative (name, description, languages, frameworks)
 *      from README + manifests.
 *   3. Per-batch file analysis — N parallel @mirepoix/acp sessions, one per
 *      Louvain batch. Each session emits {summary, complexity} per file.
 *   4. Architecture analyzer — single session, identifies layers.
 *   5. Domain analyzer — single session, maps layers to business domains.
 *   6. Assembler — deterministic pure function building the unified graph.
 *   7. Assemble-reviewer face-off — two parallel @mirepoix/acp reviewer
 *      sessions per ADR-013, verdicts recorded in
 *      `meta.faceOffVerdicts.assemble`.
 *   8. Tour builder — single session producing ~12 dependency-ordered steps.
 *   9. Graph-reviewer face-off — two parallel reviewer sessions on the final
 *      graph-with-tour, verdicts recorded in `meta.faceOffVerdicts.graph`.
 *
 * @returns KnowledgeGraph schema-compatible with the upstream React dashboard.
 */
export async function runUnderstand(config: UnderstandConfig): Promise<KnowledgeGraph> {
  // F4: normalize repoPath to an absolute path so the documented `repoPath`
  // contract ("absolute path to the legacy codebase") is enforced for
  // programmatic callers passing `.` or any other relative input. The CLI
  // already resolves before calling runUnderstand; this protects direct API
  // callers and keeps `KnowledgeGraph.project.rootPath` absolute as documented.
  const repoPath = resolvePath(config.repoPath);
  const phaseOpts = config.acpEndpoint !== undefined ? { acpEntry: config.acpEndpoint } : {};
  const result = await scanWithGraph(repoPath, config.providerConfig, {
    concurrency: config.maxConcurrency,
    perBatch: phaseOpts,
    scannerOptions: phaseOpts,
    architectureOptions: phaseOpts,
    domainOptions: phaseOpts,
    faceOffOptions: phaseOpts,
    tourOptions: phaseOpts,
    graphReviewerOptions: phaseOpts,
  });
  return result.graph;
}

/**
 * Extract per-module summaries from a knowledge graph. Used by @mirepoix/port
 * to construct architecture-aware port prompts.
 */
export function extractPerModuleSummaries(_graph: KnowledgeGraph): PerModuleSummary[] {
  // IMPLEMENTATION:
  //   For each file-type node in the graph:
  //     - Collect its edges (imports, calls, depends_on)
  //     - Look up its layer
  //     - Synthesize PerModuleSummary {
  //         nodeId, path, language,
  //         purpose: node.summary,
  //         publicInterface: derived from exports edges,
  //         dependencies: derived from depends_on + imports edges,
  //         notes: from layer membership + complexity
  //       }
  throw new Error("@mirepoix/understand.extractPerModuleSummaries: not yet implemented");
}

/**
 * Run a fresh Understand pass against a modernized codebase. Used by the
 * @mirepoix/modernize orchestrator at engagement end to produce the target-
 * language knowledge graph delivered to the customer.
 */
export async function runUnderstandOnModernized(config: UnderstandConfig): Promise<KnowledgeGraph> {
  return runUnderstand(config);
}
