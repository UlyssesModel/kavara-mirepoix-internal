# @mirepoix/understand

Mirepoix-native port of the
[Understand-Anything](https://github.com/Lum1104/Understand-Anything) multi-
agent codebase comprehension pipeline. Drives the same nine-phase comprehension
flow as upstream but replaces the Claude Code Task-tool dispatch with
[@mirepoix/acp](../acp/) parallel sub-sessions against local Qwen, so the
whole pipeline runs without leaving the host. Output is a `KnowledgeGraph`
schema-compatible with the upstream React dashboard.

First building block of the
[Mirepoix Modernize](https://kavara.atlassian.net/wiki/spaces/PM1/pages/120979458)
product spec (PM1/120979458). The Modernize orchestrator composes
`runUnderstand` → `@mirepoix/port` → `@mirepoix/validate` to deliver a
language-modernized codebase plus a target-language knowledge graph.

## Public surface

### `runUnderstand(config) → Promise<KnowledgeGraph>`

```ts
import { runUnderstand } from "@mirepoix/understand";

const graph = await runUnderstand({
  repoPath: "/abs/path/to/legacy/repo",
  sourceLanguage: "Python",
  providerConfig: {
    url: "http://127.0.0.1:11434/v1",
    model: "qwen3-coder:30b",
  },
});
console.log(`${graph.nodes.length} nodes, ${graph.tour.length} tour steps`);
```

Composes the full pipeline (`scanWithGraph` in [`./src/orchestrator.ts`](./src/orchestrator.ts))
end-to-end:

1. **Deterministic scan** — `scan-project.mjs` + `extract-import-map.mjs` +
   Louvain batch assignment. Local subprocesses, no LLM.
2. **Project scanner** — single ACP session synthesizing the project narrative
   from README + manifests.
3. **File-analyzer fan-out** — N parallel ACP sessions (one per Louvain
   batch), each emitting `{summary, complexity}` per file.
4. **Architecture analyzer** — single session, identifies layers.
5. **Domain analyzer** — single session, maps layers to business domains.
6. **Assembler** — pure-function unified graph construction.
7. **Assemble-reviewer face-off** — two parallel reviewer sessions (per
   [ADR-013](../../adrs/ADR-013-codex-as-teammate.md)). Verdicts recorded in
   `meta.faceOffVerdicts.assemble`.
8. **Tour builder** — single session producing ~12 dependency-ordered steps.
9. **Graph-reviewer face-off** — two parallel reviewer sessions on the final
   graph-with-tour. Verdicts recorded in `meta.faceOffVerdicts.graph`.

The pipeline writes intermediate artifacts under
`<repoPath>/.understand-anything/intermediate/` (gitignored upstream and on
Mirepoix repos via `523b687`). The final `knowledge-graph.json` is at
`<repoPath>/.understand-anything/intermediate/knowledge-graph.json`.

### `UnderstandConfig`

```ts
export interface UnderstandConfig {
  /** Absolute path to the legacy codebase. */
  repoPath: string;

  /** Language being modernized FROM. Informational hint in v0 (the
   *  project-scanner derives languages from manifests); not yet threaded
   *  into the LLM phases. */
  sourceLanguage: Language;

  /** Optional: language being modernized TO. Informational hint in v0. */
  targetLanguage?: Language;

  /** Optional override for the @mirepoix/acp entry script path. Defaults to
   *  the workspace-relative entry resolved by AcpClient — leave undefined
   *  unless running outside the monorepo or testing against a fork. */
  acpEndpoint?: string;

  /** Provider config (typically local Qwen). */
  providerConfig: { url: string; model: string };

  /** Maximum concurrent ACP sessions for the file-analyzer fan-out. Defaults
   *  to 4 — empirically tuned for qwen3-coder:30b on a single A100. */
  maxConcurrency?: number;
}
```

`Language` is a Linguist name (`"Python"`, `"Rust"`, `"TypeScript"`, etc.).

### `KnowledgeGraph` (output shape)

See [`./src/types.ts`](./src/types.ts) for the full schema. Top-level fields:

| Field | Type | Notes |
|-------|------|-------|
| `project` | `{ name, description, rootPath, languages[], frameworks[], fileCount }` | From the narrative phase. |
| `nodes` | `GraphNode[]` | File / function / class / config / pipeline-step / document. |
| `edges` | `GraphEdge[]` | imports / calls / contains / depends_on / configures / documents / triggers / exports / related. |
| `layers` | `ArchitecturalLayer[]` | Every code file is in exactly one layer's `fileIds`. |
| `domains` | `BusinessDomain[]` | Every layer is in exactly one domain. Domain `fileIds` is the union of member layers' `fileIds`. |
| `tour` | `TourStep[]` | ~12 dependency-ordered steps. Each step has `title`, `description`, `primaryNodeIds`, `relatedNodeIds`. |
| `meta.faceOffVerdicts.assemble` | `FaceOffVerdict[]` | Two entries: `claude-reviewer` + `codex-adversarial`. Rendered against the assembled graph. |
| `meta.faceOffVerdicts.graph` | `FaceOffVerdict[]` | Two entries: `claude-graph-reviewer` + `codex-graph-adversarial`. Rendered against the final graph-with-tour. |

The v0 contract is "verdicts captured," not "verdicts converged" — a `block`
verdict surfaces the finding without preventing the graph from being returned.
Downstream callers (or humans) decide what to do.

### `extractPerModuleSummaries(graph)`

Stub. Slated for the α-3b track when `@mirepoix/port` lands and needs the
per-module port-prompt context this function builds from a `KnowledgeGraph`.

### `runUnderstandOnModernized(config)`

Alias for `runUnderstand`. Reserved for engagement-end reruns against the
target-language codebase that `@mirepoix/modernize` produces.

## CLI

```bash
mirepoix-understand <projectRoot> [concurrency]

# environment overrides:
OLLAMA_URL=http://127.0.0.1:11434/v1
MIREPOIX_MODEL=qwen3-coder:30b
ACP_ENTRY=/abs/path/to/acp/entry   # rare
```

Inside the monorepo, the same entry is reachable as:

```bash
bun packages/understand/src/bin/understand.ts <projectRoot> [concurrency]
```

`projectRoot` is resolved to an absolute path before invocation; `.` works.
`concurrency` must be a positive integer; any other value exits with `error: invalid concurrency` and status 2.

The CLI prints:

- Project narrative (`name`, `description`, `fileCount`, languages, frameworks).
- File-analyses coverage (`filesAnalyzed / filesTotal`, batches `succeeded [zero-yield count] / failed`).
- Node / edge / layer / domain / tour counts.
- Face-off verdict summary (both pairs) and per-verdict details (reviewer, verdict, duration, session id).
- Absolute path of the on-disk `knowledge-graph.json`.

Exit codes:

| Status | Meaning |
|--------|---------|
| `0` | Smoke gate passed. May still have partial file-analysis coverage loss — see warnings. |
| `1` | Smoke gate failed (zero counts, all batches failed, zero files analyzed across all ok batches, tour underpopulated, missing face-off verdict, empty notes). Also returned on missing `projectRoot` arg or runtime exception. |
| `2` | Invalid concurrency arg. |

Coverage degradation is **warning-only** by default — partial drops are
expected LLM noise (the file-analyzer's `BatchDropReport` captures the
categories). A stderr warning fires whenever `batchesFailed > 0` OR
`filesAnalyzed < filesTotal`. Total coverage loss (`filesAnalyzed === 0`)
flips this to a hard smoke-gate fail.

The CLI uses the orchestrator's `scanWithGraph` internally to surface
per-batch diagnostics that the public `Promise<KnowledgeGraph>` contract does
not yet carry. Programmatic consumers calling `runUnderstand` get the
`KnowledgeGraph` directly; reach into `./orchestrator` if you need the raw
per-batch outcome objects or coverage counts.

### Partial-pipeline debug bins

The `scan-with-*.ts` bins in [`./src/bin/`](./src/bin/) drive a prefix of
the pipeline and are useful when debugging a specific phase or driving a
partial pipeline from another package. They are not part of the public API
surface but they remain in-tree:

- `deterministic-scan.ts` — phases 1 only (no LLM).
- `scan-with-narrative.ts` — through the project-scanner.
- `scan-with-file-analyses.ts` — through the file-analyzer fan-out.
- `scan-with-architecture.ts` — through the architecture-analyzer.
- `scan-with-domains.ts` — through the domain-analyzer.
- `scan-with-assembler.ts` — through assembly + assemble-reviewer face-off.
- `scan-with-graph.ts` — full pipeline (same as `mirepoix-understand`).

## Local development

```bash
bun install                                                      # workspace install
bun x biome check --write packages/understand/                   # lint + format
(cd packages/understand && bun x tsc --noEmit)                   # package-scoped typecheck
bun packages/understand/src/bin/understand.ts <repoPath>         # CLI smoke
```

The pipeline expects a local Ollama instance at `OLLAMA_URL` with the
`MIREPOIX_MODEL` model loaded. On kavara-builder / scotty-gpu the default is
`qwen3-coder:30b` over loopback `http://127.0.0.1:11434/v1`.

## Stability

α-3a — public API frozen as `runUnderstand(config) → KnowledgeGraph`. The
internal orchestrator surface (`scanWith*` functions in
[`./src/orchestrator.ts`](./src/orchestrator.ts)) is not part of the public
contract and may consolidate in α-3b.

## ADRs

- [ADR-013 — Codex as teammate](../../adrs/ADR-013-codex-as-teammate.md)
  defines the in-product face-off review pattern this package bakes into the
  assembler + graph-reviewer phases.
