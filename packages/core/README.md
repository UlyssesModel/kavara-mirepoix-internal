# @mirepoix/core

Runtime kernel of Mirepoix. This package owns the typed in-process event bus
(ADR-004), the `Session` model and JSONL append log (ADR-005), and the
tool-calling agent loop. It is the first package in the monorepo to carry a
cross-package dependency: `core → ai`. Explicitly out of scope for sub-phase C:
CLI argument parsing, environment variable reads, terminal output, system-prompt
loading, and context compaction — those land in sub-phase D and later.

## Public surface

| Export                | Kind     | Signature shape                                                  | Purpose                                              |
| --------------------- | -------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `Bus`                 | class    | `new Bus<E extends BaseEvent = MirepoixEvent>(opts?: BusOptions)` | Typed in-process event bus.                          |
| `Session`             | class    | `new Session(opts: SessionOptions)`                              | Owns id, system prompt, bus, message tape, turn counter. |
| `run`                 | function | `async (opts: RunOptions) => Promise<void>`                      | Drives the tool-calling agent loop.                  |
| `createSessionLogger` | function | `(bus: Bus<MirepoixEvent>, filePath: string) => () => void`      | Wires a bus to a JSONL append log; returns disposer. |
| `schemaVersion`       | const    | `"1" as const`                                                   | JSONL log schema version sentinel (ADR-005).         |
| `PACKAGE_NAME`        | const    | `"@mirepoix/core" as const`                                      | Identity sentinel.                                   |

Type-only re-exports (do not appear in `Object.keys`): `MirepoixEvent`,
`BaseEvent`, `EventTag`, `PayloadOf`, `SessionOptions`, `BusOptions`, `Handler`,
`Disposer`, `RunOptions`, `ProviderFn`.

### `Bus<E>`

```ts
export class Bus<E extends BaseEvent = MirepoixEvent> {
  constructor(options?: BusOptions);                           // slowHandlerMs default: 50
  on<T extends E["tag"]>(tag: T, handler: Handler<...>): Disposer;
  off<T extends E["tag"]>(tag: T, handler: Handler<...>): void;
  emit<T extends E["tag"]>(tag: T, payload: ...): void;        // sync; catches handler throws
  emitAsync<T extends E["tag"]>(tag: T, payload: ...): Promise<void>;
}
```

Handler throws are caught and re-emitted as `bus:error`; they never propagate to
the `emit` caller. Handlers that exceed `slowHandlerMs` trigger `bus:slow-handler`.
Both meta events suppress self-recursion.

### `Session`

```ts
export class Session {
  readonly id: string;
  readonly systemPrompt: string;
  readonly bus: Bus<MirepoixEvent>;
  readonly messages: Array<Record<string, unknown>>; // initialized with one system message
  turn: number;                                       // mutated by run()
  constructor(options: SessionOptions);               // no I/O in constructor
}
```

### `run`

```ts
export async function run(options: RunOptions): Promise<void>;

interface RunOptions {
  session: Session;
  userPrompt: string;
  providerConfig: ProviderConfig;          // from @mirepoix/ai
  tools: unknown[];                         // injected; opaque to core
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  maxTurns?: number;                        // default 30
  provider?: ProviderFn;                   // test seam; defaults to callProvider from @mirepoix/ai
  workingDir: string;                       // required; CLI-supplied (NQ-7 closed in sub-phase D)
  systemPromptFile: string | null;          // required; provenance for session:start (FR-005 / OQ-4)
}
```

`workingDir` and `systemPromptFile` are **required** as of sub-phase D. The CLI
threads its post-chdir working directory and the operator-supplied prompt path
(or `null` when the default in-package prompt is used) through every `run`
call. `core` reads no boundary state.

### `createSessionLogger`

```ts
export function createSessionLogger(
  bus: Bus<MirepoixEvent>,
  filePath: string,
): () => void;
```

