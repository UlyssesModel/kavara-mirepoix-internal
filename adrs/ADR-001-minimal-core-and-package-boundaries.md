# ADR-001: Minimal core and four-package decomposition

Status: Accepted
Date: 2026-05-06
Deciders: John Edge (CTO)
Supersedes: none

Note: This ADR was originally written using "Pi" as the platform name. Per ADR-009, the platform is renamed to Mirepoix; this ADR's architectural commitments are unchanged.

## Context

Mirepoix exists because we believe the harness is the operating system of an agent-driven engineering org and that the harnesses currently on the market — Claude Code, OpenCode, Amp, Factory, Cursor's agent loop — each fail one or more of our requirements around context ownership, observability, malleability, and predictability. Rather than fork one of them, we are building the smallest thing that meets our needs. The first decision the project has to make is how that thing is decomposed into packages, because the package boundary is the thing future contributors and future agents will respect or violate, and once it is wrong it is expensive to fix.

There are two natural failure modes for the decomposition. The first is over-decomposition: splitting concerns into so many packages that every change requires touching three of them, the type-system burden becomes its own problem, and the cognitive cost of holding the system in a single head is paid every day. The second is under-decomposition: a single package that conflates the model-API client, the agent loop, the tool surface, the CLI, and the persistence layer, and which can never be reused for a non-coding application without a hostile fork. Mario Zechner's Mirepoix sits at four packages, and the talk implies that this number is not arbitrary. We have stress-tested the proposal and reached the same conclusion.

## Decision

Mirepoix is decomposed into four packages, published independently to NPM under the `@mirepoix/*` scope, and developed in a single monorepo under `pnpm` workspaces.

`@mirepoix/ai` is the model-provider abstraction. It exposes a single interface — given a list of typed messages and a list of tool definitions, return either a text response or a tool call, with streaming and cancellation support. It owns the wire format for talking to model providers. It does not own anything about agents, tools, sessions, or context strategy. Its surface is small enough that it could be replaced by hand in a weekend.

`@mirepoix/core` is the agent loop. It owns the typed event bus, the session model, the tool dispatcher, the message history, and the `while`-loop that drives a session forward by calling the AI package, dispatching tool calls, and emitting lifecycle events. It does not know it is a coding agent. A team that wants to build a non-coding agent — a customer-support agent, a research agent, a deal-review agent — uses `@mirepoix/core` directly and writes its own skin.

`@mirepoix/coding` is the coding-agent skin. It depends on `@mirepoix/core` and `@mirepoix/ai`. It contributes the four base tools (bash, read, write, edit), the system prompt, the skills loader (markdown files in a `skills/` directory), and the default compaction strategy. Everything in this package is opinionated about coding work; nothing in this package is opinionated about how the agent loop runs.

`@mirepoix/cli` is the entry point. It depends on `@mirepoix/coding`. It owns argument parsing, the terminal UI, session persistence, extension discovery and loading, hot-reload watching, and the lifecycle of starting and stopping a session. It is replaceable by anyone who wants to embed Mirepoix in a different shell.

The dependency graph is strictly linear: `@mirepoix/cli` → `@mirepoix/coding` → `{@mirepoix/core, @mirepoix/ai}` and `@mirepoix/core` → `@mirepoix/ai`. There are no circular dependencies, no shared utility package, and no peer dependencies between the four. If a piece of code does not fit cleanly into one of these four packages, that is a signal to question the code, not to introduce a fifth package.

## Consequences

The consequence we want is reusability. `@mirepoix/core` becomes the foundation for any agent-shaped product Kavara ships, not just the coding agent. The consequence we accept is a slightly higher barrier to "just adding a feature" — every new capability has to find its home in one of the four packages, and that conversation can be uncomfortable. We treat that conversation as a feature, not a bug.

The consequence we explicitly want to avoid is that of a fifth package. If we find ourselves wanting a `@mirepoix/utils` or a `@mirepoix/shared` package, that is a signal that one of the four has grown a responsibility it should not have. The resolution is to push the responsibility back into the package that owns it, not to factor a shared library out.

A second consequence is that `@mirepoix/coding` becomes the place where most contention lives. It is the layer everyone touches: every tool, every prompt change, every default behavior. We accept this and plan to keep it small by aggressively pushing optional behavior into extensions. The talk makes this explicit: things that are not built in are not built in because the operator is expected to add them via extensions.

A third consequence is that the AI package's interface becomes a gate on what kinds of providers we can support. If Anthropic, OpenAI, Gemini, and local models all fit the same interface cleanly, the abstraction has paid for itself. If not, we will know early — Phase One ships against Anthropic only, and we will validate the abstraction by adding a second provider in Phase Four.

## Alternatives considered

We considered a single package. This is what most prototypes look like and it is what the Phase Zero spike will be. We rejected it for the production system because it forecloses non-coding reuse and because a single package tends to grow a `core/` directory that becomes the de-facto agent loop without the type discipline that comes from a separate published package.

We considered a five-package decomposition that split tools out into their own package, on the theory that the four base tools are a self-contained unit. We rejected it because the tool definitions are tightly coupled to the system prompt and the skills loader, which already live in `@mirepoix/coding`, and pulling them out adds a layer that does not pay for itself.

We considered a plugin-first decomposition where everything including the four base tools is an "extension" loaded by a near-empty core. This is what some research harnesses do. We rejected it because it makes the simple case (run Mirepoix against a repo) require configuration, and because the four base tools are stable enough that the abstraction overhead is unjustified. The talk takes the same position implicitly: the four tools are baked in, and everything else is an extension.

We considered following Claude Code's model of having the harness and the model provider tightly coupled. We rejected it because that coupling is the very thing we are leaving Claude Code to escape.

## Implementation notes

The monorepo uses `pnpm` workspaces. TypeScript builds emit ESM only. We do not publish CommonJS. The minimum supported runtime is whatever we pick in the runtime ADR — likely Bun for Phase Zero through Two, with Node compatibility validated before Phase One ships. Each package has its own README with a single worked example at the top; the agent reads READMEs more reliably than it reads source, and we want it to be able to bootstrap itself from package docs.

The line-count budget for the core, agreed at the time of this ADR, is five thousand lines across `@mirepoix/ai`, `@mirepoix/core`, and `@mirepoix/coding` combined at the end of Phase One. We treat the budget as load-bearing. If we cannot fit the system in five thousand lines, the system is wrong, not the budget.
