#!/usr/bin/env bun
// @mirepoix/understand — smoke-test CLI for the full Phase-1 + Phase-2 +
// architecture-analyzer pipeline.
//
// Usage:
//   bun packages/understand/src/bin/scan-with-architecture.ts <projectRoot> [concurrency]
//
// Runs deterministic scan → project-scanner LLM phase → parallel file-analyzer
// fan-out → architecture-analyzer single-session synthesis. Concurrency
// defaults to 4 (file-analyzer fan-out); architecture-analyzer is always one
// session. Override provider via OLLAMA_URL + MIREPOIX_MODEL env vars.

import { scanWithArchitecture } from "../orchestrator";

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
    process.stderr.write("usage: scan-with-architecture <projectRoot> [concurrency]\n");
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
  const result = await scanWithArchitecture(projectRoot, providerConfig, {
    concurrency,
    perBatch: {
      onStderr: (chunk) => process.stderr.write(`[acp] ${chunk}`),
    },
    scannerOptions: {
      onStderr: (chunk) => process.stderr.write(`[acp] ${chunk}`),
    },
    architectureOptions: {
      onStderr: (chunk) => process.stderr.write(`[acp] ${chunk}`),
    },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  const batchCount = Array.isArray(result.batches.batches) ? result.batches.batches.length : 0;
  const codeFiles = result.scan.files.filter((f) => f.fileCategory === "code");
  const codePaths = new Set(codeFiles.map((f) => f.path));
  // Round-2 fix per Codex WARN: count UNIQUE assigned code paths, not raw
  // occurrences. The previous counter let a duplicate code-file assignment +
  // a missing code file still equal codeFiles.length, which falsely passed
  // the smoke gate while the contract was violated. With a Set the gate
  // re-verifies what `normalizeLayers` should already guarantee.
  const codeAssignedSet = new Set<string>();
  for (const layer of result.layers) {
    for (const fid of layer.fileIds) {
      if (codePaths.has(fid)) codeAssignedSet.add(fid);
    }
  }
  const codeAssigned = codeAssignedSet.size;
  // Also count TOTAL appearances of code paths across layers — if any code
  // path appears more than once, the contract is violated even if the set
  // size matches.
  let codeAppearances = 0;
  for (const layer of result.layers) {
    for (const fid of layer.fileIds) {
      if (codePaths.has(fid)) codeAppearances++;
    }
  }

  process.stdout.write(`
=== @mirepoix/understand scan-with-architecture ===
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
architecture (single-session synthesis, ${(result.architectureElapsedMs / 1000).toFixed(1)}s):
  groups passed to LLM: ${result.architectureGroupCount}
  layers identified:    ${result.layers.length}
`);
  for (const layer of result.layers) {
    process.stdout.write(
      `  - ${layer.id} (${layer.fileIds.length} files, ${layer.complexity}): ${layer.name}\n`,
    );
  }
  process.stdout.write(`---
code-file uniqueness:
  code files in scan: ${codeFiles.length}
  code files assigned to a layer: ${codeAssigned}
---
outputs:
  ${result.scanResultPath}
  ${result.batchesPath}
  ${result.fileAnalysesPath}
  ${result.architecturePath}
`);

  const anomalies = result.architectureAnomalies;
  const totalAnomalies =
    anomalies.unassignedFiles.length +
    anomalies.unassignedGroups.length +
    anomalies.duplicateGroupAssignments.length +
    anomalies.unknownGroups.length +
    anomalies.unusualLayerIds.length +
    anomalies.duplicateLayerIds.length;
  if (totalAnomalies > 0) {
    process.stdout.write("\narchitecture anomalies (normalized; non-fatal):\n");
    if (anomalies.unassignedFiles.length > 0) {
      process.stdout.write(
        `  unassignedFiles:           ${anomalies.unassignedFiles.length}  (swept into layer:shared)\n`,
      );
    }
    if (anomalies.unassignedGroups.length > 0) {
      process.stdout.write(
        `  unassignedGroups:          ${anomalies.unassignedGroups.length}  (LLM omitted these directory groups)\n`,
      );
    }
    if (anomalies.duplicateGroupAssignments.length > 0) {
      process.stdout.write(
        `  duplicateGroupAssignments: ${anomalies.duplicateGroupAssignments.length}  (first claim wins; others recorded)\n`,
      );
    }
    if (anomalies.unknownGroups.length > 0) {
      process.stdout.write(
        `  unknownGroups:             ${anomalies.unknownGroups.length}  (LLM emitted ids not in computed groups)\n`,
      );
    }
    if (anomalies.unusualLayerIds.length > 0) {
      process.stdout.write(
        `  unusualLayerIds:           ${anomalies.unusualLayerIds.length}  (didn't match \`layer:<kebab-case>\`)\n`,
      );
    }
    if (anomalies.duplicateLayerIds.length > 0) {
      process.stdout.write(
        `  duplicateLayerIds:         ${anomalies.duplicateLayerIds.length}  (merged into first occurrence)\n`,
      );
    }
  }

  if (result.batchesFailed > 0) {
    process.stdout.write("\nfailed file-analyzer batches (non-fatal):\n");
    for (const o of result.batchOutcomes.filter((x) => !x.ok)) {
      process.stdout.write(`  batch ${o.batchIndex}: ${o.error?.slice(0, 240)}\n`);
    }
  }

  // Round-3 (Codex Q6): distribution-skew check. Even when the gate passes,
  // a single layer holding >70% of code files is a quality red flag (the LLM
  // probably failed to differentiate most of the codebase). NOT a contract
  // violation, so it doesn't fail the gate — but it's surfaced loudly so the
  // operator notices the partial-degeneracy case Codex named ("3 small
  // placeholder layers + 1 giant shared").
  let maxLayerCodeFiles = 0;
  let maxLayerId = "";
  for (const layer of result.layers) {
    let n = 0;
    for (const fid of layer.fileIds) {
      if (codePaths.has(fid)) n++;
    }
    if (n > maxLayerCodeFiles) {
      maxLayerCodeFiles = n;
      maxLayerId = layer.id;
    }
  }
  const skewRatio = codeFiles.length > 0 ? maxLayerCodeFiles / codeFiles.length : 0;
  if (skewRatio > 0.7 && codeFiles.length >= 5) {
    process.stdout.write(
      `\nDISTRIBUTION SKEW WARNING: ${maxLayerId} holds ${maxLayerCodeFiles}/${codeFiles.length} ` +
        `(${Math.round(skewRatio * 100)}%) of code files — LLM may have failed to differentiate the codebase.\n`,
    );
  }

  // Smoke gate — round-2 tightened per Claude MINOR M1 + Codex WARN.
  //   1) `result.layers.length >= 3` rejects the degenerate "one giant
  //      layer:shared swallowed everything" failure the normalizer would
  //      otherwise mask (3 is the upstream lower bound on layer count).
  //   2) `codeAssigned === codeFiles.length` confirms every code file
  //      surfaces in at least one layer (using a SET, not a counter — the
  //      original counter could be balanced by a duplicate + a miss).
  //   3) `codeAppearances === codeFiles.length` confirms NO code file
  //      appears in two layers. If the normalizer is correct, the
  //      appearance count must equal the unique count; any mismatch is a
  //      hard contract violation worth failing the smoke on.
  //   Note (Codex Q6): the gate intentionally does NOT fail on distribution
  //   skew (one layer holding most files) because that's a quality issue,
  //   not a contract violation. The DISTRIBUTION SKEW WARNING above
  //   surfaces the partial-degeneracy case for operator awareness.
  const allCodeAssignedOnce =
    codeAssigned === codeFiles.length && codeAppearances === codeFiles.length;
  const enoughLayers = result.layers.length >= 3;
  const ok = enoughLayers && allCodeAssignedOnce;
  if (!ok) {
    process.stdout.write("\nsmoke gate FAILED:\n");
    if (!enoughLayers) {
      process.stdout.write(`  layers.length (${result.layers.length}) < 3 — degenerate output\n`);
    }
    if (codeAssigned !== codeFiles.length) {
      process.stdout.write(
        `  ${codeFiles.length - codeAssigned} code file(s) NOT assigned to any layer\n`,
      );
    }
    if (codeAppearances !== codeAssigned) {
      process.stdout.write(
        `  ${codeAppearances - codeAssigned} duplicate code-file appearance(s) across layers — contract violation\n`,
      );
    }
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  process.stderr.write(`scan-with-architecture failed: ${e.message}\n${e.stack ?? ""}\n`);
  process.exit(1);
});