Writes a synthetic header line `{ schemaVersion, ts, event: "session:log-init", payload: {} }`
then appends one `{ ts, event, payload }` line per emitted event using
`appendFileSync`. Does not create parent directories — the caller (CLI in
sub-phase D) is responsible for `mkdirSync({ recursive: true })`.

## Event vocabulary

All 20 kernel events plus 1 synthetic logger header. Every JSONL line is
`{ ts: <ISO-8601>, event: <tag>, payload: <object> }`. The first line of every
log file is the header (tag `session:log-init`), which is **not** a member of
`MirepoixEvent` and need not be handled by consumers.

| Tag                    | Payload fields                                                            | Notes                                                              |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `session:log-init`     | `{}` (synthetic header)                                                   | Written once by `createSessionLogger`; not in union.               |
| `session:start`        | `{ id, systemPrompt, systemPromptFile, model, url, workingDir }`          | Emitted once at `run` entry. `systemPromptFile` added in sub-phase D / FR-005 / OQ-4. |
| `session:end`          | `{ reason: "model_done" \| "max_turns", turns }`                          | Emitted exactly once per `run` call.                               |
| `session:compact`      | `{ before, after, strategy }`                                             | Forward-compat; not emitted by `run` in sub-phase C.               |
| `message:user`         | `{ content }`                                                             | Full user message pushed onto the tape.                            |
| `message:assistant`    | `{ role, content, tool_calls? }`                                          | `content` may be `null` when tool calls were rehydrated.           |
| `provider:request`     | `{ turn, messagesCount }`                                                 | About to call provider.                                            |
| `provider:response`    | `{ turn, message, rehydrated, rehydratedToolCalls? }`                     | Raw `AssistantMessage` preserved (ADR-005 reconstructability).     |
| `provider:error`       | `{ turn, error }`                                                         | Emitted before `run` rethrows. Loop aborts.                        |
| `tool:start`           | `{ name, args, callId }`                                                  | `callId` = provider-issued tool-call id.                           |
| `tool:end`             | `{ name, callId, resultPreview, resultLength }`                           | `resultPreview` is the first 200 chars of the result string.       |
| `tool:error`           | `{ name, callId, error }`                                                 | Only if `executeTool` throws; loop continues (NQ-9).               |
| `bus:error`            | `{ tag, error, handler? }`                                                | Handler containment surface (ADR-004).                             |
| `bus:slow-handler`     | `{ tag, durationMs, handler? }`                                           | Default threshold: 50 ms.                                          |
| `codex:dispatch`       | `{ dispatchId, phase, reason, command? }`                                 | Orchestrator dispatches a Codex teammate operation (ADR-013); `command` set on operator-direct (`phase: null`). |
| `codex:request`        | `{ dispatchId, model, prompt }`                                           | Outbound Codex API call; full prompt body per ADR-005 (no preview-truncation). |
| `codex:response`       | `{ dispatchId, response, durationMs, tokensIn?, tokensOut?, costUsd?, cacheHit? }` | Codex response back to harness; full body + optional usage telemetry. |
| `codex:verdict`        | `{ dispatchId, sourceVerdict, gateVerdict, body }`                        | Codex review verdict; `sourceVerdict` raw (approve / needs-attention), `gateVerdict` normalized (approve / block). |
| `codex:rescue-start`   | `{ dispatchId, prompt, filesAllowlist }`                                  | CODE retry-exhaust rescue dispatched; full prompt captured.        |
| `codex:rescue-end`     | `{ dispatchId, outcome, touchedFiles, durationMs, error? }`               | Rescue returns; `outcome` ∈ {applied, reverted-out-of-scope, reverted-gate-failed, rescue-error, timeout}; NQ-13 Error. |
| `codex:unavailable`    | `{ reason, details?, error?, retryAfterMs?, attempt?, maxAttempts? }`     | Pre-dispatch skip (RUNBOOK §4/§6); retry shape mirrors HTTP 429.   |

