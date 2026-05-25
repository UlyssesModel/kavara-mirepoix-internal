// @mirepoix/understand — deterministic-only orchestrator.
//
// Chains the four LLM-free phases of upstream Understand-Anything:
//
//   1. runScanProject       — enumerate + classify files (language, category,
//                             line count, complexity bucket).
//   2. runExtractImportMap  — tree-sitter resolved import edges per file.
//   3. Write a minimal scan-result.json — compute-batches.mjs reads only
//      `files` and `importMap` from this file (verified in upstream's
//      main(), lines 338-341), so we can omit the LLM-narrative fields for
//      the deterministic-only path. The full runUnderstand() orchestrator
//      will merge in name/description/frameworks/etc. before batching.
//   4. runComputeBatches    — Louvain community detection over the import
//                             graph, producing the batch plan that the LLM
//                             file-analyzer phase will fan out over.
//
// No LLM calls in this path. Useful as:
//   - The first end-to-end exercise of the script-wrapper layer against a
//     real repo (smoke test).
//   - The deterministic preamble of the full runUnderstand() orchestrator;
//     subsequent commits wire LLM phases on top of this output.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  runComputeBatches,
  runExtractImportMap,
  runScanProject,
  type BatchesResult,
  type ImportMapResult,
  type ScanProjectResult,
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
