#!/usr/bin/env bun
// @mirepoix/understand — canonical CLI entry point.
//
// Drives the full pipeline end-to-end and renders both the public artifact
// (KnowledgeGraph) and the per-batch diagnostics that `runUnderstand()`'s
// programmatic return type (`Promise<KnowledgeGraph>`) does not carry. This
// is what `mirepoix-understand` resolves to via the package's `bin` field —
// the canonical entry customers run.
//
// Implementation note: programmatic consumers (e.g. `@mirepoix/modernize`)
// import `runUnderstand` from the package root for the typed
// `Promise<KnowledgeGraph>` contract. The CLI uses `scanWithGraph` from the
// orchestrator directly so it can surface `filesAnalyzed/filesTotal` and
// `batchesSucceeded/batchesFailed` per the Commit-10 face-off finding.
// Stamping those counts into `KnowledgeGraph.meta` is α-3b scope (schema
// evolution).
//
// Usage:
//   bun packages/understand/src/bin/understand.ts <projectRoot> [concurrency]
//   mirepoix-understand <projectRoot> [concurrency]
//
// Environment overrides:
//   OLLAMA_URL        provider base URL (default http://127.0.0.1:11434/v1)
//   MIREPOIX_MODEL    model identifier (default qwen3-coder:30b)
//   ACP_ENTRY         absolute path to a @mirepoix/acp entry script (rare;
//                     defaults to the workspace-resolved entry)

import { resolve } from "node:path";

import { scanWithGraph } from "../orchestrator";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_MODEL = "qwen3-coder:30b";
const DEFAULT_CONCURRENCY = 4;

function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v?.trim() ? v : fallback;
}

