# ADR-004: Event bus over hook-and-process model

Status: Accepted
Date: 2026-05-06
Deciders: John Edge (CTO)
Supersedes: none

Note: This ADR was originally written using "Pi" as the platform name. Per ADR-009, the platform is renamed to Mirepoix; this ADR's architectural commitments are unchanged.

## Context

The harness needs a way to let extensions and observability layers react to what is happening inside a session — a tool was called, the model returned a response, the session was compacted, the user typed a slash-command, an error occurred. Two design patterns dominate the industry. The first is a hook system in which the harness calls out to a configured shell command at well-defined lifecycle points, spawning a child process for each invocation. Claude Code is the prototypical example. The second is an in-process event bus, where listeners are functions registered against typed events and dispatch is a function call. Most modern application frameworks use the latter, and game engines have used it for forty years.

Mario's talk is direct on this point: hooks-as-subprocesses are inefficient and shallow. The number and depth of Claude Code's hooks is limited, and every fire spawns a process. We agree with the diagnosis. We have to make the call now, while the harness is small enough that we can choose freely, because retrofitting an event bus onto a hook-and-process system later is a near-rewrite.

## Decision

Mirepoix uses a typed in-process event bus, owned by `@mirepoix/core`, as the only mechanism through which the harness signals lifecycle and through which extensions react. There is no hook-and-process model. There is no shell-out for lifecycle events. Listeners are TypeScript functions registered against typed events and dispatched synchronously or asynchronously depending on the event signature.

The bus is implemented as a small module exporting a `Bus` class with `on(event, handler)`, `off(event, handler)`, `emit(event, payload)`, and `emitAsync(event, payload)` methods. Events are typed by a discriminated union: each event has a string tag and a typed payload, and the type system prevents listening for an event that does not exist or registering a handler whose signature does not match. The bus owns no state of its own beyond the listener registry.

The lifecycle events fired by the harness include the obvious ones — `session:start`, `session:end`, `session:compact`, `message:user`, `message:assistant`, `tool:call`, `tool:start`, `tool:end`, `tool:error`, `extension:load`, `extension:unload`, `provider:request`, `provider:response`, `provider:error`. The set is open: extensions can declare and emit their own events, and other extensions can listen for them. Custom events use namespaced tags (`my-extension:something-happened`) to prevent collisions.

The cost of an event with no listeners is one map lookup and one branch — effectively free. The cost of an event with N listeners is N function calls. There is no IPC, no serialization, no subprocess spawn, no environment variable threading, no exit-code parsing. We can fire events at every step of the agent loop, every chunk of streaming output, every line of tool stdout, without performance concern.

Listener errors are caught at the bus boundary and dispatched to a `bus:error` event. A handler that throws does not bring down the harness, does not interrupt other handlers for the same event, and does not corrupt the session. This is the one place where we deliberately add resilience inside the bus, because the alternative — propagating handler errors — makes a single bad extension the failure mode for the entire system.

For the rare case where an extension genuinely wants to spawn a subprocess on an event — for example, to invoke an external linter, run a CI hook, or post to a chat channel — that extension calls `child_process.spawn` itself inside its handler. The harness does not provide a built-in spawn-on-event capability because it would crystallize the wrong default. Subprocess work should be the exception, not the abstraction.

## Consequences

The first consequence is that we get an event system that is fast enough to use liberally. We can fire `tool:stdout-chunk` for every chunk of streaming tool output without thinking about cost, and extensions can build live dashboards, real-time logging, or telemetry pipelines on top of it without performance concern.

The second consequence is that extensions and the harness share a TypeScript runtime, which means handlers can hold typed references to the session, the message history, and the tool registry. This unlocks the kinds of extensions that a subprocess model cannot build — a context observer that maintains a running summary, a compaction strategy that depends on the live message history, a custom provider that swaps the model mid-session.

The third consequence is that the bus becomes a critical-path piece of code. We will read every line of it, test it thoroughly, and treat changes to its API as ADR-grade decisions. The good news is that it is a small piece of code — a few hundred lines including types — and the API surface is intentionally narrow.

The fourth consequence is that an extension can affect performance through poorly-written handlers. A handler that does heavy synchronous work blocks the agent loop. We mitigate this by documenting that handlers should be either fast and synchronous or async-and-non-blocking, by exposing both `emit` (synchronous fire-and-forget) and `emitAsync` (await all handlers) so the harness can choose where back-pressure matters, and by emitting `bus:slow-handler` events when a handler exceeds a configurable threshold. We do not enforce time limits inside the bus, because we trust the operator to write or audit the extensions running in their process.

The fifth consequence is that observability of the harness is a matter of subscribing to events. A logging extension that subscribes to all events and writes them to a JSONL file is twenty lines of code. We will ship that extension as a worked example.

The sixth consequence is that extensions cannot be written in languages other than TypeScript without a host extension that bridges the bus to a subprocess. If a Kavara team really needs a Python extension, they write a TypeScript extension that spawns a Python process and pipes events to it. We do not bake this into the core, for the same reason as ADR-003.

## Alternatives considered

We considered the hook-and-process model. Rejected for the reasons above — process overhead, lack of typed state sharing, shallow extensibility. The talk's critique is decisive.

We considered a hybrid model where some events use the in-process bus and others use subprocess hooks (perhaps a "shell hook" extension). Rejected because the bifurcation introduces complexity without addressing a real need, and because operators who want subprocess hooks can write them inside an extension that subscribes to the in-process bus.

We considered using Node's built-in `EventEmitter`. Rejected because it is untyped (or at best loosely typed via declaration merging), and because it has surprising semantics around error handling and listener limits. A purpose-built typed bus is a hundred lines of code and we will own it.

We considered an Observable/RxJS-style event stream. Rejected because the abstraction tax is steep — operators and the agent need to understand operators, subscriptions, and back-pressure semantics — and the benefit (composable streams) is overkill for the kinds of reactions we expect extensions to perform.

We considered an effect-system approach where listeners declare their effects and the harness orchestrates them. Rejected on the same grounds: the abstraction tax is steep, and the agent will write less reliable extensions in a paradigm it does not understand well.

We considered using WebSockets or Unix domain sockets to allow out-of-process listeners. Rejected for now — the use case is rare, and operators who need it can write a TypeScript extension that opens a socket and forwards events. We may revisit if there is real demand.

## Implementation notes

The bus lives in `packages/mirepoix-core/src/bus.ts`. The event type union lives alongside it in `packages/mirepoix-core/src/events.ts`. Adding a new core event is a one-line change to the union plus the call site that emits it; adding a custom event is something an extension does without modifying the core.

We will publish a worked example of an observability extension under `examples/observability-jsonl/` that subscribes to every core event and writes a JSONL log to disk. This example doubles as a smoke test for the bus's typing and as a piece of documentation for the agent to learn from when writing its own logging extensions.

The bus emits a `bus:slow-handler` event when a handler exceeds 50ms by default, configurable per session. The threshold is conservative to surface accidental blocking work early; we expect to tune it as we observe real usage.

Handler registration returns a disposer function. Extensions are expected to collect their disposers and clean them up in the `dispose` callback (see ADR-003), so that hot reload removes the listeners cleanly.
