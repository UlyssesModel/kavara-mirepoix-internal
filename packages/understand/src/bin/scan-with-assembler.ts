#!/usr/bin/env bun
// @mirepoix/understand — smoke-test CLI for the full pipeline through
// assembly + in-product face-off review.
//
// Usage:
//   bun packages/understand/src/bin/scan-with-assembler.ts <projectRoot> [concurrency]
//
// Runs deterministic scan → project-scanner LLM phase → parallel file-analyzer
// fan-out → architecture-analyzer → domain-analyzer → pure-function assembler
// → in-product face-off review (two parallel @mirepoix/acp sessions). The
// concurrency arg applies only to the file-analyzer fan-out; the face-off
// reviewer phase always runs N=2 in parallel. Override provider via
// OLLAMA_URL + MIREPOIX_MODEL env vars.

import { scanWithAssembler } from "../orchestrator";

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
    process.stderr.write("usage: scan-with-assembler <projectRoot> [concurrency]\n");
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
  const result = await scanWithAssembler(projectRoot, providerConfig, {
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
    faceOffOptions: {
      onStderr: (chunk) => process.stderr.write(`[acp] ${chunk}`),
    },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  const graph = result.graph;
  const fileNodeCount = graph.nodes.filter((n) => n.type === "file").length;
  const derivedNodeCount = graph.nodes.length - fileNodeCount;

  process.stdout.write(`
=== @mirepoix/understand scan-with-assembler ===
projectRoot:       ${projectRoot}
elapsed:           ${elapsed}s (wall-clock; fan-out parallel @ concurrency=${concurrency})
provider:          ${providerConfig.url} / ${providerConfig.model}
---
project:
  name:           ${graph.project.name}
  description:    ${graph.project.description}
  fileCount:      ${graph.project.fileCount}
  languages:      ${graph.project.languages.join(", ") || "(none)"}
  frameworks:     ${graph.project.frameworks.join(", ") || "(none)"}
---
nodes:             ${graph.nodes.length} (${fileNodeCount} file + ${derivedNodeCount} derived)
edges:             ${graph.edges.length}
layers:            ${graph.layers.length}
domains:           ${graph.domains.length}
---
assemble face-off review (${(result.faceOffElapsedMs / 1000).toFixed(1)}s parallel @ N=2):
`);
  for (const v of graph.meta.faceOffVerdicts.assemble) {
    process.stdout.write(
      `  - ${v.reviewer.padEnd(28)} ${v.verdict.toUpperCase()} (${v.durationMs}ms, session=${v.acpSessionId || "n/a"})\n`,
    );
  }
  process.stdout.write(`---
output: ${result.graphPath}
`);

  // Smoke gate — Commit 8's success criteria from the handoff (now applied to
  // the `assemble` slice of the split-by-phase verdict shape introduced in
  // Commit 9):
  //   1. Non-zero nodes / edges / layers / domains.
  //   2. Exactly 2 assemble face-off verdicts (claude-reviewer + codex-adversarial).
  //   3. Both verdicts populated with non-empty notes.
  //   4. `graph` slice is the empty array — this bin runs only the assemble
  //      face-off; the graph face-off is the territory of scan-with-graph.
  //   Verdicts may be APPROVE + APPROVE, APPROVE + BLOCK, or BLOCK + BLOCK —
  //   all are acceptable v0 outcomes; the contract is "verdicts captured,"
  //   not "verdicts converged."
  const verdicts = graph.meta.faceOffVerdicts.assemble;
  const graphVerdictsEmpty = graph.meta.faceOffVerdicts.graph.length === 0;
  const haveTwoVerdicts = verdicts.length === 2;
  const expectedReviewers = new Set(verdicts.map((v) => v.reviewer));
  const haveBothReviewers =
    expectedReviewers.has("claude-reviewer") && expectedReviewers.has("codex-adversarial");
  const allNotesPopulated = verdicts.every((v) => v.notes.trim().length > 0);
  const nonZero =
    graph.nodes.length > 0 &&
    graph.edges.length > 0 &&
    graph.layers.length > 0 &&
    graph.domains.length > 0;

  const ok =
    nonZero && haveTwoVerdicts && haveBothReviewers && allNotesPopulated && graphVerdictsEmpty;

  if (!ok) {
    process.stdout.write("\nsmoke gate FAILED:\n");
    if (!nonZero) {
      process.stdout.write(
        `  zero counts: nodes=${graph.nodes.length}, edges=${graph.edges.length}, layers=${graph.layers.length}, domains=${graph.domains.length}\n`,
      );
    }
    if (!haveTwoVerdicts) {
      process.stdout.write(`  expected 2 assemble face-off verdicts, got ${verdicts.length}\n`);
    }
    if (!haveBothReviewers) {
      process.stdout.write(
        `  missing reviewer identities: have [${[...expectedReviewers].join(", ")}]\n`,
      );
    }
    if (!allNotesPopulated) {
      process.stdout.write("  one or more verdicts has empty `notes` — audit trail incomplete\n");
    }
    if (!graphVerdictsEmpty) {
      process.stdout.write(
        `  graph face-off slice is not empty (got ${graph.meta.faceOffVerdicts.graph.length}) — scan-with-assembler should leave it untouched\n`,
      );
    }
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  process.stderr.write(`scan-with-assembler failed: ${e.message}\n${e.stack ?? ""}\n`);
  process.exit(1);
});
