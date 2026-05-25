#!/usr/bin/env bun
// @mirepoix/understand — smoke-test CLI for the deterministic phase.
//
// Usage:
//   bun packages/understand/src/bin/deterministic-scan.ts <projectRoot>
//
// Runs the four LLM-free phases (scan → import map → write scan-result.json
// → batch) against the given repo and prints a summary. The first
// end-to-end exercise of @mirepoix/understand's wrapper layer.

import { deterministicScan } from "../orchestrator";

async function main(): Promise<void> {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    process.stderr.write("usage: deterministic-scan <projectRoot>\n");
    process.exit(1);
  }

  const t0 = Date.now();
  const result = await deterministicScan(projectRoot);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  const batchCount = Array.isArray(result.batches.batches) ? result.batches.batches.length : 0;
  const langs = Object.keys(result.scan.stats.byLanguage).sort();

  process.stdout.write(`
=== @mirepoix/understand deterministic scan ===
projectRoot:       ${projectRoot}
elapsed:           ${elapsed}s
---
files (scanned):   ${result.scan.totalFiles}
filteredByIgnore:  ${result.scan.filteredByIgnore}
complexity:        ${result.scan.estimatedComplexity}
languages:         ${langs.join(", ")}
---
filesWithImports:  ${result.importMap.stats.filesWithImports}
totalEdges:        ${result.importMap.stats.totalEdges}
---
batches:           ${batchCount}
---
outputs:
  ${result.scanResultPath}
  ${result.batchesPath}
`);
}

main().catch((err: Error) => {
  process.stderr.write(`deterministic-scan failed: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
