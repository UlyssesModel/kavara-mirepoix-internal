# @mirepoix/cli

Mirepoix command-line entry. Wires `@mirepoix/coding` (tools, executor, default
system prompt) and `@mirepoix/core` (session, agent loop, JSONL logger) into a
single runnable per ADR-001's `cli → coding → {core, ai}` layering. After
sub-phase D, this package replaces `phase-zero-spike/mirepoix-spike.ts` as the
canonical execution surface. Sub-phase D.1 retires the spike on a green smoke.

## Public surface

| Export         | Kind     | Signature shape                                  | Purpose                                            |
| -------------- | -------- | ------------------------------------------------ | -------------------------------------------------- |
| `main`         | function | `(argv?: string[]) => Promise<number>`           | CLI entry. Returns an exit code; the top-level invocation at the bottom of `src/index.ts` translates it via `process.exit`. |
| `PACKAGE_NAME` | const    | `"@mirepoix/cli" as const`                       | Identity sentinel.                                 |

`Object.keys(import("@mirepoix/cli"))` sorted is `["PACKAGE_NAME", "main"]`.

### `main(argv?)`

```ts
export async function main(argv?: string[]): Promise<number>;
```

When `argv` is `undefined`, `main` reads `process.argv.slice(2)`. Tests pass an
explicit array (FR-013). Return value is the intended exit code.

## CLI usage

```sh
mirepoix [--system-prompt-file=PATH] [--cwd=PATH] <prompt>
# or, during development without `bun install`'s bin materialization:
bun packages/cli/src/index.ts [--system-prompt-file=PATH] [--cwd=PATH] <prompt>
```

### Flags

| Flag                          | Effect                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--system-prompt-file=PATH`   | Load the system prompt from `PATH` instead of `@mirepoix/coding`'s `prompts/coding.md`. Path is read synchronously at startup. |
| `--cwd=PATH`                  | `process.chdir(resolve(PATH))` before any I/O. **Fails fast** with exit code 1 if the path does not exist (NQ-D-6).            |

Everything else is concatenated with `" "` as the positional user prompt. An
empty prompt prints usage to stderr and exits 1.

### Environment variables

| Variable                | Default                                                | Purpose                                          |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| `OLLAMA_URL`            | `http://127.0.0.1:11434/v1`                            | OpenAI-compatible provider endpoint.             |
| `MIREPOIX_MODEL`        | `qwen2.5-coder:32b-instruct`                           | Provider model name.                             |
| `MIREPOIX_SESSION_DIR`  | `${homedir()}/.local/share/mirepoix/sessions`          | Directory for JSONL session logs.                |

These are the only `process.env` reads in the project; `@mirepoix/{ai,coding,core}`
read no environment state (FR-011 layering).

### Exit codes

| Code | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| 0    | Run completed normally (`session:end` with `reason: "model_done"` or `"max_turns"`). |
| 1    | Usage error (no prompt), missing `--cwd` path, unreadable `--system-prompt-file`, or `run(...)` threw. |

## Bootstrap-line format

`main()` prints two stdout lines before invoking `run(...)`, matching the Phase
Zero spike (line 293):

```
[mirepoix] session <sessionId> model <model>
[user] <userPrompt>
```

And one line on success (matching spike line 381):

```
[mirepoix] session log: <sessionLogPath>
```

## Stdout renderer

The CLI subscribes to four bus events per NQ-D-10 and writes human-readable
lines. The set deliberately omits `message:assistant`: the renderer subscribes
to `provider:response` instead, which carries the `rehydrated` flag directly
and avoids cross-event state.

| Event                  | Stdout line                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `tool:start`           | `\n[tool:<name>] <JSON.stringify(args).slice(0, 200)>`                   |
| `tool:end`             | `[result] <resultPreview>` (with `"..."` suffix when `resultLength > resultPreview.length`) |
| `tool:error`           | `[error] <error.message>`                                                |
| `provider:response`    | `[mirepoix] rehydrated N tool call(s) from content` when `payload.rehydrated`; final assistant content `\n[mirepoix] <content>` when `tool_calls` is empty and `content` is non-null. |

