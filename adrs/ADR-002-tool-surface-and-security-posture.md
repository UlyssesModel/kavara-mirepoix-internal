# ADR-002: Tool surface and security posture

Status: Accepted
Date: 2026-05-06
Deciders: John Edge (CTO)
Supersedes: none

Note: This ADR was originally written using "Pi" as the platform name. Per ADR-009, the platform is renamed to Mirepoix; this ADR's architectural commitments are unchanged.

## Context

A coding agent's tool surface is the most consequential part of its design after the system prompt. Every tool the model sees is a piece of context that costs tokens, narrows the model's attention, and creates a code path that has to be maintained, tested, and reasoned about. Every tool the model does not see is a piece of work that has to flow through one of the tools that exist. The default in the industry is to add tools liberally — Claude Code ships with a tool for everything, OpenCode does the same, and the leaderboards show that this is not actually correlated with quality. Terminal-Bench's reference harness gives the model exactly two capabilities — send keystrokes to a `tmux` session and read its output — and routinely outscores feature-rich harnesses on the same model. The signal is unambiguous: the floor for coding-agent quality is roughly "give the model bash and let it cook."

The second concern is security. Agents can do enormous damage when given bash. The industry response is permission dialogs — "Allow `rm -rf`?" prompts that interrupt the model and require the operator to approve each dangerous command. We believe this is theater for almost everyone who uses it. An operator who has scrolled past three benign approvals will scroll past the fourth without reading it. Permission dialogs do not stop a confused model from destroying a working tree; they stop a thoughtful operator from feeling guilty when it happens.

## Decision

The base tool surface for `@mirepoix/coding` is exactly four tools: `bash`, `read`, `write`, and `edit`. Definitions are deliberately tiny — a one-line description, a small parameter schema, no exposition. The model is post-trained to know what these mean, and we will not waste tokens explaining them.

`bash` runs a shell command in the working directory and returns stdout, stderr, and exit code. There is no command allow-list. There is no permission dialog. Bash is unrestricted by default. The operator is expected to run Mirepoix inside a container, a sandbox, a virtual machine, an ephemeral cloud workspace, or a directory they are willing to lose. Mirepoix does not pretend to be a security boundary, because pretending to be a security boundary while not actually being one is worse than transparently delegating the responsibility.

`read` reads a file from disk and returns its contents. `write` writes content to a file path, creating it if needed and overwriting if not. `edit` performs a string-replacement edit against a file with an `old_string`/`new_string` pair. These three are the minimum kit for the model to navigate and modify a codebase, and they map directly to the operations a human engineer performs at the same level.

That is the entire base tool set. There is no `glob`, no `grep`, no `ls`, no `git`, no `web_search`, no `web_fetch`, no `mcp_*`, no `sub_agent`, no `plan`, no `todo`, no `notebook`, no `screenshot`, no `move`, no `delete`. Every one of these capabilities is reachable via `bash` (`rg`, `git`, `ls`, `mv`, `rm`, `curl`), and operators who want a typed wrapper for any of them can write an extension that adds it. The default position is no.

The system prompt is correspondingly minimal. The operator can read it in full in `packages/mirepoix-coding/src/prompts/coding.md` and it should never need a table of contents. The model is told it is a coding agent operating from a working directory, given a one-line summary of each tool, and told to ask before doing destructive things. That is the entire prompt. Skills (markdown files in a `skills/` directory) are appended to the prompt as context, and they are how operators teach Mirepoix about their codebase, conventions, and workflows. The base prompt does not grow.

## Consequences

The first consequence is that bash will, eventually, do something destructive. We accept this. The operator is responsible for the environment in which Mirepoix runs, and our documentation will be unambiguous about it: do not run Mirepoix against a working tree you are not willing to lose, do not run Mirepoix against a credential set you are not willing to rotate, do not run Mirepoix against a database you cannot recreate. The talk makes this explicit and we do not soften it: a permission dialog is not a security mechanism, and adding one would suggest that it was.

The second consequence is that the harness gets a smaller footprint in every dimension. Smaller prompt, smaller tool set, smaller code path, smaller maintenance burden. The model performs at least as well — Terminal-Bench is the existence proof — and possibly better, because the absence of overlapping tools means the model does not have to choose between two ways to do the same thing.

The third consequence is that we will be told, repeatedly, by people new to the project, that we should add a `glob` tool, or a `grep` tool, or a `git` tool. We will say no, and the conversation will be short, because the answer is in this ADR.

The fourth consequence is that operators who do want richer tools have a clean path: write an extension. The extension API surfaces a `registerTool` call that is identical in shape to the four base tools. There is no privilege difference between a base tool and an extension tool from the model's perspective. This makes the four-tool floor a true floor, not a ceiling.

The fifth consequence is that we make a different kind of mistake than the typical industry harness. The typical harness errs on the side of giving the model more capability than it needs and more guardrails than work. We err on the side of giving the model less capability than it needs and no guardrails at all, on the theory that a missing tool produces a visible failure (the model says "I cannot do X") while a misbehaving guardrail produces an invisible one (the model thinks it did X but the harness blocked it).

## Alternatives considered

We considered a richer base set including `glob`, `grep`, and `ls`. We rejected it because each of these is a one-liner in `bash` and the model does not need a typed wrapper for any of them. The Terminal-Bench data is decisive on this point.

We considered a permission system in the core, with operator-level policies (`bash:rm` requires confirmation, `bash:git push` requires confirmation, etc.). We rejected it for two reasons. First, it is a security boundary that does not hold up: the model will eventually find a way around it, and the operator will eventually approve everything by reflex. Second, the right place for this kind of policy is outside the harness — in the container, in the IAM layer, in the network egress rules, in the credential scope. Building it inside Mirepoix is putting it in the wrong place.

We considered shipping a tool for MCP servers in the core, on the theory that MCP is the coming standard. We rejected it because MCP is exactly the kind of capability that should be an extension, and because shipping it in the core would couple `@mirepoix/coding` to the MCP wire format and lifecycle in a way that we do not want to maintain. An MCP extension will exist; it will not be in the core.

We considered a "plan" tool as part of the base set, on the theory that planning before acting is good practice. We rejected it because it is a soft behavior that lives in the system prompt, not a tool the model calls. Operators who want a hard plan-mode write an extension.

We considered explicit `move` and `delete` tools instead of relying on `bash` for these. We rejected it because the model already understands `mv` and `rm`, and adding typed wrappers would be a tax on every interaction for a benefit that does not exist.

## Implementation notes

The base tools are defined in `packages/mirepoix-coding/src/tools/`, one file per tool. Each file exports a single `toolDefinition` and a single handler. Definitions are JSON-schema-typed against the AI provider's tool schema. Handlers are pure functions of `(args, context) → result` where `context` carries the working directory, the session id, and the event bus. Tool execution emits `tool:start` and `tool:end` events on the bus so that extensions and observability layers can hook in without modifying the tool itself.

The `bash` handler runs commands in a subshell with the session's working directory as `cwd`. It does not set timeouts in the core; an extension that wants timeouts adds them. It returns the full stdout, stderr, and exit code without truncation; an extension that wants truncation adds it. This is consistent with the context-ownership principle in ADR-005: the harness shows the model what actually happened and lets the operator decide how to summarize it.

The system prompt lives at `packages/mirepoix-coding/src/prompts/coding.md` and is committed as a single markdown file. Changes to it require an ADR amendment or a superseding ADR. We treat the prompt as a stability surface, not a knob to be turned every release.
