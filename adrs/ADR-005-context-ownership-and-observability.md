# ADR-005: Context ownership and observability

Status: Accepted
Date: 2026-05-06
Deciders: John Edge (CTO)
Supersedes: none

Note: This ADR was originally written using "Pi" as the platform name. Per ADR-009, the platform is renamed to Mirepoix; this ADR's architectural commitments are unchanged.

## Context

The single most consequential property of a coding-agent harness is what it does to the context window. Every byte the model sees was put there by someone — the operator, the harness, an extension, or the model's own previous output — and the rules by which the harness assembles those bytes determine whether the agent's behavior is predictable or mysterious. Mirepoix exists in part because we are unwilling to use harnesses where the rules are opaque or where the harness modifies the context behind our backs. The talk lists the specific failures we are reacting to: Claude Code injects system reminders into the context at unpredictable points and changes tool definitions between releases without notice; OpenCode auto-prunes tool output below a configurable threshold (lobotomizing the model in the process), feeds LSP diagnostics into the result of every Edit call (confusing the model into a write-check-write loop that humans do not perform), and stores session messages in a fan-out of JSON files on disk that is hard to inspect.

These are not isolated bugs. They are the outputs of a design philosophy in which the harness is a black box and the operator is a customer. We reject that philosophy. The harness is the operator's tool, and the operator is entitled to know exactly what it is doing.

## Decision

Mirepoix commits to the following observability and context-ownership properties as load-bearing invariants. Violating any of them requires a superseding ADR; they are not knobs to be quietly turned in a release.

The context is fully visible. At any point during a session the operator can ask the harness "what is in the context window right now" and receive the exact byte sequence that will be sent to the model on the next turn — the system prompt, the message history, the current tool definitions, in their current order. This is exposed via a `mirepoix context` slash-command and via a programmatic API that extensions can call. There is no "approximate" or "summarized" view; the answer is exact.

The context is fully reconstructible after the fact. Every session is persisted as a single, append-only event log on disk, in JSONL format, in `~/.local/share/mirepoix/sessions/<session-id>.jsonl`. The log records every event the harness emitted (see ADR-004) including the full prompt sent to the provider, the full response received, every tool call argument, every tool result, every error, and every extension lifecycle event. From the log alone, an auditor can reconstruct any state the session was in at any point. There is no separate database, no state file that diverges from the log. The log is the source of truth.

The harness does not silently inject content into the context. System reminders, scheduling hints, mid-conversation augmentations, tool-result decorations — none of these happen in the core. Extensions can inject content, but only by emitting events or by registering prompt fragments that go through the documented prompt-assembly pipeline, and the injection is visible in the session log when it happens. The operator is never surprised by content the model sees that the operator did not authorize.

Tool definitions are versioned and stable. The four base tools (ADR-002) have a definition that is committed to the repository and changes only via an ADR amendment. Extension tools are versioned to the extension that registers them, and the harness does not modify tool definitions between sessions or between releases without operator-visible changelog notes. We will not silently rename a tool, change its parameter schema, or swap its handler. The model's expectation of what a tool does is something we treat as a stability surface.

Tool output is not auto-pruned. The full stdout, stderr, and exit code of every tool call goes into the message history as the model returned it. If the operator wants pruning, summarization, or truncation, they install an extension that does it visibly — registering itself as a tool-result transformer, logging its decisions to the session log, and being identifiable in the context as the source of any compressed content. The default is fidelity, not compression. We are willing to spend tokens to keep the model's view of reality intact.

Compaction is explicit and auditable. When the message history approaches the model's context limit, a compaction strategy runs. The default strategy is documented in `@mirepoix/coding`, named, and emits a `session:compact` event with the before-and-after state in the payload. Operators can replace it via an extension. Compaction is not silent — the model sees a clear marker indicating that history was compacted, and the session log records the original messages that were dropped or summarized so an auditor can reconstruct what the model used to know.

The system prompt is open. It lives at `packages/mirepoix-coding/src/prompts/coding.md` as plain markdown. Operators read it before adopting Mirepoix. There is no obfuscation, no compiled-in prompt, no hidden preamble. Skills that get appended (markdown files in `skills/`) are also plain files on disk; the operator can list them, read them, and remove the ones they do not want. Nothing is appended to the prompt without the operator's repository or config saying so.