async function main(): Promise<void> {
  const projectRootArg = process.argv[2];
  if (!projectRootArg) {
    process.stderr.write("usage: mirepoix-understand <projectRoot> [concurrency]\n");
    process.exit(1);
  }
  // Resolve to absolute — `UnderstandConfig.repoPath` and the assembler's
  // `project.rootPath` are documented as absolute. Callers passing "." get the
  // sensible-default behavior of "the current working directory" rather than
  // a literal "." propagating into the graph.
  const projectRoot = resolve(projectRootArg);

  const concurrencyArg = process.argv[3];
  let concurrency = DEFAULT_CONCURRENCY;
  if (concurrencyArg !== undefined) {
    const trimmed = concurrencyArg.trim();
    if (!/^[1-9]\d*$/.test(trimmed)) {
      process.stderr.write(
        `error: invalid concurrency '${concurrencyArg}' — must be a positive integer\n`,
      );
      process.exit(2);
    }
    concurrency = Number.parseInt(trimmed, 10);
  }

  const acpEntry = process.env.ACP_ENTRY?.trim() || undefined;
  const phaseOpts = acpEntry !== undefined ? { acpEntry } : {};
  const ollamaUrl = envOr("OLLAMA_URL", DEFAULT_OLLAMA_URL);
  const model = envOr("MIREPOIX_MODEL", DEFAULT_MODEL);

  const t0 = Date.now();
  const result = await scanWithGraph(
    projectRoot,
    { url: ollamaUrl, model },
    {
      concurrency,
      perBatch: phaseOpts,
      scannerOptions: phaseOpts,
      architectureOptions: phaseOpts,
      domainOptions: phaseOpts,
      faceOffOptions: phaseOpts,
      tourOptions: phaseOpts,
      graphReviewerOptions: phaseOpts,
    },
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  const graph = result.graph;
  const fileNodeCount = graph.nodes.filter((n) => n.type === "file").length;
  const derivedNodeCount = graph.nodes.length - fileNodeCount;
  // A batch is `ok=true` whenever the ACP transport completed without an
  // exception — it does NOT guarantee the LLM emitted usable per-file
  // analyses. Zero-yield-ok batches happen when the LLM emits zero file keys
  // or only keys that don't match the input set; the merge produces an empty
  // analyses map but the batch still counts as `ok`. Count those separately
  // so the summary line distinguishes transport-clean-but-empty from
  // transport-clean-and-productive.
  const zeroYieldOkBatches = result.batchOutcomes.filter(
    (o) => o.ok && (o.result?.fileCount ?? 0) === 0,
  ).length;
  const assembleVerdicts = graph.meta.faceOffVerdicts.assemble;
  const graphVerdicts = graph.meta.faceOffVerdicts.graph;

  const verdictLine = (v: { verdict: string }) => v.verdict.toUpperCase();
  const findV = (arr: typeof assembleVerdicts, reviewer: string) =>
    arr.find((v) => v.reviewer === reviewer);
  const assembleClaudeV = findV(assembleVerdicts, "claude-reviewer");
  const assembleCodexV = findV(assembleVerdicts, "codex-adversarial");
  const graphClaudeV = findV(graphVerdicts, "claude-graph-reviewer");
  const graphCodexV = findV(graphVerdicts, "codex-graph-adversarial");

  process.stdout.write(`
=== @mirepoix/understand ===
projectRoot:       ${projectRoot}
elapsed:           ${elapsed}s (wall-clock; fan-out parallel @ concurrency=${concurrency})
provider:          ${ollamaUrl} / ${model}
---
project:
  name:           ${graph.project.name}
  description:    ${graph.project.description}
  fileCount:      ${graph.project.fileCount}
  languages:      ${graph.project.languages.join(", ") || "(none)"}
  frameworks:     ${graph.project.frameworks.join(", ") || "(none)"}
---
file-analyses:       ${result.filesAnalyzed}/${result.filesTotal} files  (batches ${result.batchesSucceeded} ok${zeroYieldOkBatches > 0 ? ` [${zeroYieldOkBatches} zero-yield]` : ""} / ${result.batchesFailed} failed of ${result.batchesSucceeded + result.batchesFailed})
nodes:               ${graph.nodes.length} (${fileNodeCount} file + ${derivedNodeCount} derived)
edges:               ${graph.edges.length}
layers:              ${graph.layers.length}
domains:             ${graph.domains.length}
tour:                ${graph.tour.length} steps
face-off verdicts:
  assemble:           claude=${assembleClaudeV ? verdictLine(assembleClaudeV) : "MISSING"} codex=${assembleCodexV ? verdictLine(assembleCodexV) : "MISSING"}
  graph:              claude=${graphClaudeV ? verdictLine(graphClaudeV) : "MISSING"} codex=${graphCodexV ? verdictLine(graphCodexV) : "MISSING"}
output: ${result.graphPath}
`);

  process.stdout.write("verdict details:\n");
  for (const arr of [assembleVerdicts, graphVerdicts]) {
    for (const v of arr) {
      process.stdout.write(
        `  - ${v.reviewer.padEnd(28)} ${v.verdict.toUpperCase()} (${v.durationMs}ms, session=${v.acpSessionId || "n/a"})\n`,
      );
    }
  }

  // Warn whenever file-analysis coverage is degraded, whether the loss came
  // from whole-batch failures or from individual files being dropped during a
  // successful batch's merge (LLM emitted keys that did not match the input
  // set — see file-analyzer.ts's BatchDropReport).
  if (result.batchesFailed > 0 || result.filesAnalyzed < result.filesTotal) {
    const missing = result.filesTotal - result.filesAnalyzed;
    process.stderr.write(
      `\nwarning: file-analysis coverage degraded — ${result.filesAnalyzed}/${result.filesTotal} files (${missing} missing). ` +
        `Batches: ${result.batchesSucceeded} ok / ${result.batchesFailed} failed. ` +
        "Derived nodes/summaries for the missing files will be degraded.\n",
    );
  }

  const nonZero =
    graph.nodes.length > 0 &&
    graph.edges.length > 0 &&
    graph.layers.length > 0 &&
    graph.domains.length > 0;
  const allBatchesFailed = result.batchesSucceeded === 0 && result.batchesFailed > 0;
  // Total file-analysis loss is a hard fail regardless of batch transport
  // outcomes. Catches the case where every batch is `ok=true` but yields
  // zero analyses (LLM emitted no usable keys across the entire run).
  const zeroFilesAnalyzed = result.filesAnalyzed === 0 && result.filesTotal > 0;
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
    !allBatchesFailed &&
    !zeroFilesAnalyzed &&
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
    if (allBatchesFailed) {
      process.stdout.write(
        `  all ${result.batchesFailed} file-analyzer batch(es) failed — pipeline produced no per-file analyses\n`,
      );
    }
    if (zeroFilesAnalyzed && !allBatchesFailed) {
      process.stdout.write(
        `  zero files analyzed across all ${result.batchesSucceeded} ok batch(es) — LLM emitted no usable per-file analyses (${zeroYieldOkBatches} zero-yield batches)\n`,
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
  process.stderr.write(`mirepoix-understand failed: ${e.message}\n${e.stack ?? ""}\n`);
  process.exit(1);
});
