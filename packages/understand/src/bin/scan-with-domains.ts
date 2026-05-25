#!/usr/bin/env bun
// @mirepoix/understand — smoke-test CLI for the full pipeline through the
// domain-analyzer synthesis phase.
//
// Usage:
//   bun packages/understand/src/bin/scan-with-domains.ts <projectRoot> [concurrency]
//
// Runs deterministic scan → project-scanner LLM phase → parallel file-analyzer
// fan-out → architecture-analyzer single-session synthesis → domain-analyzer
// single-session synthesis. Concurrency arg applies to the file-analyzer
// fan-out only; both synthesis passes are single-session. Override provider
// via OLLAMA_URL + MIREPOIX_MODEL env vars.

import { scanWithDomains } from "../orchestrator";

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
    process.stderr.write("usage: scan-with-domains <projectRoot> [concurrency]\n");
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
  const result = await scanWithDomains(projectRoot, providerConfig, {
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
    domainOptions: {
      onStderr: (chunk) => process.stderr.write(`[acp] ${chunk}`),
    },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  const batchCount = Array.isArray(result.batches.batches) ? result.batches.batches.length : 0;

  // Uniqueness gate inputs: every layer must end up in exactly one domain's
  // layerIds, and the sum of domain file counts must equal the sum of layer
  // file counts (deterministic expansion preserves the count).
  const allLayerIds = new Set(result.layers.map((l) => l.id));
  const layerAssignedSet = new Set<string>();
  let layerAppearances = 0;
  for (const dom of result.domains) {
    for (const lid of dom.layerIds) {
      if (allLayerIds.has(lid)) {
        layerAssignedSet.add(lid);
        layerAppearances++;
      }
    }
  }
  const totalLayerFileCount = result.layers.reduce((sum, l) => sum + l.fileIds.length, 0);
  const totalDomainFileCount = result.domains.reduce((sum, d) => sum + d.fileIds.length, 0);

  process.stdout.write(`
=== @mirepoix/understand scan-with-domains ===
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
domains (single-session synthesis, ${(result.domainElapsedMs / 1000).toFixed(1)}s):
  layers passed to LLM: ${result.domainLayerCount}
  domains identified:   ${result.domains.length}
`);
  for (const dom of result.domains) {
    process.stdout.write(
      `  - ${dom.id} (${dom.layerIds.length} layers, ${dom.fileIds.length} files, ${dom.complexity}): ${dom.name}\n`,
    );
  }
  process.stdout.write(`---
layer-uniqueness across domains:
  layers in architecture:                ${result.layers.length}
  layers assigned to a domain (unique):  ${layerAssignedSet.size}
  layer appearances across domains:      ${layerAppearances}
  total file count (layers vs domains):  ${totalLayerFileCount} vs ${totalDomainFileCount}
---
outputs:
  ${result.scanResultPath}
  ${result.batchesPath}
  ${result.fileAnalysesPath}
  ${result.architecturePath}
  ${result.domainsPath}
`);

  const anomalies = result.domainAnomalies;
  const totalAnomalies =
    anomalies.unassignedLayers.length +
    anomalies.duplicateLayerAssignments.length +
    anomalies.unknownLayers.length +
    anomalies.unusualDomainIds.length +
    anomalies.duplicateDomainIds.length +
    anomalies.layerIdCollisions.length;
  if (totalAnomalies > 0) {
    process.stdout.write("\ndomain anomalies (normalized; non-fatal):\n");
    if (anomalies.unassignedLayers.length > 0) {
      process.stdout.write(
        `  unassignedLayers:           ${anomalies.unassignedLayers.length}  (swept into domain:shared)\n`,
      );
    }
    if (anomalies.duplicateLayerAssignments.length > 0) {
      process.stdout.write(
        `  duplicateLayerAssignments: ${anomalies.duplicateLayerAssignments.length}  (first claim wins; others recorded)\n`,
      );
    }
    if (anomalies.unknownLayers.length > 0) {
      process.stdout.write(
        `  unknownLayers:             ${anomalies.unknownLayers.length}  (LLM emitted ids not in computed layers)\n`,
      );
    }
    if (anomalies.unusualDomainIds.length > 0) {
      process.stdout.write(
        `  unusualDomainIds:          ${anomalies.unusualDomainIds.length}  (didn't match \`domain:<kebab-case>\`)\n`,
      );
    }
    if (anomalies.duplicateDomainIds.length > 0) {
      process.stdout.write(
        `  duplicateDomainIds:        ${anomalies.duplicateDomainIds.length}  (merged into first occurrence)\n`,
      );
    }
    if (anomalies.layerIdCollisions.length > 0) {
      process.stdout.write(
        `  layerIdCollisions:         ${anomalies.layerIdCollisions.length}  (domain id collided with layer id; dropped)\n`,
      );
    }
  }

  // Distribution-skew check, mirrors architecture-analyzer's pattern: if a
  // single domain owns >70% of layers, flag it as a quality concern. Not a
  // gate failure — the LLM may legitimately decide most layers belong to one
  // top-level domain (e.g. an analysis-heavy library).
  let maxDomainLayers = 0;
  let maxDomainId = "";
  for (const dom of result.domains) {
    if (dom.layerIds.length > maxDomainLayers) {
      maxDomainLayers = dom.layerIds.length;
      maxDomainId = dom.id;
    }
  }
  const skewRatio = result.layers.length > 0 ? maxDomainLayers / result.layers.length : 0;
  if (skewRatio > 0.7 && result.layers.length >= 4) {
    process.stdout.write(
      `\nDISTRIBUTION SKEW WARNING: ${maxDomainId} holds ${maxDomainLayers}/${result.layers.length} ` +
        `(${Math.round(skewRatio * 100)}%) of layers — LLM may have failed to differentiate the domains.\n`,
    );
  }

  // Smoke gate — mirrors architecture-analyzer's three-check pattern:
  //   1) `result.domains.length >= 2` rejects the degenerate "one giant
  //      domain swallowed everything" case (2 is the upstream lower bound
  //      on domain count).
  //   2) `layerAssignedSet.size === result.layers.length` confirms every
  //      layer surfaces in at least one domain (uses a SET so a duplicate
  //      assignment can't balance a missing one).
  //   3) `layerAppearances === result.layers.length` confirms NO layer
  //      appears in two domains — the uniqueness contract.
  //   4) `totalDomainFileCount === totalLayerFileCount` confirms the
  //      deterministic file expansion preserved the count (defense in
  //      depth — if a layer was duplicated, file counts would drift).
  //   Note: distribution skew does NOT fail the gate; the warning above
  //   surfaces partial-degeneracy for operator awareness.
  const allLayersAssignedOnce =
    layerAssignedSet.size === result.layers.length && layerAppearances === result.layers.length;
  const enoughDomains = result.domains.length >= 2;
  const fileCountPreserved = totalDomainFileCount === totalLayerFileCount;
  const ok = enoughDomains && allLayersAssignedOnce && fileCountPreserved;
  if (!ok) {
    process.stdout.write("\nsmoke gate FAILED:\n");
    if (!enoughDomains) {
      process.stdout.write(`  domains.length (${result.domains.length}) < 2 — degenerate output\n`);
    }
    if (layerAssignedSet.size !== result.layers.length) {
      process.stdout.write(
        `  ${result.layers.length - layerAssignedSet.size} layer(s) NOT assigned to any domain\n`,
      );
    }
    if (layerAppearances !== layerAssignedSet.size) {
      process.stdout.write(
        `  ${layerAppearances - layerAssignedSet.size} duplicate layer appearance(s) across domains — contract violation\n`,
      );
    }
    if (!fileCountPreserved) {
      process.stdout.write(
        `  total file count drift: layers=${totalLayerFileCount}, domains=${totalDomainFileCount}\n`,
      );
    }
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  process.stderr.write(`scan-with-domains failed: ${e.message}\n${e.stack ?? ""}\n`);
  process.exit(1);
});