The `tool:end.resultPreview` field is capped at 200 chars by
`@mirepoix/core`'s `TOOL_RESULT_PREVIEW_CHARS`; the spike printed up to
400 chars. This is a small visible regression in D (NQ-D-7); the JSONL log
carries the full `resultLength` so the truncation extent is preserved, and the
model's view is unchanged (the full result goes back via the tool message).

`console.log` and `console.error` are allowed in `@mirepoix/cli` only;
`@mirepoix/{ai,coding,core}` are grep-clean of `console.*` per FR-011.

## Security posture

Per ADR-002 (and OQ-3 / Sec-001), bash is unrestricted:
`executeTool("bash", { command })` passes the model-provided string to
`spawn("bash", ["-c", command])` with no allowlist, sandbox, timeout, or
permission prompt. `--cwd` is operator convenience for setting the working
directory — **it is not a security boundary**. The operator runs Mirepoix
inside a container, VM, or directory they are willing to lose.

The error-aware JSONL replacer installed in sub-phase D (FR-004) serializes
`Error.stack` to the log. Stack traces may contain absolute file paths; we
accept this (Sec-004). Operators control who sees the session log.

The CLI does not redact stack traces, does not sandbox `--system-prompt-file`
reads, and does not auto-create missing `--cwd` paths.

## Sub-phase D notes

- The CLI lists both `@mirepoix/coding` and `@mirepoix/core` in
  `dependencies` (NQ-D-2). `@mirepoix/ai` is not listed — the CLI reaches it
  only via `RunOptions.providerConfig`'s structural type.
- `process.chdir` is called once, before the JSONL logger's `mkdirSync` (NQ-D-5).
- No `SIGINT` handler is installed in D (NQ-D-12).
- The top-level invocation uses `if (import.meta.main)` (NQ-D-9). The
  fallback `fileURLToPath`-based guard is also acceptable on Node.

## Source of truth

Extracted from `phase-zero-spike/mirepoix-spike.ts` (byte-frozen until
sub-phase D.1):

| File                            | Spike lines                                                       |
| ------------------------------- | ----------------------------------------------------------------- |
| `src/argv.ts`                   | 62-74 (flag parsing + positional accumulation)                    |
| `src/main.ts` env reads         | 41-44 (`OLLAMA_URL`, `MIREPOIX_MODEL`, `MIREPOIX_SESSION_DIR`)    |
| `src/main.ts` session id        | 45 (`new Date().toISOString().replace(/[:.]/g, "-")`)            |
| `src/main.ts` mkdir + log path  | 43-46, 84                                                         |
| `src/main.ts` chdir             | 80-82                                                             |
| `src/main.ts` bootstrap line    | 293                                                               |
| `src/main.ts` session-log line  | 381                                                               |
| `src/render.ts`                 | 360, 364, 366, 376                                                |

The default system prompt (spike lines 48-59) moved to
`packages/coding/src/prompts/coding.md` in sub-phase D; the spike's inline
copy stays put until D.1.

## Stability

Sub-phase D surface. The two value exports (`PACKAGE_NAME`, `main`) are
stable for D.1 (spike retirement). Sub-phase E may add a SIGINT handler
(NQ-D-12 deferral) and widen `TOOL_RESULT_PREVIEW_CHARS` (NQ-D-7 carry-forward).

## Local development

Run from the repo root.

```sh
bun install                                              # install workspace deps
bun x biome ci .                                         # lint + format check
bun x tsc --noEmit -p packages/cli/tsconfig.json         # type-check this package
bun packages/cli/type-smoke/surface.ts                   # public surface assertion
bun packages/cli/type-smoke/main-stub-provider.ts        # end-to-end smoke (stub provider)
! bun x tsc --noEmit -p packages/cli/type-smoke/tsconfig-negative.json  # must fail
```

CI runs lint, all type-check steps, and the surface smoke automatically on
every push and PR via `.github/workflows/ci.yml`.