Payload keys are camelCase throughout (`messagesCount`, `resultPreview`,
`workingDir`) — a deliberate divergence from the spike's snake_case (NQ-4).

NQ-13 closed in sub-phase D: `log.ts` installs an `errorAwareReplacer` and
applies it to every `JSON.stringify` call. `bus:error`, `provider:error`, and
`tool:error` JSONL lines now round-trip with `{ name, message, stack,
...ownEnumerableProps }`. Stack traces may contain absolute paths; we accept
this trade-off — the session log is local-host and operator-controlled.

## Layering

`@mirepoix/core` depends on `@mirepoix/ai` only (the `core → ai` edge is the
first cross-package import in the monorepo; see ADR-001). `tools` and
`executeTool` are **dependency-injected** by the caller — core has no import from
`@mirepoix/coding`. The loop wraps `executeTool` to emit `tool:start`,
`tool:end`, and `tool:error` events, which means `@mirepoix/coding` gains no
bus dependency (OQ-7).

## Why provider config and tools are parameters

The Phase Zero spike reads `OLLAMA_URL` and `MIREPOIX_MODEL` from environment
variables at module top-level because it is a one-shot CLI script. A kernel
package must not hide configuration in side-effect globals: it becomes
untestable and violates ADR-001's leaf-package discipline (env reads belong in
`@mirepoix/cli`, sub-phase D). `run` therefore accepts `providerConfig` and an
injected `tools`/`executeTool` pair, and reads nothing from `process.env`.

This also keeps `core` reusable for non-coding agents. A future agent that uses
a different tool set threads its own `executeTool` into `run` without forking
the loop or adding a bus dependency to `@mirepoix/coding`. See plan.md OQ-1,
OQ-2, and OQ-7 for the full resolution record.

## Source of truth

Extracted from `phase-zero-spike/mirepoix-spike.ts` (byte-frozen until sub-phase D):

| File          | Spike lines                   | Content                                        |
| ------------- | ----------------------------- | ---------------------------------------------- |
| `src/log.ts`  | 86-91                         | `function log(...)` — the append-only JSONL writer shape. |
| *(in `@mirepoix/ai`)* | 175-238               | Context rehydration (`tryParseToolCallsFromContent`, `extractJsonObjects`). |
| `src/loop.ts` | 288-379                       | Main tool-calling loop; `log()` calls replaced by `bus.emit()`. |

## Stability

Sub-phase C surface. The six value exports (`Bus`, `Session`, `run`,
`createSessionLogger`, `schemaVersion`, `PACKAGE_NAME`) and the
`MirepoixEvent` union are stable. The union grew from 13 arms (sub-phase C)
to 20 arms (sub-phase codex-events: seven `codex:*` arms per ADR-013 Known
gaps §1; types + logger surface only, no dispatching code). The surface is
expected to grow again when a compaction sub-phase emits `session:compact`
and populates its payload, and when codex-dispatching code lands.

## Local development

Run from the repo root.

```bash
bun install                                              # install devDeps (once)
bun x biome ci .                                         # lint + format check
bun x biome check --write .                              # auto-fix lint (Biome 2.x)
bun x tsc --noEmit -p packages/core/tsconfig.json        # type-check this package
bun packages/core/type-smoke/surface.ts                  # public surface assertion
bun packages/core/type-smoke/bus-error.ts                # error-containment smoke
bun packages/core/type-smoke/bus-slow.ts                 # slow-handler smoke
bun packages/core/type-smoke/log-roundtrip.ts            # JSONL round-trip smoke
bun packages/core/type-smoke/loop-end-to-end.ts          # agent loop smoke
bun packages/core/type-smoke/codex-events.ts             # codex:* 7-arm round-trip smoke
! bun x tsc --noEmit -p packages/core/type-smoke/tsconfig-negative.json  # must fail
```

CI runs lint, all type-check steps, and the surface smoke automatically on
every push and PR via `.github/workflows/ci.yml`.
