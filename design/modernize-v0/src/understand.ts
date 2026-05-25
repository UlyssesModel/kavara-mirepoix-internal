// @mirepoix/understand — codebase comprehension layer
// Wraps the Understand-Anything multi-agent pipeline as a Mirepoix workflow
// against local Qwen on the A100 via parallel @mirepoix/acp sessions.
//
// Replaces the upstream Claude Code Task-tool dispatch with @mirepoix/acp
// parallel sub-sessions. Same input → same output schema → same dashboard
// renders the result.

import type {
  KnowledgeGraph,
  Language,
  PerModuleSummary,
} from "./types";

/** Configuration for an Understand run. */
export interface UnderstandConfig {
  /** Absolute path to the legacy codebase. */
  repoPath: string;

  /** Language being modernized FROM (informs the architecture analyzer's focus). */
  sourceLanguage: Language;

  /** Optional: language being modernized TO (informs domain analyzer's framing). */
  targetLanguage?: Language;

  /** @mirepoix/acp endpoint for spawning parallel agent sessions. */
  acpEndpoint: string;

  /** Provider config (typically local Qwen on the A100). */
  providerConfig: {
    url: string;
    model: string;
  };

  /** Maximum concurrent ACP sessions for the file-analysis phase. Default: 15. */
  maxConcurrency?: number;
}

/**
 * Main entry point for the Understand layer.
 *
 * Pipeline (mirrors upstream Understand-Anything):
 *
 *   1. Deterministic scan (scan-project.mjs + extract-import-map.mjs).
 *      Local subprocess execution. No LLM.
 *   2. Per-batch file analysis — N parallel @mirepoix/acp sessions, one per batch.
 *      Each session runs the file-analyzer agent prompt against a batch of files.
 *   3. Project scanner — single Mirepoix session synthesizing per-file outputs into
 *      project-level narrative (name, description, languages, frameworks).
 *   4. Architecture analyzer — sequential, identifies layers.
 *   5. Domain analyzer — sequential, maps to business processes.
 *   6. Assemble reviewer — multi-agent face-off (ADR-013).
 *   7. Knowledge-graph reviewer — face-off again on the final graph shape.
 *   8. Tour builder — 12-step dependency-ordered.
 *
 * @returns KnowledgeGraph schema-compatible with the upstream React dashboard.
 */
export async function runUnderstand(config: UnderstandConfig): Promise<KnowledgeGraph> {
  // IMPLEMENTATION:
  //   const inventory = await runDeterministicScan(config.repoPath);
  //   const fileAnalyses = await fanOutFileAnalysis(inventory.batches, config);
  //   const projectNarrative = await runProjectScanner(fileAnalyses, config);
  //   const layers = await runArchitectureAnalyzer(fileAnalyses, projectNarrative, config);
  //   const domains = await runDomainAnalyzer(layers, projectNarrative, config);
  //   const assembled = await assemble(fileAnalyses, layers, domains);
  //   await faceOffReview("assembly", assembled, config);
  //   const graph = await buildKnowledgeGraph(assembled);
  //   await faceOffReview("graph", graph, config);
  //   const tour = await buildTour(graph, config);
  //   return { ...graph, tour, meta: { ... } };
  throw new Error("@mirepoix/understand: not yet implemented (v0.2.0-α-2 work item)");
}

/**
 * Extract per-module summaries from a knowledge graph. Used by @mirepoix/port
 * to construct architecture-aware port prompts.
 */
export function extractPerModuleSummaries(graph: KnowledgeGraph): PerModuleSummary[] {
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
export async function runUnderstandOnModernized(
  config: UnderstandConfig,
): Promise<KnowledgeGraph> {
  return runUnderstand(config);
}
