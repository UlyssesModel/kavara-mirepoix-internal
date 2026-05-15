# Sub-phase — JSONL audit envelope for codex:* MirepoixEvent arms

**Resolves:** Issue #10 (filed during sub-phase D's codex-teammate work).
**Depends on:** PR #11 (codex-teammate spec, merged 2026-05-13) and PR #9 (deliverable-tracking, merged 2026-05-13).
**Phase:** One. Mode: `build` per mise-en-place.

## Context

Mirepoix's `@mirepoix/core` package (sub-phase C) introduced a 13-arm discriminated union `MirepoixEvent` for the typed event bus. Every kernel arm is enforced at compile time by the `_AllTagsCovered` exhaustiveness check in `packages/core/src/log.ts`, which guarantees the JSONL logger covers every event the kernel emits.

PR #11 (just merged) added codex-teammate — a pattern for dispatching to OpenAI Codex alongside Claude during on-loop's pipeline phases. Codex-teammate code paths will produce events that the current `MirepoixEvent` union does not yet model. Logging those events through generic shapes would lose the audit fidelity ADR-005 commits to ("every byte of context… is logged, attributable, and inspectable").

Issue #10 asks for the JSONL audit envelope: extend `MirepoixEvent` with `codex:*` arms so codex-teammate operations are first-class in the typed audit trail. This sub-phase ships that extension as types + logger surface + type-smoke only — no dispatching code.

## Goal

Extend the kernel's event vocabulary to cover codex-teammate operations, with full compile-time exhaustiveness enforcement and per-arm type-smoke verification. Land the audit shape before any codex-dispatching code so future dispatching automatically logs through the right arms.

## Functional requirements

