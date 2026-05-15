# Codex as a teammate — orchestrated face-off in on-loop

## Status

Standalone architectural sub-phase, not a Mirepoix Phase sub-phase. Establishes how the `openai/codex-plugin-cc` skills compose with the existing `mise-en-place` behavioral contract and `on-loop` SDLC pipeline. Produces ADR-013 plus operator-facing docs and CLAUDE.md conventions.

## Context

Until now the Mirepoix workflow has been single-agent in any given step: when on-loop dispatches the architect, coding, testing, security, doc+build, or reviewer phase, exactly one agent runs (the on-loop plugin's `on-loop:<role>` Claude-based subagent). The agent's verdict is the verdict.

OpenAI's `codex-plugin-cc` adds a second teammate to Claude Code sessions:

- **Slash commands** (operator-invokable): `/codex:review`, `/codex:adversarial-review`, `/codex:rescue`, `/codex:setup`, `/codex:status`, `/codex:result`, `/codex:cancel`.
- **Subagent**: `codex:codex-rescue` — a forwarder that calls the Codex CLI's `task` helper with the operator's request.
- **Internal skills** (not user-invocable): `codex-cli-runtime`, `codex-result-handling`, `gpt-5-4-prompting`.

The plugin's existence raises a design question Mirepoix should answer before sub-phase E (self-modification on the locked host): when do we run Codex alongside Claude as a teammate, who decides, and how do we compose their verdicts?

This spec establishes the answers and produces the artifacts (ADR + docs + CLAUDE.md convention) that future Claude Code sessions and Mirepoix-the-harness will use.

## Goal

After this PR lands:

1. Every `/on-loop` REVIEW phase dispatches **both** the Claude reviewer agent **and** Codex adversarial-review. Either verdict can block merge.
2. The on-loop CODE phase's retry-exhaust fallback (after 3 Claude coding attempts) is **`codex:codex-rescue`**, not silent give-up.
3. The on-loop architect agent's spec output adopts the **XML-block style** from `gpt-5-4-prompting` (`<task>`, `<structured_output_contract>`, `<verification_loop>`, etc.) — both because Codex needs that shape when later dispatched, and because the contract with downstream agents tightens regardless of model.
4. ADR-013 captures the architectural commitment so sub-phase E (Mirepoix-the-harness running its own loop) inherits the design.
5. **This PR dogfoods the design** — its own REVIEW phase dispatches `/codex:adversarial-review` alongside the Claude reviewer. The face-off is the first live exercise.

## Concrete work

### Concern 1 — ADR-013

New file `adrs/ADR-013-codex-as-teammate.md`. Sections (per existing ADR style — see ADR-004, ADR-010 for the template):

- **Status**: Accepted
- **Context**: why a second teammate, what changed (codex-plugin-cc shipped), why now (before sub-phase E)
- **Decision**: the four commitments enumerated under Goal above
- **Consequences**: REVIEW becomes parallel-two-agent; CODE retry-exhaust is no longer a dead end; architect output style changes; cross-provider dependency added (Codex CLI must be installed)
- **Alternatives considered**: Codex as default coder (rejected — Claude's fine for happy path); auto-apply Codex review findings (rejected — codex-result-handling skill explicitly forbids); single-agent review (rejected — loses Claude's perspective; single point of model bias)
- **Implementation notes**: CLAUDE.md convention establishes the orchestrator's behavior; on-loop plugin source unchanged for now; future cross-repo PR could patch the plugin's templates

### Concern 2 — `docs/CODEX-TEAMMATE-RUNBOOK.md`

Operator-facing doc. Covers:

- **Install prerequisites**: `/plugin marketplace add openai/codex-plugin-cc`, `/plugin install codex@openai-codex`, `/codex:setup`. Verify Codex CLI is on PATH and authenticated.
- **When the orchestrator dispatches Codex automatically**: REVIEW phase (default-on, every run); CODE phase retry-exhaust fallback. The operator does not need to invoke these manually.
- **When the operator invokes Codex directly**:
  - `/codex:review` — read-only second opinion on uncommitted changes, outside the on-loop pipeline
  - `/codex:adversarial-review` — pressure-test design choices on a PR branch before opening
  - `/codex:rescue` — delegate a write task when Claude is stuck mid-conversation (no on-loop pipeline running)
- **Verdict composition** (what to do when Claude and Codex disagree in REVIEW):
  - Both APPROVE → merge clear
  - Either REQUEST_CHANGES → block; orchestrator presents both verdicts; operator decides which to address (per codex-result-handling skill: never auto-apply)
  - Both REQUEST_CHANGES → block; operator addresses both
  - Codex unavailable (auth gone, CLI missing) → fall back to Claude-only review with a logged "Codex unavailable" warning; do not block on tooling state
- **`/codex:setup` recovery flow** when Codex is broken
- **Mode mapping**: which mise-en-place modes authorize which Codex commands
  - `review` mode → `/codex:review` and `/codex:adversarial-review` legitimate
  - `firefight` mode → `/codex:rescue` legitimate (escape valve)
  - `build` mode → Codex commands not invoked by default; orchestrator-only
- **What the operator should NOT do**: auto-apply Codex's review findings (the codex-result-handling skill forbids; this PR honors that); silently swap Codex's coder output into the PR without re-running TEST and SECURITY phases against it

### Concern 3 — `CLAUDE.md` updates

Add a new section between **Conventions** and **Deployment venues** (or fold into Conventions; engineer chooses):

```markdown
## Multi-agent face-off (Codex as teammate)

Per [ADR-013](adrs/ADR-013-codex-as-teammate.md), the on-loop pipeline runs Claude and Codex as two teammates:

- **REVIEW phase (default-on)**: when /on-loop reaches REVIEW, the orchestrator dispatches BOTH the Claude reviewer agent AND `/codex:adversarial-review` on the same branch. Both verdicts are presented; either can block merge.
- **CODE phase (retry-exhaust fallback)**: after 3 retries against the Claude coding agent, the orchestrator dispatches `codex:codex-rescue` as a final attempt with the test/review feedback as input.
- **Architect output style**: per [`gpt-5-4-prompting`](https://github.com/openai/codex-plugin-cc) skill, the architect's notes adopt XML-block sections (`<task>`, `<structured_output_contract>`, `<default_follow_through_policy>`, `<verification_loop>`, `<grounding_rules>`, `<action_safety>`) instead of plain markdown headers. This tightens the contract with downstream agents and is required for any prompt that's eventually dispatched to Codex.
- **Codex unavailable**: if `/codex:setup` reports Codex not installed or not authenticated, the orchestrator falls back to Claude-only review/code and logs a `[codex-unavailable]` warning in the changes log. The PR is not blocked on tooling state.

Operator-direct commands (outside the on-loop pipeline) remain available: see [`docs/CODEX-TEAMMATE-RUNBOOK.md`](docs/CODEX-TEAMMATE-RUNBOOK.md).
```

Also add to **Hard "don't"s**:

- Auto-apply Codex review findings — the `codex-result-handling` skill explicitly forbids this. Always present and ask which findings (if any) the operator wants addressed.
- Dispatch Codex during SPEC or PLAN phases — that's architect/orchestrator territory; Codex enters at CODE (retry-exhaust) and REVIEW (default-on) only.

### Concern 4 — Architect output style change

Update CLAUDE.md (above) to specify the XML-block convention. The on-loop plugin's `architect.md` template lives cross-repo at `~/.claude/plugins/cache/on-loop-marketplace/on-loop/<version>/agents/architect.md` and is not modified by this PR. Instead, CLAUDE.md is loaded as project context by the architect agent when dispatched, and the convention applies via that route.

Future cross-repo follow-up: submit a PR to the on-loop plugin that adds the XML-block style to the architect template directly, so non-Mirepoix consumers also benefit.

The XML-block recipe (per `gpt-5-4-prompting` skill):

```xml
<task>
The concrete job + repository context.
</task>

<structured_output_contract>
Exact shape, ordering, and brevity requirements for the architect's notes.
</structured_output_contract>

<default_follow_through_policy>
What the next agent (coding) should do by default vs. asking.
</default_follow_through_policy>

<verification_loop>
Required for any coding or debugging architect spec.
</verification_loop>

<grounding_rules>
Required when the spec involves review, research, or claims that could drift into unsupported territory.
</grounding_rules>

<action_safety>
Required for write-capable specs — keeps the coding agent narrow.
</action_safety>
```

### Concern 5 — Dogfood

This PR's `/on-loop` run is the first test of the design. When the orchestrator reaches REVIEW phase, it dispatches BOTH:

1. The on-loop reviewer agent (per existing pipeline)
2. `/codex:adversarial-review` against this PR branch

Both verdicts go into the PR description. If Codex flags blocking issues, the orchestrator surfaces them; operator decides per the verdict-composition rules in Concern 2.

This is the only PR where the dogfood is explicit — subsequent on-loop runs inherit the convention via CLAUDE.md.

## Deliverables

Files this PR commits to the repository tree:

- `specs/codex-teammate.md`
- `adrs/ADR-013-codex-as-teammate.md`
- `docs/CODEX-TEAMMATE-RUNBOOK.md`
- `CLAUDE.md`

## Constraints

- **No on-loop plugin patches** in this PR. Cross-repo work; out of scope. Convention via CLAUDE.md.
- **No code changes under `packages/`**. This is a workflow/orchestration sub-phase; no harness modifications.
- **No new third-party deps**. Codex is installed as a Claude Code plugin (operator-side), not as a `package.json` dep.
- **Codex's slash commands and subagent are user-installed prerequisites** — this PR documents but does not install them. The runbook covers `/codex:setup`.
- **No new ADRs beyond ADR-013**. ADR-013 is the only architectural commitment authored here.
- **Per the codex-result-handling skill**: NEVER auto-apply Codex review findings. CLAUDE.md hard-don't enforces.

## Success criteria

After the PR lands, all of the following must hold:

1. `adrs/ADR-013-codex-as-teammate.md` exists, follows the existing ADR style (Status / Context / Decision / Consequences / Alternatives / Implementation notes), and is referenced from CLAUDE.md.
2. `docs/CODEX-TEAMMATE-RUNBOOK.md` exists and covers install, auto-dispatch points, operator-direct commands, verdict composition, mode mapping, and what NOT to do.
3. `CLAUDE.md` has a new section documenting the multi-agent face-off + two new Hard "don't" entries.
4. `bash scripts/check-deliverables.sh specs/codex-teammate.md` exits 0 (the spec self-validates via the convention from PR #9).
5. CI green on the PR (14 steps from PR #9; no new CI changes).
6. The `/on-loop` REVIEW phase for THIS PR dispatched `/codex:adversarial-review` and the orchestrator captured its verdict in the PR description. (Dogfood evidence.)
7. No `phase-zero-spike/` references reappear (deleted in D.1).
8. No source changes under `packages/**`.

## Out of scope

- Patching the on-loop plugin's architect.md template (cross-repo; future PR)
- Modifying `@mirepoix/ai` to add a Codex CLI-shaped provider (sub-phase E or later; deep harness change)
- Adding a `codex` tool to `@mirepoix/coding` (same)
- Auto-applying Codex findings (forbidden by codex-result-handling)
- Codex dispatch during SPEC, PLAN, TEST, SECURITY, DOC, BUILD phases (only CODE retry-exhaust and REVIEW default-on)
- Renovate/Dependabot for the codex-plugin-cc plugin version
- SHA-pinning the codex-plugin-cc install (operator-side install; not a CI step)

## Open questions

- **OQ-1 — Sequential or parallel dispatch in REVIEW?** Suggested: parallel. The orchestrator launches both at the same time and awaits both. Sequential (Claude first, then Codex if Claude approves) would skip Codex's perspective when Claude approves, losing the face-off value.

- **OQ-2 — How does the orchestrator know `/codex:setup` ran successfully?** Suggested: the orchestrator runs `command -v codex >/dev/null` (or a similar probe) at the start of each on-loop session. If Codex is unavailable, log `[codex-unavailable]` to changes.log and degrade to Claude-only review. Do not block the pipeline; do not auto-install.

- **OQ-3 — How does the orchestrator surface Codex's verdict in the PR description?** Suggested: a dedicated `## Codex adversarial review` section in the PR body, placed after the `## Pipeline results` table. The verdict is presented verbatim (per codex-result-handling); the orchestrator does not editorialize.

- **OQ-4 — What happens when `codex:codex-rescue` writes incompatible code in the CODE retry-exhaust fallback?** Suggested: the rescue agent's output goes back through TEST and SECURITY phases (full re-run, not bypassed). If those phases still fail, the PR cannot land; operator intervention required. The escape valve is "another shot at coding," not "skip the gates."

- **OQ-5 — Does this design apply to Mirepoix-the-harness when it runs sub-phase E?** Suggested: yes. The sub-phase E spec (not yet written) will reference ADR-013. Mirepoix-the-harness running its own loop on scotty-gpu inherits the Codex-as-teammate design — though scotty-gpu's deny-all-egress means Codex's API path must be evaluated separately (Codex may or may not be installable behind a sandbox).

- **OQ-6 — What about other GPT-5/4-class providers (Codex's `task` helper, OpenRouter, etc.)?** Suggested: ADR-013 names Codex specifically because that's what we have evidence for. Future ADRs can extend the pattern to other providers; the multi-agent face-off design is provider-agnostic in principle.

## Key references

- [codex-plugin-cc README](https://github.com/openai/codex-plugin-cc) — slash commands, requirements, install
- `plugins/codex/skills/codex-cli-runtime/SKILL.md` — how the rescue subagent forwards
- `plugins/codex/skills/codex-result-handling/SKILL.md` — verdict presentation rules
- `plugins/codex/skills/gpt-5-4-prompting/SKILL.md` — XML-block prompt recipes
- `adrs/ADR-001` — package boundaries (informs why Codex doesn't gain a provider slot inside `@mirepoix/ai` yet)
- `adrs/ADR-003` — extension model + self-modification (informs the sub-phase E forward-compat thinking)
- `adrs/ADR-010` — Mirepoix-secure / scotty-gpu deny-all-egress (informs whether Codex can run under lockdown)
- `specs/harness-deliverable-tracking.md` — the `## Deliverables` convention this spec adopts
- `Users/jekavara/.claude/plugins/cache/mirepoix/mise-en-place/<version>/skills/mise-en-place/references/contract.md` — the four-principles behavioral contract this design composes with
- on-loop plugin agents at `~/.claude/plugins/cache/on-loop-marketplace/on-loop/<version>/agents/` — what the orchestrator dispatches today