LSP diagnostics, type-check output, formatter output, and test results are not auto-injected into tool results. Extensions can subscribe to file-write events and run any of these on demand, surfacing the results as new messages to the operator or as new tool calls to the model, but the harness does not perform a behind-the-back write-check-write loop. The model is allowed to finish the task and check its own work — the way a human engineer does — rather than being interrupted after every edit.

## Consequences

The first consequence is that operators can trust the harness. The cost of a coding agent doing the wrong thing is high enough that "I'm not sure why it did that" is a failure mode we cannot tolerate. Full visibility into the context makes "why did it do that" an answerable question.

The second consequence is that we can debug the agent's behavior the same way we debug a deterministic system. Replay a session log against a model and we get the same trajectory (modulo model nondeterminism). Compare two session logs and we can see exactly where the harness made different decisions for the same input.

The third consequence is that we cannot make the model "smarter" by quietly enriching its context. Some harnesses do this and the user-visible result is a model that performs better on some tasks. We choose the trade-off in the other direction — we want the model's behavior to be a function of inputs we control, not of context-enrichment heuristics whose interactions are hard to predict.

The fourth consequence is that the session log is going to be large. A long session is megabytes of JSONL. We accept this. Disk is cheap, and the alternative — lossy persistence — undermines the core invariant. The log is gzip-friendly for archival and operators can rotate sessions however they like.

The fifth consequence is that we are committed to keeping the prompt-assembly pipeline simple enough that operators can read it and predict what it does. Every code path that contributes bytes to the context window is traceable from a single function. We will not let this code grow into a tangle of conditional injections and overrides, because if it does, the invariant is violated even if no specific injection is silent.

The sixth consequence is that we will sometimes underperform on benchmarks where harnesses that aggressively augment context win. We accept this. Benchmarks are not the goal; trustworthy operator-controlled agent execution is.

The seventh consequence is that the JSONL log format becomes a public interface — operators will write tools that consume it (and we will publish some ourselves). We commit to a stable, versioned schema for the log and to non-breaking changes within a major version.

## Alternatives considered

We considered allowing the harness to inject system reminders for "important" things — token budget warnings, missing tool warnings, deprecation notices. Rejected. If the information is important, it goes through a documented prompt-fragment that the operator can see and disable. If the information is not important, it does not belong in the context at all.

We considered auto-pruning tool output above a configurable token threshold, defaulting to off. Rejected for the default-on case (per OpenCode's choice), accepted in principle for the default-off case but pushed into an extension. The core does not auto-prune.

We considered injecting LSP diagnostics into Edit results, with a config flag. Rejected for both default and config-flag cases. Operators who want this write an extension that does it visibly. The core does not.

We considered a "smart context" mode that summarizes long histories on the fly. Rejected. Compaction is explicit, named, replaceable, and auditable. There is no smart mode that we hope works.

We considered a binary log format for sessions on the theory that JSONL is verbose and slow to parse. Rejected. JSONL is human-readable, append-only without round-trip serialization, and trivially streamable. Verbosity is acceptable when readability is the primary requirement.

## Implementation notes

The session log lives at `~/.local/share/mirepoix/sessions/<session-id>.jsonl`. Each line is a single event from the bus, with a timestamp, an event tag, and the typed payload. The schema is in `packages/mirepoix-core/src/events.ts` and is versioned via a `schemaVersion` field at the top of each session log file.

The `mirepoix context` slash-command renders the current context in two views: a structured view that shows the system prompt, skills, message history, and tool definitions as separate sections, and a raw view that shows the exact bytes that will be sent to the provider on the next turn. Both views are read-only.

The compaction strategy interface (`ExtensionApi.registerCompaction`) takes a function `(messages, budget) → CompactedHistory` and returns a structure that includes the new messages, a summary marker, and the dropped messages (so they can be persisted in the log). The default strategy is intentionally simple — keep the system prompt, the most recent N user messages, and a summary of the rest — and lives in `packages/mirepoix-coding/src/compaction/default.ts`.

A reference observability extension lives at `examples/observability-jsonl/` and demonstrates how to consume the session log for live tailing and offline analysis. Internally at Kavara we will run an aggregation extension that ships logs to a centralized store; that extension is not part of the open-source distribution.
