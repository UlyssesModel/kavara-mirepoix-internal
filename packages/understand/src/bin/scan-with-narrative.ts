#!/usr/bin/env bun
// @mirepoix/understand — smoke-test CLI for the deterministic + narrative phases.
//
// Usage:
//   bun packages/understand/src/bin/scan-with-narrative.ts <projectRoot>
//
// Drives the full Phase 1 pipeline: deterministicScan (Commit 3) followed by
// the LLM project-scanner (Commit 4). Prints a summary that includes the
// narrative fields populated.
//
// Provider config: local Ollama on kavara-builder (qwen3-coder:30b).
// Override via OLLAMA_URL and MIREPOIX_MODEL env vars.

import { scanWithNarrative } from "../orchestrator";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_MODEL = "qwen3-coder:30b";

/** Read env var; treat empty/whitespace-only as unset. `??` alone would let an
 *  empty `MIREPOIX_MODEL=""` through and we'd fall back to the acp server's
 *  default (`qwen2.5-coder:32b-instruct`) which isn't loaded on kavara-builder.
 *  Per Codex adversarial-review on Commit 4 (warn, 2026-05-25). */
function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v?.trim() ? v : fallback;
}

async function main(): Promise<void> {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    process.stderr.write("usage: scan-with-narrative <projectRoot>\n");
    process.exit(1);
  }

  const providerConfig = {
    url: envOr("OLLAMA_URL", DEFAULT_OLLAMA_URL),
    model: envOr("MIREPOIX_MODEL", DEFAULT_MODEL),
  };

  const t0 = Date.now();
  const result = await scanWithNarrative(projectRoot, providerConfig, {
    // Surface acp server stderr (provider errors, model-not-found warnings)
    // to the operator. The acp server is otherwise silent.
    onStderr: (chunk) => process.stderr.write(`[acp] ${chunk}`),
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  const batchCount = Array.isArray(result.batches.batches) ? result.batches.batches.length : 0;
  const detLangs = Object.keys(result.scan.stats.byLanguage).sort();

  process.stdout.write(`
=== @mirepoix/understand scan-with-narrative ===
projectRoot:       ${projectRoot}
elapsed:           ${elapsed}s
provider:          ${providerConfig.url} / ${providerConfig.model}
---
files (scanned):   ${result.scan.totalFiles}
filteredByIgnore:  ${result.scan.filteredByIgnore}
complexity:        ${result.scan.estimatedComplexity}
languages (det):   ${detLangs.join(", ")}
---
filesWithImports:  ${result.importMap.stats.filesWithImports}
totalEdges:        ${result.importMap.stats.totalEdges}
---
batches:           ${batchCount}
---
narrative:
  name:           ${result.narrative.name}
  description:    ${result.narrative.description}
  frameworks:     ${result.narrative.frameworks.join(", ") || "(none)"}
  languages:      ${result.narrative.languages.join(", ") || "(none)"}
---
outputs:
  ${result.scanResultPath}
  ${result.batchesPath}
`);
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  process.stderr.write(`scan-with-narrative failed: ${e.message}\n${e.stack ?? ""}\n`);
  process.exit(1);
});
