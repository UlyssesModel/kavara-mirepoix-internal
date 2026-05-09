# ADR-003: Extension model and self-modification

Status: Accepted
Date: 2026-05-06
Deciders: John Edge (CTO)
Supersedes: none

Note: This ADR was originally written using "Pi" as the platform name. Per ADR-009, the platform is renamed to Mirepoix; this ADR's architectural commitments are unchanged.

## Context

Mirepoix commits to a deliberately small core in ADR-001 and a deliberately small tool surface in ADR-002. This is only viable if the path from "I want a feature" to "I have a feature" is short, typed, and reachable both by humans and by the agent itself. The extension model is the mechanism by which the small core stays small — every capability that is not in the core has to live somewhere, and that somewhere has to be accessible enough that operators reach for it instead of pushing back on the core's minimalism.

The industry has converged on two failure modes here. The first is the marketplace: a curated extension store with a vendor in the loop, a review process, a discoverability layer, and an installation flow. This has the shape of an app store and inherits all of its problems — slow updates, vendor capture, a long tail of unmaintained extensions, and a bias toward extensions that fit the reviewer's mental model rather than the operator's. The second is the hook system: a fixed set of lifecycle points where the harness will spawn a child process and run a script. Claude Code is here. The cost is real — every hook fires a process, the script's environment is whatever the OS gives it, and the extension cannot share state with the harness in any structured way.

We reject both. Mirepoix's extension model treats extensions as first-class TypeScript modules loaded into the harness process, with a typed API, hot reload, and the same level of access that the core has. Distribution is NPM and GitHub. The agent itself can write extensions during a session.

## Decision

An extension is a TypeScript module that exports a single `extension` function with the signature `(api: ExtensionApi) => void | Promise<void>`. The module is loaded by file path (an absolute or relative path on disk) or by NPM package name, configured in a per-user or per-repo config file. The module is imported into the harness process — not spawned as a subprocess — and runs with the same Node/Bun-level access that the harness has.

The `ExtensionApi` is a typed interface exposed by `@mirepoix/core` and re-exported through `@mirepoix/coding` and `@mirepoix/cli`. It surfaces methods to register tools (`registerTool`), prompts (`registerPrompt` for system-prompt fragments), shortcuts (`registerShortcut` for slash-commands and keybindings), event listeners (`on(event, handler)` against the typed event bus from ADR-004), providers (`registerProvider` for alternate AI backends), and compaction strategies (`registerCompaction`). It also exposes a `session` handle that gives the extension scoped read/write access to the current session — its message history, its working directory, its persisted state — and a `bus` handle for emitting custom events.

Extensions are loaded at session start and again on file-system change. Hot reload is the default behavior, not an opt-in. When a watched extension file changes, the harness disposes of the previous extension instance (calling its `dispose` callback if it registered one), re-imports the module, and re-runs `extension(api)`. The session continues without restart. Tools and prompts that were registered by the previous instance are removed; tools and prompts registered by the new instance are added. Hot reload during a live session is a primary use case, not a developer-experience nicety. We borrow this directly from game development, where iteration speed at runtime is the difference between a feature shipping and a feature getting cut.

There is no isolation between extensions and the harness. An extension can crash the process, corrupt the session, or modify global state. We accept this, because the alternative — a sandboxed extension model — adds substantial complexity for a benefit that is theatrical given that extensions are running on the operator's machine alongside their working tree. Operators who want isolation run Mirepoix in a container.

The agent can write extensions. Mirepoix ships, in its own repository, the `ExtensionApi` documentation in a form the model can read — a single markdown file at `packages/mirepoix-coding/src/skills/writing-extensions.md` with the API surface, three or four worked examples (a tool, an event listener, a slash-command, a compaction strategy), and the conventions for placing the file on disk. When an operator says "Mirepoix, add a feature that does X," the model reads this file, writes a TypeScript module that registers the feature, places it under the user's extension directory, and the file watcher hot-reloads it. The feature is usable in the same session. This is the single feature of Mirepoix that compounds — every other harness ages, Mirepoix gets younger with every session because it can grow the surface it needs.

Distribution is NPM and GitHub. There is no marketplace. There is no curation layer. There is no Kavara-controlled registry. An operator who wants to share an extension publishes it to NPM. An operator who wants to find an extension uses NPM search, or our small CLI helper that wraps NPM search with a topic filter (`mirepoix-extension-*`). We will not build a discoverability layer beyond that helper, because the work-to-value ratio is bad and the failure modes (vendor capture, gating, low-quality long tail) are well-understood.

