#!/usr/bin/env bun
// @mirepoix/understand — smoke-test CLI for the full pipeline through
// assembly + assemble face-off + tour-builder + graph face-off.
//
// Usage:
//   bun packages/understand/src/bin/scan-with-graph.ts <projectRoot> [concurrency]
//
// Runs deterministic scan → project-scanner → file-analyzer fan-out →
// architecture-analyzer → domain-analyzer → assembler → assemble-reviewer
// face-off → tour-builder → graph-reviewer face-off. The concurrency arg
// applies only to the file-analyzer fan-out; both face-off pairs always run
// N=2 in parallel. Override provider via OLLAMA_URL + MIREPOIX_MODEL env vars.
//
// Smoke gate verifies:
//   1. Non-zero nodes / edges / layers / domains.
//   2. Populated tour with at least 5 steps (upstream minimum) and each step
//      has populated title + description + primaryNodeIds.
//   3. Both face-off arrays present: meta.faceOffVerdicts.assemble (2 entries)
//      AND meta.faceOffVerdicts.graph (2 entries).
//   4. All four verdicts have non-empty notes — audit trail integrity per
//      Commit 8's parseVerdict fail-closed contract.
//   Verdicts may be APPROVE / BLOCK in any combination — the v0 contract is
//   "verdicts captured," not "verdicts converged."

import { scanWithGraph } from "../orchestrator";

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
    process.stderr.write("usage: scan-with-graph <projectRoot> [concurrency]\n");
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
  const result = await scanWithGraph(projectRoot, providerConfig, {
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
    tourOptions: {
      onStderr: (chunk) => process.stderr.write(`[acp] ${chunk}`),
    },
    graphReviewerOptions: {
      onStderr: (chunk) => process.stderr.write(`[acp] ${chunk}`),
    },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  const graph = result.graph;
  const fileNodeCount = graph.nodes.filter((n) => n.type === "file").length;
  const derivedNodeCount = graph.nodes.length - fileNodeCount;
  const assembleVerdicts = graph.meta.faceOffVerdicts.assemble;
  const graphVerdicts = graph.meta.faceOffVerdicts.graph;

  const verdictLine = (v: { reviewer: string; verdict: string }) => v.verdict.toUpperCase();
  const findV = (arr: typeof assembleVerdicts, reviewer: string) =>
    arr.find((v) => v.reviewer === reviewer);
  const assembleClaudeV = findV(assembleVerdicts, "claude-reviewer");
  const assembleCodexV = findV(assembleVerdicts, "codex-adversarial");
  const graphClaudeV = findV(graphVerdicts, "claude-graph-reviewer");
  const graphCodexV = findV(graphVerdicts, "codex-graph-adversarial");

  process.stdout.write(`
=== @mirepoix/understand scan-with-graph ===
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
nodes:               ${graph.nodes.length} (${fileNodeCount} file + ${derivedNodeCount} derived)
edges:               ${graph.edges.length}
layers:              ${graph.layers.length}
domains:             ${graph.domains.length}
tour:                ${graph.tour.length} steps  (built in ${(result.tourElapsedMs / 1000).toFixed(1)}s)
face-off verdicts:
  assemble (Commit 8):  claude=${assembleClaudeV ? verdictLine(assembleClaudeV) : "MISSING"} codex=${assembleCodexV ? verdictLine(assembleCodexV) : "MISSING"}
  graph    (Commit 9):  claude=${graphClaudeV ? verdictLine(graphClaudeV) : "MISSING"} codex=${graphCodexV ? verdictLine(graphCodexV) : "MISSING"}
  assemble runtime:     ${(result.faceOffElapsedMs / 1000).toFixed(1)}s parallel @ N=2
  graph    runtime:     ${(result.graphFaceOffElapsedMs / 1000).toFixed(1)}s parallel @ N=2
output: ${result.graphPath}
`);

  // Per-verdict detail (session ids + durations) for trace-back.
  process.stdout.write("verdict details:\n");
  for (const arr of [assembleVerdicts, graphVerdicts]) {
    for (const v of arr) {
      process.stdout.write(
        `  - ${v.reviewer.padEnd(28)} ${v.verdict.toUpperCase()} (${v.durationMs}ms, session=${v.acpSessionId || "n/a"})\n`,
      );
    }
  }

  // Smoke gate per the Commit-9 handoff success criteria.
  const nonZero =
    graph.nodes.length > 0 &&
    graph.edges.length > 0 &&
    graph.layers.length > 0 &&
    graph.domains.length > 0;
  const tourPresent = graph.tour.length >= 5;
  const tourStepsPopulated = graph.tour.every(
    (s) =>
      s.title.trim().length > 0 &&
      s.description.trim().length > 0 &&
      s.primaryNodeIds.length > 0 &&
      Array.isArray(s.relatedNodeIds),
  );
  const haveTwoAssemble = assembleVerdicts.length === 2;
  const haveTwoGraph = graphVerdicts.length === 2;
  const assembleHasBothIdentities = !!assembleClaudeV && !!assembleCodexV;
  const graphHasBothIdentities = !!graphClaudeV && !!graphCodexV;
  const allNotesPopulated = [...assembleVerdicts, ...graphVerdicts].every(
    (v) => v.notes.trim().length > 0,
  );

  const ok =
    nonZero &&
    tourPresent &&
    tourStepsPopulated &&
    haveTwoAssemble &&
    haveTwoGraph &&
    assembleHasBothIdentities &&
    graphHasBothIdentities &&
    allNotesPopulated;

  if (!ok) {
    process.stdout.write("\nsmoke gate FAILED:\n");
    if (!nonZero) {
      process.stdout.write(
        `  zero counts: nodes=${graph.nodes.length}, edges=${graph.edges.length}, layers=${graph.layers.length}, domains=${graph.domains.length}\n`,
      );
    }
    if (!tourPresent) {
      process.stdout.write(
        `  tour has ${graph.tour.length} step(s) — expected at least 5 (upstream minimum)\n`,
      );
    }
    if (!tourStepsPopulated) {
      process.stdout.write(
        "  one or more tour steps is missing title / description / primaryNodeIds\n",
      );
    }
    if (!haveTwoAssemble) {
      process.stdout.write(
        `  expected 2 assemble face-off verdicts, got ${assembleVerdicts.length}\n`,
      );
    }
    if (!haveTwoGraph) {
      process.stdout.write(`  expected 2 graph face-off verdicts, got ${graphVerdicts.length}\n`);
    }
    if (!assembleHasBothIdentities) {
      process.stdout.write(
        `  assemble verdicts missing one of claude-reviewer / codex-adversarial: have [${assembleVerdicts.map((v) => v.reviewer).join(", ")}]\n`,
      );
    }
    if (!graphHasBothIdentities) {
      process.stdout.write(
        `  graph verdicts missing one of claude-graph-reviewer / codex-graph-adversarial: have [${graphVerdicts.map((v) => v.reviewer).join(", ")}]\n`,
      );
    }
    if (!allNotesPopulated) {
      process.stdout.write("  one or more verdicts has empty `notes` — audit trail incomplete\n");
    }
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  process.stderr.write(`scan-with-graph failed: ${e.message}\n${e.stack ?? ""}\n`);
  process.exit(1);
});
