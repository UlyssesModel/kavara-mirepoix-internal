// @mirepoix/understand — orchestrator.
//
// Two compositions live here:
//
//   deterministicScan(projectRoot) — four LLM-free phases of upstream
//   Understand-Anything:
//     1. runScanProject       — enumerate + classify files.
//     2. runExtractImportMap  — tree-sitter resolved import edges per file.
//     3. Write minimal scan-result.json — compute-batches.mjs reads only
//        `files` and `importMap` from this file (upstream main() lines 338-341).
//     4. runComputeBatches    — Louvain community detection over the import
//                               graph, producing the batch plan.
//
//   scanWithNarrative(projectRoot, providerConfig) — deterministicScan +
//   the first LLM phase (runProjectScanner). Merges the LLM narrative
//   (name, description, frameworks, languages) into scan-result.json so the
//   on-disk file matches upstream's full Phase 1 output schema.
//
// Subsequent commits will add scanWithFileAnalyses (parallel file-analyzer
// fan-out) and the full runUnderstand() composition.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  type ProjectNarrative,
  type ProviderConfig,
  type RunProjectScannerOptions,
  runProjectScanner,
} from "./llm/project-scanner";
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
