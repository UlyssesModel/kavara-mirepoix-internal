#!/usr/bin/env bun
// @mirepoix/understand — smoke-test CLI for the full Phase 1 + Phase 2 pipeline.
//
// Usage:
//   bun packages/understand/src/bin/scan-with-file-analyses.ts <projectRoot> [concurrency]
//
// Runs deterministic scan → project-scanner LLM phase → parallel file-analyzer
// fan-out. Concurrency defaults to 4; pass an integer second arg to override.
// Override provider via OLLAMA_URL + MIREPOIX_MODEL env vars.

import { scanWithFileAnalyses } from "../orchestrator";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_MODEL = "qwen3-coder:30b";
const DEFAULT_CONCURRENCY = 4;

function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v?.trim() ? v : fallback;
}

async function main(): Promise<void> {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    process.stderr.write("usage: scan-with-file-analyses <projectRoot> [concurrency]\n");
    process.exit(1);
  }
  const concurrencyArg = process.argv[3];
  const concurrency = concurrencyArg
    ? Math.max(1, Number.parseInt(concurrencyArg, 10) || DEFAULT_CONCURRENCY)
    : DEFAULT_CONCURRENCY;

  const providerConfig = {
    url: envOr("OLLAMA_URL", DEFAULT_OLLAMA_URL),
    model: envOr("MIREPOIX_MODEL", DEFAULT_MODEL),
  };

  const t0 = Date.now();
  const result = await scanWithFileAnalyses(projectRoot, providerConfig, {
    concurrency,
    perBatch: {
      onStderr: (chunk) => process.stderr.write(`[acp] ${chunk}`),
    },
    scannerOptions: {
      onStderr: (chunk) => process.stderr.write(`[acp] ${chunk}`),
    },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  const batchCount = Array.isArray(result.batches.batches) ? result.batches.batches.length : 0;

  process.stdout.write(`
=== @mirepoix/understand scan-with-file-analyses ===
projectRoot:       ${projectRoot}
elapsed:           ${elapsed}s (wall-clock; fan-out parallel @ concurrency=${concurrency})
provider:          ${providerConfig.url} / ${providerConfig.model}
---
files (scanned):   ${result.scan.totalFiles}
filteredByIgnore:  ${result.scan.filteredByIgnore}
complexity:        ${result.scan.estimatedComplexity}
---
filesWithImports:  ${result.importMap.stats.filesWithImports}
totalEdges:        ${result.importMap.stats.totalEdges}
---
narrative:
  name:           ${result.narrative.name}
  description:    ${result.narrative.description}
  frameworks:     ${result.narrative.frameworks.join(", ") || "(none)"}
  languages:      ${result.narrative.languages.join(", ") || "(none)"}
---
file-analyzer fan-out:
  batches:        ${batchCount}
  succeeded:      ${result.batchesSucceeded} / ${batchCount}
  failed:         ${result.batchesFailed}
  files analyzed: ${result.filesAnalyzed} / ${result.filesTotal}
---
outputs:
  ${result.scanResultPath}
  ${result.batchesPath}
  ${result.fileAnalysesPath}
`);

  if (result.batchesFailed > 0) {
    process.stdout.write("\nfailed batches (non-fatal — per-batch failures are isolated):\n");
    for (const o of result.batchOutcomes.filter((x) => !x.ok)) {
      process.stdout.write(`  batch ${o.batchIndex}: ${o.error?.slice(0, 240)}\n`);
    }
  }

  // Aggregate the per-batch drop categories so the operator can see at a glance
  // why files were dropped during merge (added in Commit 5 round-2 per
  // convergent face-off finding: Claude MAJOR-1 + Codex Observation 1).
  const totalMissingStructure = result.batchOutcomes
    .filter((o) => o.ok)
    .reduce((sum, o) => sum + (o.result?.drops.missingStructure.length ?? 0), 0);
  const totalMissingNarrative = result.batchOutcomes
    .filter((o) => o.ok)
    .reduce((sum, o) => sum + (o.result?.drops.missingNarrative.length ?? 0), 0);
  const totalUnmatched = result.batchOutcomes
    .filter((o) => o.ok)
    .reduce((sum, o) => sum + (o.result?.drops.unmatchedNarrativeKeys.length ?? 0), 0);
  if (totalMissingStructure + totalMissingNarrative + totalUnmatched > 0) {
    process.stdout.write("\ndropped-file breakdown (across successful batches):\n");
    process.stdout.write(
      `  missingStructure:        ${totalMissingStructure}  (extract-structure produced no result for the file)\n`,
    );
    process.stdout.write(
      `  missingNarrative:        ${totalMissingNarrative}  (LLM omitted the file from its JSON map)\n`,
    );
    process.stdout.write(
      `  unmatchedNarrativeKeys:  ${totalUnmatched}  (LLM emitted a key not in the batch — leading ./ or similar)\n`,
    );
  }

  // Exit 0 if at least one batch succeeded (matches the "per-batch failures
  // isolated, not fatal" architectural decision in the handoff).
  process.exit(result.batchesSucceeded > 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  process.stderr.write(`scan-with-file-analyses failed: ${e.message}\n${e.stack ?? ""}\n`);
  process.exit(1);
});