**FR-1.** Read `specs/codex-teammate.md` (PR #11) and identify the operations that warrant first-class events. Candidate arms (architect to confirm exact shape and naming during PLAN):

- `codex:dispatch` — when on-loop dispatches a phase to codex (analogous to `tool:start` in semantic shape)
- `codex:request` — outbound API call to the Codex provider (body, model, options)
- `codex:response` — Codex's response (full message, with rehydrated tool calls if applicable)
- `codex:error` — Codex API errors, dispatch errors, refusals, or rate-limit responses

The architect may propose additional arms if `specs/codex-teammate.md` justifies them, or merge some of the above if the codex-teammate spec models them differently. Document the chosen arm shape in the PLAN phase before CODE proceeds.

**FR-2.** Add the agreed arms to `MirepoixEvent` in `packages/core/src/events.ts`. Maintain the existing tag-as-const discriminated-union shape. Use **camelCase for payload fields** per NQ-4 from sub-phase C.

**FR-3.** Update the `ALL_TAGS` constant in `packages/core/src/log.ts` to include every new arm's tag. The `_AllTagsCovered` compile-time check should pass after the change; if it doesn't, an arm is missing from `ALL_TAGS`.

**FR-4.** Verify that NQ-13's Error-aware JSONL replacer correctly serializes any `Error` fields in `codex:error` payloads (matching the existing `tool:error` behavior). Do not regress NQ-13 — `tool:error` payloads must still serialize the message/stack/name, not `{}`.

**FR-5.** Add type-smoke tests in `packages/core/type-smoke/` for each new arm:

- Positive case (Bun script) — arm typechecks and `JSON.stringify` with the NQ-13 replacer produces sensible output.
- Negative case (tsc `--noEmit`) — omitting a required field on a new arm fails to compile.

**FR-6.** Document the codex audit conventions in `packages/core/src/events.ts` JSDoc comments — what each arm means, when it fires, what its payload contains. Future readers (and the eventual codex-dispatch code) should be able to understand the contract from `events.ts` alone, without needing to re-read `specs/codex-teammate.md`.

## Constraints

- **Do not add codex-dispatching code in this sub-phase.** Events are types + logger surface + tests only. Dispatching code is a later sub-phase.
- **Do not modify `specs/codex-teammate.md`** — PR #11 just merged.
- **Maintain camelCase for payload fields** (NQ-4 from sub-phase C).
- **Preserve NQ-13 Error serialization behavior** — the existing replacer must handle `codex:error` payloads with the same fidelity it handles `tool:error` payloads.
- **Contain to `@mirepoix/core`.** No changes outside `packages/core/` except `specs/` and any docs the deliverables convention requires. No CLI changes, no AI-provider changes, no extension-API surface, no on-loop plugin changes.
- **No new external dependencies.** No `npm install`, no Cargo additions. The change is type-system-only inside the existing package.

## Success criteria

1. `bun -e 'import * as core from "./packages/core/src/index.ts"; console.log(Object.keys(core).sort());'` shows the existing exports intact plus any new exports the architect adds.
2. `bunx tsc --noEmit` is clean across all packages — exhaustiveness check passes.
3. Each new arm has a positive type-smoke proving it typechecks and serializes via `JSON.stringify` with the NQ-13 replacer to a structurally-correct shape.
4. Negative type-smokes verify that malformed arms (missing required fields, wrong payload types) fail to compile.
5. CI green — Biome, tsc, the existing 15-test surface from sub-phase C, the new tests added by this sub-phase, and the deliverable-tracking check from PR #9 all pass.
6. The existing 15/15 tests from sub-phase C still pass without modification.

## Non-goals

- Implementing codex dispatch logic (later sub-phase, e.g., E or M)
- Modifying any package outside `@mirepoix/core`
- Adding CLI flags for codex selection (later)
- Modifying the on-loop plugin (separate cross-repo PR to `openai/on-loop`)
- Backporting to the Phase Zero spike (retired in D.1)
- Adding hyperscaler API client code (the events describe what *will* happen when dispatch lands; they don't dispatch yet)

## Deliverables

Per the deliverable-tracking convention from PR #9, this sub-phase ships:

- `packages/core/src/events.ts` — modified (new `codex:*` arms added)
- `packages/core/src/log.ts` — modified (`ALL_TAGS` extended; `_AllTagsCovered` exhaustiveness check passes)
- `packages/core/type-smoke/codex-events.ts` — new (or extension of an existing smoke file if convention prefers; architect's call during PLAN)
- `specs/sub-phase-codex-events.md` — this spec, committed alongside the implementation

`scripts/check-deliverables.sh` should pass against this `## Deliverables` section.

## Key references

- `specs/codex-teammate.md` (PR #11) — definitive source for what codex-teammate does and what events it produces
- `packages/core/src/events.ts` — current 13-arm `MirepoixEvent` union (post sub-phase C)
- `packages/core/src/log.ts` — has the `_AllTagsCovered` exhaustiveness check (the "tsc fails if a future union arm isn't subscribed" trick from sub-phase C)
- `packages/core/type-smoke/` — existing pattern for positive/negative type tests
- `adrs/ADR-005-context-ownership-and-observability.md` — JSONL log is source of truth ("every byte… logged, attributable, inspectable")
- `adrs/ADR-004-event-bus-over-hook-process-model.md` — typed in-process event bus, no hook-spawn-process
- `CLAUDE.md` — operator conventions, hard-don'ts (NQ-4 camelCase, NQ-13 Error replacer, no spike modifications)

## Notes for the architect during PLAN

- The codex-teammate spec at `specs/codex-teammate.md` is the authoritative source for which operations need first-class events. Read it carefully before proposing the arm list — the four candidate arms above are educated guesses, not requirements.
- If codex-teammate models operations the candidate list misses (e.g., `codex:rateLimit`, `codex:retry`, `codex:tokenUsage`), add them. The exhaustiveness check will make missing arms a compile error after `ALL_TAGS` updates.
- Sub-phase budget: this should be smaller than C and D. Roughly 4-6 FRs, ~150-300 LOC, ~30-45 min on-loop pipeline. If the architect proposes a scope materially larger than that, surface the deviation in PLAN before CODE proceeds — it may indicate the codex-teammate spec asks for more than just an audit envelope.
- The `codex:request` and `codex:response` payloads will probably contain message bodies. Be mindful of sensitive content in audit logs — the spec for codex-teammate may or may not address this, and if it doesn't, surface as an OQ rather than assuming.
