# CONTEXT-MAP.md — Mirepoix bounded contexts

| | |
|---|---|
| **Status** | Initial bootstrap delivery |
| **Delivery** | [ADR-014 #2] Issue #15 — CONTEXT bootstrap session |
| **Grilling session** | 2026-05-16 via `/grill-with-docs` against ADR-014, ADR-001, ADR-002, ADR-012, IMPLEMENTATION-PLAN.md |
| **PR linkage** | _added on commit_ |
| **Maintenance** | inline during `/grill-with-docs` sessions per [ADR-014 §52](adrs/ADR-014-domain-driven-design-adoption.md) — never batched |

This document is the operational manifestation of [ADR-014 §26–34](adrs/ADR-014-domain-driven-design-adoption.md). It is not a parallel document — it is the artifact ADR-014's "Bounded Context discipline" commitment requires. Per [ADR-014 §36](adrs/ADR-014-domain-driven-design-adoption.md), this file lives at the repository root and is the entry point for any agent or operator who needs to know which vocabulary applies to which conversation.

The per-context `CONTEXT.md` files (one per bounded context) are out of scope for this delivery — Issue #15 scopes the bootstrap to CONTEXT-MAP.md only. They will be populated in follow-up grilling sessions, seeded from the per-context annexes below.

## Resolution provenance

Each architectural commitment in this document is tagged with a resolution ID (`R1`–`R17`) sourced from the 2026-05-16 grilling session. The session walked the four-context proposal across four substantive questions (Q1–Q4). Question-by-question reasoning is captured at [`docs/CONTEXT-MAP-grilling-notes.md`](docs/CONTEXT-MAP-grilling-notes.md) and may be archived once its resolutions have landed here. When future grilling refines or supersedes a resolution, this document is updated inline and the resolution ID is reused; a new tag (`R18`+) is created only when a genuinely new commitment lands.

| Tag | Resolution |
|---|---|
| R1 | `workingDir` invariant is Harness vocabulary, not Tooling |
| R2 | `tool` (Harness primitive) vs `Tooling` (proper-noun context) glossary entry locked |
| R3 | Tooling = runtimes, Pipeline = methodology + artifacts (Q2 Option A) |
| R4 | **Runtime-swap test** named as methodology for future boundary disputes |
| R5 | Seven cross-context glossary entries kept (`review`, `agent`, `session`, `phase`, `spec`, `skill`, `extension`) |
| R6 | `prompt` added as cross-context glossary entry |
| R7 | `extension` sharpened with interop note (Mirepoix extension ≠ Claude Code plugin) |
| R8 | `skill` flagged on watch list as deferred collision (activates when Harness ships skills loader) |
| R9 | Six-edge integration-pattern map ratified |
| R10 | Harness ↔ Deployment dual-coded — Conformist (current) + Separate Ways (aspirational) |
| R11 | Failure-mode line per edge ("who owns the fix?") |
| R12 | Harness annex includes AI provider surface + four-tool surface from `packages/coding/src/` |
| R13 | Tooling annex includes Kavara-owned fork pattern (UlyssesModel/{skills,on-loop}) + symlink-from-fork install |
| R14 | Pipeline annex includes Runtime-swap test, allowlist methodology finding, `"0 deviations"` convention |
| R15 | Deployment annex includes Phase a / Phase b terminology + Tailscale ACL distinct from Tailscale network path |
| R16 | Watch list includes DDD-drift across per-context CONTEXT.md files |
| R17 | Distribution as named candidate fifth context; trigger = Phase Four bundler operational |

_Note: the cross-context glossary below renders 10 entries — R5 locked seven (`review`, `agent`, `session`, `phase`, `spec`, `skill`, `extension`); R1 added `workingDir`, R2 added `tool` vs `Tooling`, and R6 added `prompt` during the same session._

## The four bounded contexts

Per [ADR-014 §26–34](adrs/ADR-014-domain-driven-design-adoption.md):

| Context | Subdomain | What it owns | `CONTEXT.md` lives at |
|---|---|---|---|
| **Harness** | Core | The `@mirepoix/*` package surface and what it publishes on the JSONL wire | `/CONTEXT.md` (repo root) |
| **Deployment** | Supporting | The operational infrastructure that runs the Harness — two-venue model | `docs/deployment/CONTEXT.md` |
| **Tooling** | Generic | Plugins and skills that Claude Code (or a future Mirepoix CLI) loads at session-time | `docs/tooling/CONTEXT.md` |
| **Pipeline** | Supporting | The methodology and artifacts that produce work in the Harness | `docs/pipeline/CONTEXT.md` |

### The Runtime-swap test (R4)

When future grilling needs to decide whether a term belongs in **Tooling** or **Pipeline** — the most contended edge — apply this test:

> **If the runtime implementing a piece of work were replaced with a different runtime implementing the same contract, which vocabulary survives the swap?**
> - Vocabulary that survives the swap → **Pipeline** (it is part of the methodology/contract).
> - Vocabulary that does not survive the swap → **Tooling** (it is part of the specific runtime).

Worked example: replace `on-loop` with a hypothetical "off-loop" implementing the same eight phases differently. Sub-phase letters survive (Pipeline). The `architect → coder → tester → security → docs+build → reviewer → git → CI` sequence survives (Pipeline). `FR-X`/`NQ-X`/`OQ-X`/`MS-X` notation survives (Pipeline). The specific `/on-loop:on-spec` slash command does not survive (Tooling). The `.claude/worktrees/<sub-phase>` convention does not survive in detail but the *concept* of an isolated worktree-per-sub-phase does (Pipeline). [ADR-014 §32 + §34](adrs/ADR-014-domain-driven-design-adoption.md) themselves leaked "multi-agent face-off pattern" into both context definitions; the Runtime-swap test resolves this as Tooling (the dispatch+reconciliation code in `codex-plugin-cc` and the on-loop orchestrator) **and** Pipeline (the methodology of dispatching + reconciling + adjudicating two reviewers' verdicts).

## Cross-context glossary

Terms that mean different things in different contexts. When prose is ambiguous, qualify with the context.

### `tool` vs `Tooling` (R2)

**`tool`** (lowercase, often "base tool" or "tool primitive") — A Harness primitive per [ADR-002](adrs/ADR-002-tool-surface-and-security-posture.md). There are exactly four: `bash`, `read`, `write`, `edit`. Lives in `@mirepoix/coding`.

**`Tooling`** (capitalized; always treat as a proper noun) — A bounded context per [ADR-014](adrs/ADR-014-domain-driven-design-adoption.md). Houses the operator-consumable plugins and skills: `on-loop`, `mise-en-place`, `grill-with-docs`, the multi-agent face-off pattern, mise-en-place addenda. None of these are linked into the harness binary; they are loaded at session-time by Claude Code (or future Mirepoix CLI).

**Discipline:** when the referent is ambiguous, qualify. "Base tool" vs "Tooling context." Code review should reject prose that conflates them.

### `workingDir` (R1)

A Harness-owned invariant. Three coincident sites in `@mirepoix/*`:

1. **Declared**: `RunOptions.workingDir` in `packages/core/src/loop.ts`.
2. **Observed on the wire**: `session:start.workingDir` JSONL field in `packages/core/src/events.ts:45`.
3. **Explicitly received via `ToolContext` parameter** in `@mirepoix/coding` — each tool takes a third `ctx: ToolContext` argument constructed once by the agent loop from `options.workingDir`:
   - `packages/coding/src/bash.ts` — `spawn("bash", ["-c", command], { cwd: ctx.workingDir })`.
   - `packages/coding/src/execute.ts` — `resolve(ctx.workingDir, args.path as string)` at the `read` / `write` / `edit` arms.

Structural typing (`ctx: { workingDir: string }`) is how the `core ↛ coding` boundary is preserved without forcing a `coding → core` import edge — core uses the duck-typed shape, coding owns the concrete `ToolContext` definition (NQ-C).

The landed shape per [ADR-014](adrs/ADR-014-domain-driven-design-adoption.md) Refactor 2 / MS-3 (Issue #14) is the `ToolContext` aggregate passed as a parameter to each tool — eliminated the structural binding.

**Cross-context responsibility:** Pipeline (e.g., on-loop's worktree-per-sub-phase configuration) and Tooling (e.g., Claude Code session-time `--cwd` plumbing) must respect the invariant when they configure the Harness. Violations are Pipeline/Tooling bugs, not Harness bugs.

### `review` (R5)

Three referents:
- **Pipeline phase** — the `reviewer` step in the eight-phase sequence (`architect → coder → tester → security → docs+build → `**`reviewer`**` → git → CI`).
- **Tooling mode** — `mise-en-place` mode `review`, one of the eight operating modes. Activates posture changes at session start.
- **Pipeline dispatch target** — `codex:adversarial-review` invoked during the reviewer phase as the Codex teammate's contribution to the multi-agent face-off ([ADR-013](adrs/ADR-013-codex-as-teammate.md)).

The dispatch is mediated by the operating mode in a subtle way: an operator running `mise-en-place mode review` is in a posture-changing mode unrelated to on-loop dispatching the `reviewer` phase. Code review and operator prose should always qualify which `review` is meant.

### `agent` (R5)

Three referents:
- **Harness agent loop** — the `while`-loop in `@mirepoix/core/src/loop.ts` that drives a session forward.
- **Tooling specialist agent** — Claude Code's `Agent` tool spawning subagents (`Explore`, `on-loop:reviewer`, `claude-code-guide`, etc.).
- **Pipeline reviewer-agent** — the Claude reviewer agent dispatched during REVIEW phase, distinct from the Codex teammate also dispatched in that phase.

All three are "agents" in casual speech. Always qualify.

### `session` (R5)

Three referents:
- **Harness Aggregate** — `Session` in `@mirepoix/core`. Per [ADR-014](adrs/ADR-014-domain-driven-design-adoption.md)'s anaemic-domain-model critique, this is the candidate Aggregate Root being refactored toward typed structure (MS-4).
- **Pipeline artifact** — `.on-loop/sessions/<sub-phase>` log + the JSONL audit log per [ADR-005](adrs/ADR-005-context-ownership-and-observability.md).
- **Tooling session** — Claude Code's CLI session, `mise-en-place`'s "session start" pre-flight.

### `phase` (R5)

Two referents, both first-class:
- **Harness macro-phase** — Phase Zero through Phase Six in [IMPLEMENTATION-PLAN.md §52–69](IMPLEMENTATION-PLAN.md).
- **Pipeline phase** — the eight on-loop phases: architect / coder / tester / security / docs+build / reviewer / git / CI.

Operator who says "Phase D" means a *sub-phase* (Pipeline numbering inside Harness's Phase One). Operator who says "the reviewer phase" means a Pipeline phase. **Phase Zero vs sub-phase A is a real conflation hazard** — Phase Zero was the single-file spike; sub-phase A was the first split into the four packages.

### `spec` (R5)

A Pipeline artifact at `specs/<sub-phase>.md`. Per the spec-resolution convention (commit `1a83a67`), `specs/*.md` files are **pre-OQ snapshots**, not contracts. The resolved contract lives in two places: the on-loop SPEC-phase output artifact (per-run, in the on-loop workspace) and the corresponding PR body (durable, reachable from `git log` via the merge commit).

**Pipeline-internal qualification:** `spec` (pre-OQ snapshot at `specs/<name>.md`) vs `resolved spec` (on-loop SPEC artifact + PR body).

### `skill` (R5; watch list R8)

Two referents:
- **Harness loader** — `@mirepoix/coding`'s `DEFAULT_SYSTEM_PROMPT` mechanism in `packages/coding/src/prompts.ts` loads markdown into the system prompt at module import. The full `skills/` directory pattern per [ADR-002 §26](adrs/ADR-002-tool-surface-and-security-posture.md) is a future deliverable.
- **Tooling skill** — Matt Pocock's `mattpocock/skills` marketplace (`grill-with-docs`, `grill-me`); Anthropic-bundled skills (`frontend-design`, `prototype`, `diagnose`, `triage`, `caveman`, etc.). Run inside Claude Code; dispatch agents.

Different mechanisms entirely. Harness skills are appended to *Mirepoix's* system prompt; Tooling skills run inside Claude Code. Today this is unambiguous in practice — the collision activates per Watch list R8 when the Harness ships its skills loader.

### `extension` (R5, R7)

Two referents, **not interchangeable**:
- **Mirepoix extension** — typed TypeScript module per [ADR-003](adrs/ADR-003-extension-model-and-self-modification.md). Hot-reloads into the harness binary's process. Registers tools/prompts/listeners/providers via a typed API. Phase Two deliverable.
- **Claude Code plugin** — `codex-plugin-cc`, `on-loop`, `mise-en-place`, etc. Loaded by Claude Code. Lives in `~/.claude/plugins/` or symlinked from `UlyssesModel/*` forks (R13).

**A Mirepoix extension is not a Claude Code plugin and vice versa, despite both being called "extension" in different contexts.** Operators must qualify.

### `prompt` (R6)

Three referents:
- **Harness system prompt** — `packages/coding/src/prompts/coding.md`, loaded by `prompts.ts` at module import.
- **Tooling operator-priming prompt** — text pasted into Claude Code at session start (often containing work brief, context references, and constraints — the kickoff message of this very grilling session is one example).
- **Pipeline spec prompt** — `specs/<sub-phase>.md` consumed by the on-loop SPEC phase as a pre-OQ prompt that the SPEC phase resolves into a contract.

When ambiguous: "system prompt" vs "operator prompt" vs "spec prompt."

## Integration patterns (R9, R10, R11)

Six edges. One DDD pattern per edge. One **failure-mode line** per edge — answering "who owns the fix when this contract breaks?"

### Harness ↔ Tooling — **Published Language**

The JSONL event log per [ADR-005](adrs/ADR-005-context-ownership-and-observability.md) is the shared format. The `MirepoixEvent` schema in `packages/core/src/events.ts` is the published contract. Tooling participates by extending the schema (the `codex:*` arms in PR #12 / Issue #10 — 7 arms covering Codex dispatch + reconciliation events). Asynchronous, file-mediated, symmetric: both contexts publish into the language and consume from it.

**Failure mode:** tag Tooling can't parse / `codex:*` arm Harness doesn't understand → fix the schema in `@mirepoix/core/src/events.ts`. The Published Language is the contract; don't fork the parser.

### Harness ↔ Deployment — **Conformist (current) + Separate Ways (aspirational)** (R10)

**Current — Conformist.** The OpenAI-compatible model URL + the working-directory contract are what Harness consumes from Deployment. `@mirepoix/ai` exports `callProvider` and `normalizeAssistantMessage` (functions, not a class); both expect an OpenAI-compatible `/chat/completions` endpoint. Harness adapts to whatever URL Deployment exposes; Deployment never changes for Harness.

**Aspirational — Separate Ways.** When `@mirepoix/ai` truly abstracts over multiple wire formats, the relationship becomes Separate Ways — both contexts conform to upstream protocols independently and the link is configuration-only.

**Transition trigger:** any future non-OpenAI-compatible Deployment serving stack forcing `@mirepoix/ai` to add a new provider. When this fires, this edge is reclassified.

**Failure mode:** Non-OpenAI-compatible endpoint → `@mirepoix/ai` adds a provider. Deployment is not obligated to change.

### Harness ↔ Pipeline — **Customer/Supplier**

Pipeline supplies PRs touching `@mirepoix/*`; Harness's CI is the gate: deliverable-tracking via [`scripts/check-deliverables.sh`](scripts/check-deliverables.sh), `bunx tsc --noEmit`, `bunx biome check`, the `## Deliverables` H2 schema. The spec format + the `## Deliverables` section are the published contract.

**Failure mode:** Sub-phase PR fails CI → Pipeline owns the fix. Supplier delivers what the customer accepts; CI is not negotiable.

### Tooling ↔ Pipeline — **Partnership**

The tightest coupling on the map. `on-loop` *is* the Pipeline runtime; `mise-en-place` codifies grilling and operating-mode discipline; `grill-with-docs` operationalizes vocabulary maintenance. Co-evolved across PR #11, #12, #13, and this PR. Synchronization happens at the convention layer ([CLAUDE.md](CLAUDE.md) + spec format), not at the code layer (on-loop source in `openai/on-loop`, mise-en-place in `UlyssesModel/mise-en-place`).

**Failure mode:** on-loop output diverges from convention → both sides own reconciliation via cross-repo discussion. No unilateral fix.

### Tooling ↔ Deployment — **Anti-Corruption Layer**

Tooling availability adapts to venue posture: Codex enabled on Mirepoix-build only per [ADR-013](adrs/ADR-013-codex-as-teammate.md) commitment 4; `[codex-unavailable] mirepoix-secure-default` per [CLAUDE.md](CLAUDE.md) + [`CODEX-TEAMMATE-RUNBOOK.md`](docs/CODEX-TEAMMATE-RUNBOOK.md) §4. The orchestrator wraps Deployment's posture detection and translates it into Tooling-internal "skip codex, run Claude-only" behavior — the ACL boundary.

**Failure mode:** Runtime unavailable in venue used anyway → fix the ACL translation rule. Don't change Deployment.

### Deployment ↔ Pipeline — **Separate Ways**

Pipeline's methodology (sub-phase letters, `FR-X`/`NQ-X`/`OQ-X`/`MS-X`/`MQ-X`, the eight phases) is venue-agnostic. The only Deployment-aware adaptation (Codex availability) is mediated by Tooling, not Pipeline itself. Pipeline genuinely doesn't care which venue it runs on.

**Failure mode:** Spec encodes venue-specific assumption → spec is the violator. Methodology stays venue-agnostic.

## Per-context annexes

Seed vocabulary for the follow-up grilling sessions that will populate each per-context `CONTEXT.md`. Not exhaustive — starter terms. Refinement happens in those sessions.

### Harness — Core Domain (`/CONTEXT.md`) (R12)

**Boundary.** The `@mirepoix/*` package surface and what those packages publish on the JSONL wire. Not the runtime that consumes the JSONL (Tooling), not the host that runs the binary (Deployment), not the methodology that produces PRs (Pipeline).

**Seed vocabulary:**

- **Four packages** with strictly linear dependency graph per [ADR-001](adrs/ADR-001-minimal-core-and-package-boundaries.md): `@mirepoix/ai` → `@mirepoix/core` → `@mirepoix/coding` → `@mirepoix/cli`. `core ↛ coding` — tools dependency-injected via `RunOptions.tools`. `<5kloc` core budget across `ai + core + coding`.
- **Agent loop** — the `while`-loop in `packages/core/src/loop.ts` driving sessions forward.
- **Typed event bus** — `MirepoixEvent`, `Bus`, `Session`, `RunOptions` in `packages/core/src/{events,bus,session,loop}.ts`. `Session` is the candidate Aggregate Root per [ADR-014](adrs/ADR-014-domain-driven-design-adoption.md)'s anaemic-domain-model critique (MS-4 refactor target).
- **The four base tools** per [ADR-002](adrs/ADR-002-tool-surface-and-security-posture.md): `bash`, `read`, `write`, `edit`. Definitions (OpenAI function-call schemas) in a single `tools` array exported from `packages/coding/src/tools.ts`. Implementations: `runBash` in `packages/coding/src/bash.ts`; `read`/`write`/`edit` inline in `executeTool` in `packages/coding/src/execute.ts`. Dispatch via `executeTool(name, args)`.
- **AI provider surface** — `callProvider` (POST to OpenAI-compatible `/chat/completions`) and `normalizeAssistantMessage` (resolve the two tool-call wire shapes), both exported from `packages/ai/src/provider.ts`. Functions today; an `OpenAIProvider`-class shape is a candidate future refactor — see Watch list.
- **JSONL session log** per [ADR-005](adrs/ADR-005-context-ownership-and-observability.md) — the source of truth for what happened in a session.
- **The `workingDir` invariant** (R1) — three coincident sites; `ToolContext` aggregate (Issue #14) carries the value object through each tool invocation per [ADR-014](adrs/ADR-014-domain-driven-design-adoption.md) Refactor 2 / MS-3.
- **The Harness skills loader** at `packages/coding/src/prompts.ts` — three structural properties:
  - Module-load side-effect (importing `@mirepoix/coding` performs synchronous filesystem IO at module init).
  - Bundling brittleness (`import.meta.url` + co-located `prompts/coding.md` may not survive esbuild/rollup/webpack).
  - Fail-fast-at-import semantics (missing/unreadable prompts file throws synchronously — deterministic failure preferred to silent fallback).
- **System prompts at `packages/<pkg>/src/prompts/*.md`** — sub-phase D commitment; never hardcoded in TypeScript.
- **camelCase JSONL payload fields** (NQ-4) — `ollamaUrl`, `sessionId`, `systemPromptFile`, `workingDir`, `messagesCount`, etc.
- **Error-aware JSONL serialization** (NQ-13) — `Error` instances become `{ name, message, stack }`, never `{}`.
- **Bun runtime** (not Node); `bun.lock` (text format, not `bun.lockb`).
- **`workspace:*` protocol** for cross-package deps; first cross-package import lives in `packages/core/package.json` (depends on `@mirepoix/ai`).
- **Harness extension API** — typed TS interface per [ADR-003](adrs/ADR-003-extension-model-and-self-modification.md). Phase Two deliverable. Distinct from "Claude Code plugin" — see cross-context glossary entry for `extension`.

### Tooling — Generic Subdomain (`docs/tooling/CONTEXT.md`) (R13)

**Boundary.** Plugins and skills that Claude Code (or a future Mirepoix CLI) loads at session-time. Code lives outside `@mirepoix/*` — in `openai/on-loop`, `UlyssesModel/mise-en-place`, `mattpocock/skills`, `codex-plugin-cc`, etc. Includes the runtime instantiations of multi-agent patterns; excludes those patterns' methodological form (Pipeline). Survives a runtime swap — see Runtime-swap test.

**Seed vocabulary:**

- **Plugins**: `on-loop` (Joe Stein's multi-agent SDLC pipeline plugin); `mise-en-place` (Kavara's agent behavioral-contract plugin); `codex-plugin-cc` (Codex-as-teammate integration); Matt Pocock's skill marketplace.
- **Skills**: `grill-with-docs`, `grill-me`; Anthropic-bundled (`frontend-design`, `prototype`, `diagnose`, `triage`, `caveman`, `tdd`, etc.).
- **mise-en-place addenda** — #1–4 today; #5 (multi-agent review) in-flight; #6 (DDD-aligned vocabulary discipline) from [ADR-014](adrs/ADR-014-domain-driven-design-adoption.md) follow-up.
- **Karpathy four principles** — adapted upstream concept; mise-en-place applies them.
- **The eight operating modes**: `build`, `explore`, `harden`, `ship`, `firefight`, `review`, `migrate`, `refactor` (mise-en-place enumeration).
- **`codex-result-handling` skill rule** — never auto-apply Codex review findings; present verbatim and ask the operator which (if any) to address.
- **Multi-agent face-off as runtime** — dispatch + reconciliation code in `codex-plugin-cc` and on-loop orchestrator. The methodological form lives in Pipeline.
- **Claude Code platform** — the host runtime for Tooling.
- **Kavara-owned fork pattern**: 
  - `UlyssesModel/skills` — Kavara fork of `mattpocock/skills`.
  - `UlyssesModel/on-loop` — Kavara fork of `openai/on-loop`.
  - **Symlink-from-fork install** at `~/.claude/skills/<skill-name> → ~/code/UlyssesModel/skills/<skill-name>` (and equivalent for plugins).
  - **Never install via upstream installer.** The fork is continuity backup; upstream can vanish, the fork can't.
- **The Tooling vs `tool` discipline** (R2) — Tooling is a proper noun; `tool` is a Harness primitive.

### Pipeline — Supporting Subdomain (`docs/pipeline/CONTEXT.md`) (R14)

**Boundary.** The methodology and artifacts that produce work in the Harness. Lives in `specs/`, in [CLAUDE.md](CLAUDE.md) conventions, in PR bodies, in the on-loop session-log format. Survives a runtime swap per the Runtime-swap test.

**Seed vocabulary:**

- **Sub-phases**: `A`, `B`, `B.1`, `C`, `D`, `D.1` (shipped); `E` (queued); future.
- **Spec files** at `specs/<name>.md` — pre-OQ snapshots, not contracts (spec-resolution convention, commit `1a83a67`).
- **Typed-spec-section naming**: `FR-X` (Functional Requirement), `NQ-X` (Normative Question / locked decision), `OQ-X` (Open Question), `MS-X` (Missing Seam), `MQ-X` (Missing Question).
- **The eight on-loop pipeline phases as a sequence contract**: architect → coder → tester → security → docs+build → reviewer → git → CI.
- **Deliverable-tracking convention** (PR #9): every spec includes a `## Deliverables` H2 section; CI gates undeclared/unstaged paths via [`scripts/check-deliverables.sh`](scripts/check-deliverables.sh).
- **Multi-agent review face-off as methodology** — dispatch + reconcile + adjudicate; normalization table in [`CODEX-TEAMMATE-RUNBOOK.md`](docs/CODEX-TEAMMATE-RUNBOOK.md) §4.
- **Codex teammate dispatch policy** per [ADR-013](adrs/ADR-013-codex-as-teammate.md): REVIEW default-on; CODE retry-exhaust fallback (3 retries against Claude coding agent); venue-gated to Mirepoix-build (see also Tooling ↔ Deployment ACL).
- **Spec resolution convention**: `specs/*.md` = pre-OQ snapshot; PR body + on-loop SPEC artifact = resolved contract (commit `1a83a67`).
- **The Runtime-swap test** (R4) — named methodology for boundary disputes between Tooling and Pipeline. The test itself is Pipeline vocabulary because it survives a runtime swap.
- **Allowlist methodology finding** (R14, sub-phase D grilling) — `FR-X` allowlists and requirement sets should derive from one source, not be authored independently; **two contradictions in one spec is a methodology bug**, not just an oversight.
- **`"0 deviations"` convention** (R14) — defined terminology for on-loop CODE-phase output when the supplied resolved contract was implemented without deviation. Not arbitrary phrasing; the literal string is the contract.
- **Post-merge grilling pass** — `/grill-with-docs` as the standard sub-phase audit tool; empirical pattern of 4–6 findings per pass.
- **Worktree convention**: `.claude/worktrees/<sub-phase>` (gitignored).
- **Session audit logs** at `.on-loop/sessions/` (gitignored; persistent for resume).
- **Architect XML-block output style** per [ADR-013](adrs/ADR-013-codex-as-teammate.md) (gpt-5-4-prompting skill): `<task>`, `<structured_output_contract>`, `<default_follow_through_policy>`, `<verification_loop>`, `<grounding_rules>`, `<action_safety>` — required for any prompt eventually dispatched to Codex.

### Deployment — Supporting Subdomain (`docs/deployment/CONTEXT.md`) (R15)

**Boundary.** The operational infrastructure that runs the Harness in production. Two venues today; future venue overlays anticipated per [ADR-012 §49](adrs/ADR-012-two-venue-deployment-model.md). Excludes the methodology that decides *what* to run (Pipeline) and the runtimes loaded onto a venue (Tooling).

**Seed vocabulary:**

- **Mirepoix-build** — default posture, on `kavara-builder` (always-on Debian 12 VM; standard egress; Tailscale-reachable directly; no bastion mediation; ~$60/month).
- **Mirepoix-secure** — exception posture, on `scotty-gpu` (A100 host; continuous deny-all-egress; IAP-only break-glass; local Ollama serving Qwen2.5-Coder on loopback).
- **`mirepoix-bastion`** — side-by-side bastion. Narrow role: only mediates Mirepoix-secure's external traffic. Does not mediate Mirepoix-build or inter-host coordination.
- **Continuous deny-all-egress** — firewall pattern; the `scotty-gpu-deny-egress` rule at priority 1000.
- **ProxyJump SSH** — Mirepoix-secure → bastion → GitHub for lockdown-host external access.
- **GCP VPC inter-host path** — `10.128.0.0/9`; the only inter-host path Mirepoix uses; never traverses public internet.
- **Three network roles**: Tailscale = operator-to-host; GCP VPC = host-to-host; public internet = host-to-external.
- **Tailscale network path** vs **Tailscale ACL** (R15) — distinct: the network is the encrypted tunnel for operator access; the ACL (`tag:builder` and equivalents) is the tag-based authorization gate. Path and gate are different layers; do not conflate.
- **IAP-only break-glass** — Identity-Aware Proxy as the emergency operator access for Mirepoix-secure when bastion path is unavailable.
- **Cross-venue model serving** — Mirepoix-build can reach scotty-gpu's Ollama at `http://10.128.0.16:11434/v1` over GCP VPC (works because scotty-gpu's deny rule is on egress, not ingress; `default-allow-internal` permits the connection).
- **Smoke-acceptance gate** — [`specs/smoke-test-acceptance.md`](specs/smoke-test-acceptance.md); JSONL regression contract for CLI changes touching the JSONL surface.
- **Workload-allocation rule** ([ADR-012 §28–43](adrs/ADR-012-two-venue-deployment-model.md)) — default to Mirepoix-build; escalate to Mirepoix-secure only with confidentiality articulation; reverse direction requires no justification.
- **Kirk-real exclusion boundary** — proprietary-algorithm-bearing container images build only on TDX-attested appliance hosts; **neither Mirepoix venue is authorized** to build them.
- **Phase a vs Phase b** (R15, per [ADR-010](adrs/ADR-010-mirepoix-secure-and-scotty-gpu-pilot.md)):
  - **Phase a** — scotty-gpu single-A100 Qwen2.5-Coder-32B pilot (currently shipped; the smoke-acceptance gate's reference posture).
  - **Phase b** — multi-A100 Qwen3-Coder-480B expansion (future-state).
- **Venue overlays** as anticipated future-state — currently single-repo (`UlyssesModel/kavara-mirepoix-internal`); future-state per-venue repos (e.g., `UlyssesModel/mirepoix-kavara-builder`, `UlyssesModel/mirepoix-scotty-gpu`) emerge only when a venue accumulates enough venue-specific configuration to justify pulling out of the shared base.

## Watch list

Deferred collisions and forward-looking concerns that will activate as Mirepoix's phases land. When activated, the next grilling session touching the area updates this document inline.

- **`skill` collision becomes operational** (R8) — today `skill` is unambiguous in practice because the Harness has no `skills/` directory yet, and Tooling-side skills run inside Claude Code. The collision activates when a future sub-phase ships `packages/coding/src/skills/` loading markdown into the system prompt per [ADR-002 §26](adrs/ADR-002-tool-surface-and-security-posture.md).
- **Conformist → Separate Ways transition** (R10) — Harness ↔ Deployment edge reclassifies when any non-OpenAI-compatible Deployment serving stack forces `@mirepoix/ai` to add a new provider.
- **`OpenAIProvider` class as candidate Harness refactor** — `@mirepoix/ai` currently exports `callProvider` + `normalizeAssistantMessage` as functions. A class-based shape is a plausible future refactor that would crystallize when wire-format abstraction (above) lands. Watch for it; do not pre-create the vocabulary.
- **Phase Four — Kavara-Mirepoix bundle and the bundler** ([IMPLEMENTATION-PLAN.md §65](IMPLEMENTATION-PLAN.md)) — when the distribution-tag enforcement (`internal` / `public` / `customer-licensed` / `collaborator-shared`) becomes operational, the question of whether **Distribution** is a fifth context becomes pressing (see Candidate future contexts).
- **Phase Five — Customer-X-Mirepoix instances** ([IMPLEMENTATION-PLAN.md §67](IMPLEMENTATION-PLAN.md)) — multi-tenant per-customer remixes change Deployment vocabulary materially (per-customer venue overlays + per-customer extension layering).
- **DDD vocabulary drift across per-context CONTEXT.md files** (R16) — once the four per-context CONTEXT.md files are populated by follow-up grilling sessions, a periodic audit catches same-term-different-definition drift across files. Likely cadence: per-major-sub-phase or annual. The audit is a small `/grill-with-docs` session focused on the cross-context glossary section of this document plus the four per-context CONTEXT.md files.

## Candidate future contexts

Today: four contexts ([ADR-014](adrs/ADR-014-domain-driven-design-adoption.md) binding). The codebase implies no fifth context now, but one candidate is named so future grilling has a place to start.

### Distribution / Licensing (R17)

**Vocabulary cluster:** distribution tags (`internal` / `public` / `customer-licensed` / `collaborator-shared`); the bundler; layered overlays (Mirepoix-base / Kavara-Mirepoix / Customer-X-Mirepoix); per-customer remixes; signed customer deliverables.

**Authority cluster:** [ADR-007](adrs/ADR-007-layered-distribution-and-license-tagging.md) (layered distribution + per-extension license-tagging contract); [ADR-009](adrs/ADR-009-collaborator-tier-and-mirepoix-naming.md) (collaborator tier); [IMPLEMENTATION-PLAN.md §65–67](IMPLEMENTATION-PLAN.md) (Phase Four bundle composition + Phase Five customer remixes).

**Today's status:** vocabulary partially in Harness (which package gets which tag), partially in Deployment (venue overlays per [ADR-012 §49](adrs/ADR-012-two-venue-deployment-model.md)), partially in Tooling (extension distribution model per ADR-006/007). No single context owns it cleanly because the bundler has not shipped.

**Promotion trigger:** **Phase Four bundler operational.** Specifically — is `mirepoix bundle` shipping today as a runnable command that enforces distribution tags at build time? If yes, evaluate whether Distribution has enough mass (independent vocabulary, independent decisions, independent failure modes) to justify its own context. If yes, a superseding ADR (likely ADR-015 or later) promotes Distribution to fifth context and this document gains a fifth annex.

**Evaluation rubric (for future grilling):** has the trigger fired? If `mirepoix bundle` ships as a command, evaluate. If not, defer.

## How this document is maintained

Per [ADR-014 §24 + §52](adrs/ADR-014-domain-driven-design-adoption.md), this document is updated **inline during `/grill-with-docs` sessions, never batched**. When a term is resolved in a grilling session, it gets written here before the session moves on. The discipline is binding for substantive architectural work; lapses are themselves architectural feedback that grilling is being short-cut.

Resolution IDs (`R1`–`R17` from the 2026-05-16 bootstrap session) are append-only: new resolutions get fresh IDs; refinements update the existing entry inline and the tag is reused. The grilling-session notes at [`docs/CONTEXT-MAP-grilling-notes.md`](docs/CONTEXT-MAP-grilling-notes.md) are session-output (not framework-output) and may be archived once their resolutions have landed here.

### Cross-references

- [ADR-014](adrs/ADR-014-domain-driven-design-adoption.md) — the binding architectural commitment this document manifests.
- [ADR-001](adrs/ADR-001-minimal-core-and-package-boundaries.md) — four-package decomposition (Harness boundary).
- [ADR-002](adrs/ADR-002-tool-surface-and-security-posture.md) — four base tools (Harness primitives; source of the `tool`/`Tooling` collision).
- [ADR-003](adrs/ADR-003-extension-model-and-self-modification.md) — Mirepoix extension API (source of the `extension`/Claude Code plugin collision).
- [ADR-005](adrs/ADR-005-context-ownership-and-observability.md) — JSONL session log (Harness ↔ Tooling Published Language).
- [ADR-010](adrs/ADR-010-mirepoix-secure-and-scotty-gpu-pilot.md) — Mirepoix-secure posture; Phase a / Phase b vocabulary.
- [ADR-012](adrs/ADR-012-two-venue-deployment-model.md) — two-venue deployment model (Deployment boundary).
- [ADR-013](adrs/ADR-013-codex-as-teammate.md) — Codex teammate (Pipeline / Tooling / Deployment intersection).
- [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) — Phase Zero–Six roadmap (Harness macro-phases).
- [CLAUDE.md](CLAUDE.md) — agent-loaded conventions covering all four contexts.
- [`docs/CODEX-TEAMMATE-RUNBOOK.md`](docs/CODEX-TEAMMATE-RUNBOOK.md) — Tooling / Pipeline operational guide.
- [`docs/MIREPOIX-SECURE-RUNBOOK.md`](docs/MIREPOIX-SECURE-RUNBOOK.md) — Deployment operational guide (Mirepoix-secure).
- [`docs/MIREPOIX-BUILD-RUNBOOK.md`](docs/MIREPOIX-BUILD-RUNBOOK.md) — Deployment operational guide (Mirepoix-build).
