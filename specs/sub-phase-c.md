# Sub-phase C: Extract typed event bus, Session, and agent loop into @mirepoix/core

## Status

Phase: One. Sub-phase: C. Bootstrap mode: Claude Code via on-loop on Mac (per
the addendum to ADR-003).

## Context

Mirepoix is Kavara's TypeScript-first coding-agent harness. Sub-phase B
(PR #1) extracted the provider call into `@mirepoix/ai` and the four base tools
into `@mirepoix/coding`. Sub-phase B.1 (PR #2) added types/lint/CI tooling.
The Phase Zero spike at `phase-zero-spike/mirepoix-spike.ts` still owns the
session model, the JSONL log writer, the agent loop, and all event-emission
points (`log("session:start", …)`, `log("provider:request", …)`, etc.). It
remains byte-identical until sub-phase D retires it.

Sub-phase C builds the heart of the harness — the typed event bus from
ADR-004 and the session model + agent loop from ADR-005 — into the
already-scaffolded `@mirepoix/core` package. After this sub-phase, `core`
contains the runtime loop that any future Mirepoix product (coding,
research, deal-review) sits on top of. Coding-specific concerns (tools,
prompts, compaction) stay in `@mirepoix/coding`.

## Goal

Land four concerns inside `packages/core/src/`, leaving the spike untouched:

- A typed in-process event bus per ADR-004
- A typed event union covering the spike's existing event tags plus the bus
  internals
- A `Session` class that owns the message history, the bus instance, and
  optional log-writer subscription
- An agent loop `run(...)` function that drives a session forward by
  calling `@mirepoix/ai`'s `callProvider` + `normalizeAssistantMessage`,
  dispatching tool calls via an injected `executeTool`, and emitting bus
  events at every lifecycle point

Plus a small JSONL session-log writer that subscribes to the bus and
appends one line per event, per ADR-005.

## Concrete work

### Concern 1 → `packages/core/src/bus.ts`

A typed `Bus` class per ADR-004:

- `on(event, handler) → disposer` — register a handler; disposer removes it
- `off(event, handler)` — alternate removal path (parity with the ADR's
  documented surface)
- `emit(event, payload)` — synchronous fire-and-forget; returns nothing
- `emitAsync(event, payload) → Promise<void>` — await all async handlers
- `bus:error` event when any handler throws (caught at the bus boundary;
  one bad handler does not break the loop or the other handlers)
- `bus:slow-handler` event when a handler exceeds a threshold (ADR-004 says
  50ms default, configurable per session — the bus accepts a
  `slowHandlerMs` constructor option)

The bus is generic over the event union. Calling `on("does-not-exist", …)`
must fail at compile time. Adding a new event is a one-line union-arm change.

### Concern 2 → `packages/core/src/events.ts`

A discriminated-union type `MirepoixEvent` covering at minimum:

- `session:start`, `session:end`, `session:compact`
- `message:user`, `message:assistant`
- `provider:request`, `provider:response`, `provider:error`
- `tool:start`, `tool:end`, `tool:error`
- `bus:error`, `bus:slow-handler`

Each event has a string `tag` and a typed `payload`. The set is
**open** — the union uses an extensible base shape so extensions can
declare custom events with namespaced tags (`"my-extension:something"`)
without modifying the core. Sub-phase C exports the base shape; the
detailed extension API ships in a later sub-phase.

A `schemaVersion` literal (e.g. `"1"`) lives next to the union and is
written to the head of every session log file per ADR-005.

### Concern 3 → `packages/core/src/log.ts` (or `session-log.ts`)

A small JSONL session-log writer:

- `createSessionLogger(bus, filePath) → disposer` — subscribes to every
  event tag in the union and appends `{ ts, event, payload } + "\n"` to
  the file path. The log includes a one-line schema header on first
  write.
- Path is a parameter; **no env-var reads** in core. Env reads (e.g.
  `MIREPOIX_SESSION_DIR`) are the CLI's job (sub-phase D).
- The writer **does not** create directories above the path; the caller
  is responsible for `mkdirSync(dirname(filePath), { recursive: true })`.
  Keeps `core` filesystem-light. (The CLI handles ensuring the
  `~/.local/share/mirepoix/sessions/` directory exists.)

### Concern 4 → `packages/core/src/session.ts`

A `Session` class:

- Constructor takes `{ id, systemPrompt, slowHandlerMs? }`.
- Owns: `id` (string), `systemPrompt` (string), `messages` (array,
  initialized with the system message), `bus` (a fresh `Bus` instance),
  `turn` (number, starts 0).
- Exposes `messages` and `bus` as readable properties; mutation goes
  through the agent loop.
- No filesystem coupling. The log writer is a separate subscription, not
  a Session field — composes via `createSessionLogger(session.bus, path)`.

### Concern 5 → `packages/core/src/loop.ts`

An async `run` function with a single-object parameter shape:

```ts
run({
  session,
  userPrompt,
  providerConfig,    // { url, model } — passed to callProvider
  tools,             // unknown[] — provider tool definitions, from @mirepoix/coding
  executeTool,       // (name, args) => Promise<string> — from @mirepoix/coding
  maxTurns?,         // default 30 (matches the spike)
}): Promise<void>
```

Behavior must mirror the spike's main loop (lines 288-379) end-to-end:

1. Emit `session:start`. Push the user message; emit `message:user`.
2. For each turn up to `maxTurns`:
   - Emit `provider:request` with `{ turn, messagesCount }`.
   - Call `callProvider(messages, tools, providerConfig)`. On failure,
     emit `provider:error` and rethrow.
   - Call `normalizeAssistantMessage(msg, turn)` from `@mirepoix/ai`.
     If `rehydrated` is true, emit a `provider:response` event with a
     `rehydrated: true` flag in the payload.
   - Push the assistant message; emit `message:assistant`.
   - If there are tool calls: for each call, emit `tool:start` with
     `{ name, args }`, await `executeTool(name, args)`, emit `tool:end`
     with `{ name, resultPreview }` on success or `tool:error` on
     thrown exception (executeTool's contract is to return error
     strings, so `tool:error` here covers the vanishingly rare case
     where executeTool itself throws). Push a `tool` role message with
     the result. Continue the outer loop.
   - If no tool calls, emit `session:end` with `{ reason: "model_done",
     turns: turn + 1 }`. Break.
3. If the loop exhausts `maxTurns` without a model-done turn, emit
   `session:end` with `{ reason: "max_turns", turns: maxTurns }`. Do not
   throw.

The agent loop **does not** print to stdout. Output formatting is the
CLI's job (sub-phase D). Core only emits events; consumers decide how to
render them.

### Concern 6 → `packages/core/src/index.ts` (rewrite)

Public surface re-exports:

- `PACKAGE_NAME` (preserve `as const`)
- `Bus` class
- `Session` class
- `run` function
- `createSessionLogger` function
- `schemaVersion` constant
- Type re-exports: `MirepoixEvent` (and any subtype necessary for
  external listeners to type-guard against), `RunOptions`, `SessionOptions`

## Constraints

- **Spike frozen.** `phase-zero-spike/mirepoix-spike.ts` MUST NOT be
  modified. `git diff phase-zero-spike/` after the work must be empty.
- **No imports from `@mirepoix/coding`.** Per ADR-001 layering, `core`
  depends only on `@mirepoix/ai` (and `node:*` builtins). The agent
  loop receives `tools` and `executeTool` as parameters; it does not
  know they come from `coding`.
- **Imports from `@mirepoix/ai` are required.** The loop calls
  `callProvider` and `normalizeAssistantMessage`. This is the first
  cross-package import landed in the project (sub-phase B's leaves
  were independent).
- **No env-var reads inside `@mirepoix/core`.** All configuration is
  via constructor / function parameters. Env reads belong in the CLI.
- **No CLI work.** No argument parsing, no terminal UI, no
  `--system-prompt-file` or `--cwd` handling. Sub-phase D.
- **No compaction.** The `session:compact` event tag exists in the
  union for forward compatibility, but no compaction strategy ships
  here. If a session reaches `maxTurns`, it ends with
  `reason: "max_turns"` and the caller decides what to do.
- **No streaming, no cancellation.** The spike doesn't stream;
  preserve.
- **No tests beyond smoke tests.** No vitest/jest. Smoke commands stay
  as `bun -e` one-liners and short test scripts.
- **Use TypeScript** (`.ts`), strict mode, ESNext modules. No new tsconfig
  changes (B.1 already configured the toolchain).

## Success criteria

After the work, all of the following must hold:

1. `packages/core/src/index.ts` exports the public surface above.
   `PACKAGE_NAME` keeps `as const`.

2. The bus is type-checked: a `bun -e` snippet that creates a `Bus`,
   registers a typed handler against a known event, calls `emit`, and
   asserts the handler ran. Registering a handler against an unknown
   event tag must fail `tsc --noEmit`.

3. Bus error containment: registering a throwing handler must NOT crash
   the bus or affect other handlers. The bus must emit a `bus:error`
   event with the original event tag and error in the payload.

4. The session-log writer produces JSONL with a `schemaVersion` header
   line and one line per emitted event. Round-trip: write a few events,
   `JSON.parse` each line, assert structure.

5. The agent loop runs end-to-end against a stubbed provider (a
   `callProvider`-shaped function that returns canned responses):
   - One-shot: provider returns content with no tool calls →
     `session:start`, `provider:request`, `provider:response`,
     `message:assistant`, `session:end`.
   - Tool round-trip: provider returns a tool call, then content on the
     next turn → events fire in order including `tool:start`/`tool:end`.

6. `bun x tsc --noEmit -p packages/core/tsconfig.json` exits 0.

7. `bun x biome ci .` exits 0.

8. The CI workflow added in sub-phase B.1 still passes (the existing
   FR-001/002/003 smoke tests must continue to succeed; they don't
   depend on core, but the CI step `bun x tsc -p packages/core/...`
   would need to be added — see Open Questions).

9. `git status` after the work shows changes only inside
   `packages/core/`, plus possibly `.github/workflows/ci.yml` if a
   per-package tsc step is added (see OQ-3). No changes to
   `phase-zero-spike/`, `adrs/`, `specs/`, or `packages/{ai,coding,cli}/`.

## Non-goals (later sub-phases)

- CLI wiring, terminal UI, argument parsing — sub-phase D.
- Modifying or deleting the spike — sub-phase D.
- Compaction strategy — later in Phase One; lives in `@mirepoix/coding`
  per ADR-005.
- System-prompt extraction to `packages/coding/src/prompts/coding.md` —
  later in Phase One per ADR-005; sub-phase C accepts the prompt as a
  string parameter.
- Skills loader (markdown files in `skills/`) — Phase One, but a
  separate sub-phase.
- Streaming, cancellation, multi-provider — Phase One/Four.
- Extension API surface beyond "events are open for namespaced custom
  tags" — sub-phase later in Phase One.
- Hot reload of extensions — Phase Two.
- Path sandboxing, bash timeouts — out per ADR-002 default posture.

## Open questions

- **OQ-1 (system prompt loading):** does sub-phase C extract the spike's
  `DEFAULT_SYSTEM_PROMPT` to `packages/coding/src/prompts/coding.md`
  per ADR-005? *Suggested:* NO. Defer to a later sub-phase. The
  `Session` constructor takes `systemPrompt: string`; where it comes
  from is the caller's job.

- **OQ-2 (bus method surface):** does the bus expose both `on/off` AND
  a returned-disposer pattern, or just one? ADR-004 documents both.
  *Suggested:* both. Most users prefer the disposer; `off` exists for
  manual symmetry and is a five-line method.

- **OQ-3 (CI per-package tsc):** the B.1 workflow runs
  `tsc --noEmit -p packages/{ai,coding}/tsconfig.json`. Does sub-phase C
  add a third invocation for `packages/core/tsconfig.json`?
  *Suggested:* YES. Two-line addition to `.github/workflows/ci.yml`,
  inside the FR-010-equivalent allowlist for this sub-phase. Also add a
  matching smoke test for the core surface (`bun -e 'import * as core
  from "./packages/core/src/index.ts"; …'`).

- **OQ-4 (slow-handler timing under `emit`):** `emit` is sync
  fire-and-forget; measuring duration of a synchronous handler is
  trivial. For `emitAsync`, timing wraps the awaited promise.
  *Suggested:* both paths measure; both fire `bus:slow-handler` if
  threshold is exceeded.

- **OQ-5 (JSONL log atomicity):** the spike uses
  `appendFileSync({ flags: "a" })`. Multiple sessions writing to the
  same path is not a use case (each session has its own file).
  *Suggested:* `appendFileSync` is fine; no locking needed. Document
  the assumption.

- **OQ-6 (`message:user` / `message:assistant` payload shape):** does
  the payload include the full message object or just metadata?
  *Suggested:* full message object. ADR-005 ("the context is fully
  reconstructible") demands the log preserves enough state to replay.

- **OQ-7 (re-introduction of `tool:start`/`tool:end`/`tool:error`):**
  sub-phase B's coding agent dropped these from `executeTool` because
  logging was a sub-phase C concern. The agent loop in sub-phase C
  re-introduces them by *wrapping* `executeTool` calls — `coding` does
  not gain a bus dependency. *Suggested:* confirm this approach in the
  architect spec.

## Key references

- `phase-zero-spike/mirepoix-spike.ts` — source for the loop (lines
  288-379), the `log()` function (lines 86-91), and the event tag
  inventory (every `log("event:tag", …)` call site).
- `adrs/ADR-001-minimal-core-and-package-boundaries.md` — package
  boundaries, 5kloc budget, layering.
- `adrs/ADR-004-event-bus-over-hook-process-model.md` — bus surface
  contract, slow-handler threshold, error containment, disposer.
- `adrs/ADR-005-context-ownership-and-observability.md` — JSONL log
  invariants, schema versioning, no-silent-injection rule.
- `packages/ai/src/{provider.ts,rehydrate.ts}` — the upstream functions
  the loop calls (`callProvider`, `normalizeAssistantMessage`).
- `packages/coding/src/{tools.ts,execute.ts}` — what `tools` and
  `executeTool` look like at the call site (the loop receives these
  by parameter; it does not import them).
- `IMPLEMENTATION-PLAN.md` — Phase One scope including this work.
- `.on-loop/sessions/20260510_002707_sub-phase-b/agent-notes/coding.md`
  — TODO notes on `tool:*` event re-introduction.

## Deliverables

Files this sub-phase committed to the repository tree (backfilled retroactively
per `specs/harness-deliverable-tracking.md`; every path below is tracked on
`main` as of the harness-deliverable-tracking PR):

- `packages/core/src/bus.ts`
- `packages/core/src/events.ts`
- `packages/core/src/index.ts`
- `packages/core/src/log.ts`
- `packages/core/src/loop.ts`
- `packages/core/src/session.ts`
- `packages/core/type-smoke/bus-error.ts`
- `packages/core/type-smoke/bus-slow.ts`
- `packages/core/type-smoke/log-roundtrip.ts`
- `packages/core/type-smoke/loop-end-to-end.ts`
- `packages/core/type-smoke/surface.ts`
- `packages/core/type-smoke/unknown-tag.ts`
- `packages/core/type-smoke/tsconfig-negative.json`
- `packages/core/package.json`
- `packages/core/README.md`
- `.github/workflows/ci.yml`
- `bun.lock`