## Consequences

The first and intended consequence is that the core stays small. The pressure to add capabilities to `@mirepoix/coding` evaporates when the operator can write the capability in twenty lines of TypeScript and have it loaded in the next session.

The second consequence is that operators are exposed to TypeScript. We accept this. The audience for Mirepoix at Kavara is engineers who already write TypeScript, and the API is simple enough that an operator who has not written TypeScript can ask Mirepoix to write the extension and learn from the result. The talk makes this point explicitly: "you don't write a Mirepoix extension, you tell Mirepoix to write it for you."

The third consequence is that the harness process is exposed to misbehaving extensions. An extension can leak memory, hold the event loop, or throw inside an event handler. We mitigate this with two patterns: extensions register a `dispose` callback that the harness calls during hot reload or session end, and the event bus catches and logs handler errors instead of letting them propagate. We do not sandbox.

The fourth consequence is that we are committed to keeping the `ExtensionApi` stable. Breaking changes to the API break every extension in the ecosystem, and we have stronger incentives than most to take backwards compatibility seriously. We will version the API explicitly and require extensions to declare the API version they target; mismatch produces a clear error rather than mysterious failure.

The fifth consequence is that the agent's ability to write extensions becomes the leading indicator of Mirepoix's quality. If the model cannot reliably write a working extension from the documentation, either the documentation is wrong, the API is wrong, or the model has a problem we need to mitigate at the prompt level. We will treat low extension-write success rate as a P0 and instrument the rate from Phase Three onward.

The sixth consequence is that bad extensions will exist in the NPM ecosystem and we will not curate them out. We accept this in exchange for not building a curation layer. Operators who care can pin to specific versions, fork, or write their own.

## Alternatives considered

We considered a marketplace with curation. Rejected for the reasons above — vendor capture, slow updates, a curation layer that costs more to maintain than it saves operators, and a class of failures that does not exist in the NPM model.

We considered a hook-and-process model in the style of Claude Code. Rejected because the cost of process spawning is real at the rate at which we want to fire events, and because subprocess hooks cannot share typed state with the harness, which forecloses the most useful kinds of extension. ADR-004 covers this in more detail.

We considered a manifest-driven model where extensions declare their hooks in JSON and the harness loads them into a sandbox. Rejected because it adds a serialization boundary that the TypeScript module model does not have, and because the sandbox is theater (extensions run on the operator's machine).

We considered a WASM extension model on the theory that it would let extensions be written in any language and would provide isolation. Rejected because the benefit is small (we expect operators to write TypeScript, and the agent definitely writes TypeScript), and because the cost is high (a WASI host, a serialization layer for tool calls, a build step for every extension). We may revisit if there is real demand from outside Kavara, but it is not on the roadmap.

We considered allowing extensions written in shell, Python, or other languages by spawning a subprocess. Rejected for the same reason as the hook model — process overhead and the inability to share typed state.

## Implementation notes

The `ExtensionApi` interface lives in `packages/mirepoix-core/src/extension-api.ts`. Tool, prompt, shortcut, event, provider, and compaction registrations are tracked per-extension so that `dispose` and hot-reload can clean them up cleanly. Hot reload uses a file watcher (`chokidar` or the runtime's native watcher) on the configured extension paths, debounced at 100ms.

The agent-facing documentation for writing extensions lives in `packages/mirepoix-coding/src/skills/writing-extensions.md` and is appended to the system prompt as part of the skills loader. We expect this file to be longer than the system prompt itself, and that is fine — skills are how we teach the model about specific things without bloating the base prompt.

The CLI ships a `mirepoix extensions search <query>` command that wraps `npm search keywords:mirepoix-extension <query>`. We standardize on the `mirepoix-extension` keyword so that NPM's existing infrastructure does the discoverability work for us. Operators who want a richer search write an extension.

The default user extension directory is `~/.config/mirepoix/extensions/` on Linux/macOS and the equivalent under `XDG_CONFIG_HOME`. Per-repo extensions live in `.mirepoix/extensions/` at the repo root. Both are watched. Both compose — repo-local extensions can override or extend user-level ones.
