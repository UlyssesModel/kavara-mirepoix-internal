# Sub-phase B: Extract provider abstraction and base tools from the Phase Zero spike

## Status

Phase: One. Sub-phase: B. Bootstrap mode: Claude Code via on-loop on Mac (per the
addendum to ADR-003 — Phase One bootstrap is Claude-assisted; sub-phase E onward
is self-modification via Mirepoix on the locked host).

## Context

Mirepoix is Kavara's TypeScript-first coding agent harness. Architectural spine:

- **ADR-001** — four packages (`@mirepoix/{ai,core,coding,cli}`), <5kloc core budget
- **ADR-002** — four base tools (bash/read/write/edit), bash unrestricted, no permission dialogs
- **ADR-004** — typed in-process event bus, never hook-spawn-process
- **ADR-005** — full context visibility, JSONL session log as source of truth

The Phase Zero spike at `phase-zero-spike/mirepoix-spike.ts` is a single-file harness (~280 lines)
that validates the architecture end-to-end. It runs on scotty-gpu against Qwen2.5-Coder-32B-Instruct
served by local Ollama, both under open egress and under deny-all-egress lockdown. Sub-phase A
scaffolded the four package directories with placeholder `index.ts` files. Sub-phase B starts the
actual extraction.

## Goal

Extract two concerns from `phase-zero-spike/mirepoix-spike.ts` into the proper packages, with the
spike preserved untouched so it remains the working harness until sub-phase D retires it.

### Concern 1 → `packages/ai/src/`

- The OpenAI-compatible provider call (the `fetch` to `${OLLAMA_URL}/chat/completions` in the main loop)
- The `tryParseToolCallsFromContent` and `extractJsonObjects` helper functions
  (the rehydration logic for Qwen-via-Ollama emit-tools-as-content quirk)
- A new `normalizeAssistantMessage(msg, turn)` function that applies the rehydration logic and
  returns `{ content, toolCalls, rehydrated }` so callers can log when rehydration fired

### Concern 2 → `packages/coding/src/`

- The four tool definitions (the `tools` array passed to the provider)
- The `executeTool(name, args)` function with `bash`/`read`/`write`/`edit` implementations
  (`runBash` helper goes here too)

## Constraints

- **Do not modify `phase-zero-spike/mirepoix-spike.ts`.** It is the working harness until sub-phase D.
- **Do not invent helpers.** Every function exported must trace back to code in the spike. If a
  helper seems missing, it is — the spike is self-contained. Keep the extraction self-contained too;
  do not import from non-existent files.
- **Preserve the rehydration logic exactly.** `tryParseToolCallsFromContent` and `extractJsonObjects`
  must be byte-equivalent (or behavior-equivalent) copies of the spike's versions. Specifically:
  `extractJsonObjects` uses a brace-matching state machine, NOT a regex — naive regex parsers fail
  on nested JSON. Preserve the state-machine implementation.
- **Preserve type annotations.** Including `as const` on `PACKAGE_NAME` and the explicit
  `Record<string, unknown>` parameter types where the spike uses them.
- **Use TypeScript** — both packages are `.ts` files, types should be explicit.

## Success criteria

After the extraction, all of the following must hold:

1. `packages/ai/src/index.ts` re-exports from `provider.ts` (or the file structure of your choice
   inside `packages/ai/src/`), and the package's public surface includes:
   - `PACKAGE_NAME` (with `as const`)
   - `callProvider(messages, tools, config): Promise<assistant message>`
   - `normalizeAssistantMessage(msg, turn): { content, toolCalls, rehydrated }`
   - `tryParseToolCallsFromContent(content): Array<{name, arguments}>`
   - `extractJsonObjects(text): unknown[]`

2. `packages/coding/src/index.ts` re-exports the public surface:
   - `PACKAGE_NAME` (with `as const`)
   - `tools` — the array of four tool definitions matching the spike
   - `executeTool(name, args): Promise<string>`

3. The rehydration logic, when given this exact content fragment as input, must extract exactly
   two tool calls:

   ```
   {"name": "write", "arguments": {"path": "/tmp/foo", "content": "bar"}}
   {"name": "read", "arguments": {"path": "/tmp/foo"}}
   ```

   The brace-matching state machine handles this; a naive regex approach does not.

4. `bun -e` smoke tests for both packages pass. Suggested:

   ```
   bun -e 'import * as ai from "./packages/ai/src/index.ts"; console.log("ai:", Object.keys(ai).sort());'
   bun -e 'import * as coding from "./packages/coding/src/index.ts"; console.log("coding:", Object.keys(coding).sort());'
   ```

5. `git status` after the work shows changes only inside `packages/ai/` and `packages/coding/`.
   No changes to `phase-zero-spike/`, no changes to `adrs/`, no changes to other packages.

## Non-goals (leave for later sub-phases)

- Typed event bus (sub-phase C, `@mirepoix/core`)
- CLI wiring (sub-phase D, `@mirepoix/cli`)
- Modifying or deleting the spike (sub-phase D)
- Tests beyond the existence/behavior verifications above
- Refactoring beyond what's needed for the extraction

## Key references

- `phase-zero-spike/mirepoix-spike.ts` — source to extract from
- `adrs/ADR-001-minimal-core-and-package-boundaries.md` — package boundaries
- `adrs/ADR-002-tool-surface-and-security-posture.md` — tool surface
- `adrs/ADR-005-context-ownership-and-observability.md` — full context visibility, session log
- `IMPLEMENTATION-PLAN.md` — the broader phasing
