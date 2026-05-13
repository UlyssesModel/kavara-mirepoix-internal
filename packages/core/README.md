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
}
```

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

All 13 kernel events plus 1 synthetic logger header. Every JSONL line is
`{ ts: <ISO-8601>, event: <tag>, payload: <object> }`. The first line of every
log file is the header (tag `session:log-init`), which is **not** a member of
`MirepoixEvent` and need not be handled by consumers.

| Tag                    | Payload fields                                                            | Notes                                                              |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `session:log-init`     | `{}` (synthetic header)                                                   | Written once by `createSessionLogger`; not in union.               |
| `session:start`        | `{ id, systemPrompt, model, url, workingDir }`                            | Emitted once at `run` entry.                                       |
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

Payload keys are camelCase throughout (`messagesCount`, `resultPreview`,
`workingDir`) — a deliberate divergence from the spike's snake_case (NQ-4).

Known gap (NQ-13): `JSON.stringify(new Error(...))` yields `{}`, so the `error`
field in `bus:error`, `provider:error`, and `tool:error` JSONL lines round-trips
as an empty object. A future observability pass installs an `Error` replacer that
serializes `{ name, message, stack }`.

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
`createSessionLogger`, `schemaVersion`, `PACKAGE_NAME`) and the 13-arm
`MirepoixEvent` union are stable for sub-phase D. The surface is expected to
grow when `@mirepoix/cli` lands (sub-phase D adds env wiring and terminal
output) and again when a compaction sub-phase emits `session:compact` and
populates its payload.

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
! bun x tsc --noEmit -p packages/core/type-smoke/tsconfig-negative.json  # must fail
```

CI runs lint, all type-check steps, and the surface smoke automatically on
every push and PR via `.github/workflows/ci.yml`.
