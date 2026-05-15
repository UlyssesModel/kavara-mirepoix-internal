# Codex teammate runbook

This runbook is the operator's counterpart to [ADR-013](../adrs/ADR-013-codex-as-teammate.md). The ADR commits to the architectural shape — Claude and Codex run as two teammates inside the on-loop pipeline, parallel in REVIEW, Codex as a retry-exhaust escape valve in CODE, gracefully degrading when Codex is unavailable. This document covers how the operator installs Codex, what the orchestrator does automatically, what the operator can do directly, how to compose verdicts when the two reviewers disagree, how to recover when Codex breaks, and what NOT to do.

Read ADR-013 first if you have not. This runbook only describes operations.

## 1. Install prerequisites

The `openai/codex-plugin-cc` plugin is a Claude Code plugin installed inside the operator's Claude Code session, not a `package.json` dep of this repo. Install once per workstation:

```text
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/codex:setup
```

The `/codex:setup` flow authenticates Codex CLI against an OpenAI account; follow its prompts. Once setup completes, verify the install from a regular shell:

```sh
command -v codex          # must print a path; exit 0
codex --version           # must report codex-cli >= 0.130.0
```

The `codex-cli >= 0.130.0` floor is a soft pin — earlier versions may not implement `/codex:adversarial-review` and would cause the orchestrator's REVIEW dispatch to degrade. If `codex --version` reports lower than 0.130.0, treat Codex as unavailable until the operator-side install is upgraded; do not attempt to upgrade `codex-cli` from inside an `/on-loop` run.

## 2. When the orchestrator dispatches Codex automatically

Two phases in the on-loop pipeline auto-dispatch Codex; the operator does not need to invoke either manually.

**REVIEW (default-on, every `/on-loop` run).** When the orchestrator reaches REVIEW, it launches the on-loop Claude reviewer agent AND `/codex:adversarial-review` in parallel against the PR branch. Both verdicts are captured verbatim and posted into the PR description in dedicated sections. Either REQUEST_CHANGES blocks merge; both APPROVE clears the gate.

**CODE retry-exhaust (after three Claude attempts fail).** When the on-loop Claude coding agent has failed three attempts against TEST or SECURITY for the same FR, the orchestrator dispatches `codex:codex-rescue` with the accumulated TEST and SECURITY feedback as input. The rescue subagent calls Codex CLI's `task` helper (per the `codex-cli-runtime` skill) and returns a fresh diff.

**Rescue containment.** Rescue output is treated as a write-capable second-model attempt with FULL gate containment, not a shortcut past existing gates. Specifically, when `codex:codex-rescue` returns a diff, the orchestrator:

1. **Captures the touched-file list** from rescue output (per the `codex-result-handling` skill — the rescue subagent's structured output includes the list of files written).
2. **Verifies the touched files are within the spec's diff allowlist.** If rescue wrote outside the allowlist, the rescue diff is reverted and the failure is recorded with a `[rescue-out-of-scope]` marker in `changes.log`; the PR cannot land.
3. **Re-runs the FULL TEST + SECURITY phases** against the rescue diff. Not a partial re-run; the entire test and security suite from the spec re-executes.
4. **Dispatches a fresh REVIEW face-off** (Claude + Codex parallel verdicts per §4) on the rescue output. Rescue does NOT skip the REVIEW gate; the rescue diff is reviewed exactly like any other coding-agent diff.
5. **If TEST, SECURITY, or REVIEW fails post-rescue**, the rescue output is reverted and the PR cannot land without operator intervention. The escape valve is "another shot at coding under a second model with all gates re-applied", not "skip the gates because Claude ran out of retries".

If Codex is unavailable at either auto-dispatch point (`/codex:status` reports not-installed, not-authenticated, or version-incompatible), the orchestrator appends `[codex-unavailable] <reason>` to the session's `changes.log` and falls back to Claude-only for the affected phase. The PR is not blocked on Codex's tooling state.

## 3. When the operator invokes Codex directly

Outside the on-loop pipeline, the operator may invoke Codex's slash commands directly:

- `/codex:review` — read-only second opinion on uncommitted changes. Useful before opening a PR or while iterating in a non-on-loop session.
- `/codex:adversarial-review` — pressure-test a design choice on a PR branch before opening the PR. Same shape as the auto-dispatch in REVIEW, but operator-initiated.
- `/codex:rescue` — delegate a write task to Codex when Claude is stuck mid-conversation outside an active `/on-loop` run. This is distinct from `codex:codex-rescue` (the SUBAGENT the orchestrator dispatches during CODE retry-exhaust); `/codex:rescue` is the operator-facing slash command.
- `/codex:status` — report whether Codex CLI is installed, authenticated, and at a compatible version.
- `/codex:result` — fetch the result of a previously-issued Codex task.
- `/codex:cancel` — cancel an in-flight Codex task.

Do not invoke `/codex:review` or `/codex:adversarial-review` against a branch that is already inside an `/on-loop` REVIEW phase — the orchestrator is already dispatching the same command, and a manual second invocation creates duplicate verdicts in the PR body.

## 4. Verdict composition (REVIEW phase)

The REVIEW phase produces two verdicts (Claude + Codex) per the parallel dispatch in Section 2. Both are posted verbatim into the PR description: Claude's verdict under `## Pipeline results`, Codex's under `## Codex adversarial review`. The orchestrator preserves each verdict's body text without summarization or transformation — it captures whatever the agent wrote to its result file (per the `codex-result-handling` skill) and fence-wraps the body to preserve formatting. For gate purposes (block / approve), the orchestrator normalizes each reviewer's source vocabulary to a binary decision per the table below.

**Verdict normalization.** The two reviewers ship with different source vocabularies. The orchestrator maps each to a normalized binary verdict for gate evaluation while preserving the body text verbatim for the PR description:

| Reviewer | Source vocabulary | Normalized → | Schema reference |
|----------|-------------------|--------------|------------------|
| Claude `on-loop:reviewer` | `APPROVE` / `REQUEST_CHANGES` | approve / block | on-loop plugin convention |
| Codex `codex-plugin-cc` | `approve` / `needs-attention` | approve / block | `codex/schemas/review-output.schema.json` |

The mapping is fixed: `APPROVE` and `approve` → approve; `REQUEST_CHANGES` and `needs-attention` → block. Anything else (malformed JSON, missing verdict field, partial output) is treated as `[codex-unavailable] malformed-output` for the Codex side and `[claude-review-error] malformed-output` for the Claude side, and the gate falls back to the other reviewer alone. **Block from either side blocks merge.** Body text from both reviewers is preserved verbatim in the PR description per the `codex-result-handling` skill — the orchestrator never paraphrases or merges the two bodies.

The four outcome cases (using normalized verdicts):

| Claude (normalized) | Codex (normalized) | Result |
|---------------------|--------------------|--------|
| approve | approve | Merge clear; orchestrator proceeds to GIT phase. |
| approve | block | Blocked. Both verdicts presented verbatim. Operator decides which Codex findings (if any) to address. |
| block | approve | Blocked. Both verdicts presented verbatim. Operator addresses Claude's findings; Codex's approve is informational. |
| block | block | Blocked. Operator addresses the union of both findings. |

A fifth case: **Codex unavailable** (`/codex:status` reports not-installed, not-authenticated, or version below `codex-cli 0.130.0`). The orchestrator appends `[codex-unavailable] <reason>` to `changes.log`, posts a `## Codex adversarial review: SKIPPED — codex unavailable` placeholder in the PR description, and gates on Claude's verdict alone. The PR is not blocked on tooling state.

**Deadlock adjudication.** A two-reviewer face-off can produce non-convergent verdicts: Claude says fix X, the operator fixes X, Codex now complains about Y; the operator fixes Y, Claude re-objects to a Y-side consequence; and so on. If three REVIEW iterations on the same PR produce non-convergent verdicts (Claude and Codex disagree on what to fix, and subsequent revisions trigger fresh objections from the side that previously approved), the orchestrator surfaces both verdict transcripts to the operator with a `[review-deadlock]` tag in `changes.log` and a `## Review deadlock` section in the PR description listing the three iterations. The operator then chooses:

- **(a) Take a side with explicit rationale.** The operator picks one reviewer's verdict as authoritative, records the rationale in the PR body (`## Deadlock resolution: took <Claude|Codex>'s side because <reason>`), and merges. The deadlock-resolution record is part of the PR audit trail per the `codex-result-handling` skill.
- **(b) Split the spec into smaller scoped PRs.** The operator closes the deadlocked PR and re-architects the change as two or more smaller PRs, each scoped narrowly enough that both reviewers can approve it independently. This is the preferred path when the deadlock reflects genuine scope contention rather than reviewer disagreement.

There is no automatic override. The orchestrator does not silently take a side, does not weight one reviewer above the other, and does not increase the retry count past three. Deadlock is an operator decision, recorded explicitly.

**Hard rule (per `codex-result-handling`): never auto-apply Codex review findings.** The verdict is always presented verbatim and the operator decides. This rule exists because Codex's verdicts are adversarially framed by design — an automatic apply pass would mechanically rewrite the diff to satisfy Codex's complaints without operator judgement about which complaints are load-bearing and which are stylistic. CLAUDE.md encodes the same rule as a hard "don't".

## 5. `/codex:setup` recovery flow

When Codex breaks (auth expired, CLI removed, version too old, plugin unloaded), recover in this order:

1. Run `/codex:status` from inside the Claude Code session. The output tells you which layer is broken.
2. **Auth expired** — run `/codex:setup` again and follow the prompts. This refreshes the OpenAI credential without touching the CLI binary.
3. **CLI missing** — the plugin bundles a CLI installer; run `/codex:setup` (which will detect the missing CLI and reinstall it) or install manually via `brew install codex-cli` (or platform equivalent). Confirm with `codex --version`.
4. **Version too old** (`codex-cli < 0.130.0`) — upgrade with `brew upgrade codex-cli` or the platform equivalent. Re-run `/codex:status` to confirm.
5. **Plugin unloaded** — run `/plugin install codex@openai-codex` to re-install the plugin and then `/codex:setup` to re-authenticate.

If Codex still does not work after these steps, leave it disabled and continue. The orchestrator's `[codex-unavailable]` fallback (Section 2 + Section 4) lets the pipeline proceed on Claude alone — Codex is high-leverage, not load-bearing.

Do not attempt any of these recovery steps from inside an active `/on-loop` run. Codex install state is an operator concern handled between runs, not a thing the harness mutates mid-pipeline.

## 6. Mode mapping (mise-en-place)

Codex's commands compose with the four-principles `mise-en-place` behavioral contract via the mode the operator is currently in. Each mode authorizes a different subset of Codex commands:

| Mode | Authorized Codex commands | Rationale |
|------|---------------------------|-----------|
| `review` | `/codex:review`, `/codex:adversarial-review` | Review mode reads code and reports findings; Codex is legitimate as a second reviewer. |
| `firefight` | `/codex:rescue` | Firefight authorizes write-capable escape valves; Codex rescue is one. |
| `build` | (none — orchestrator-only) | Build mode runs through `/on-loop`, which auto-dispatches Codex at REVIEW and CODE retry-exhaust. The operator does not invoke Codex directly during a build. |
| `spec` | (none) | Spec mode is architect/orchestrator territory — Codex enters at CODE or REVIEW only, never during specification. |
| `plan` | (none) | Plan mode is architect/orchestrator territory — same reasoning as `spec`. |

`/codex:setup`, `/codex:status`, `/codex:result`, and `/codex:cancel` are operator infrastructure commands and are authorized in any mode (they do not consume CODE / REVIEW cycles).

**Venue policy.** Independent of mode, Codex authorization also depends on the deployment venue (per ADR-013 commitment 4 and ADR-012):

| Venue | Codex teammate posture | Rationale |
|-------|------------------------|-----------|
| Mirepoix-build (default) | Enabled. REVIEW dispatches Claude + Codex in parallel; CODE retry-exhaust dispatches `codex:codex-rescue`. | Standard egress; Codex's auth path to OpenAI is reachable; ADR-013 commitments 1–3 apply as written. |
| Mirepoix-secure | **Disabled by default.** Every REVIEW emits `[codex-unavailable] mirepoix-secure-default`; CODE retry-exhaust does not dispatch `codex:codex-rescue`. | ADR-010's deny-all-egress posture precludes Codex's auth path. Re-enabling requires a **superseding ADR** that explicitly weakens ADR-010 — not a runbook tweak. |

Operator-direct Codex commands (`/codex:review`, `/codex:adversarial-review`, `/codex:rescue`, etc.) are also disabled on Mirepoix-secure by default for the same reason — the locked host has no path to OpenAI, so the commands would fail at `/codex:status` regardless. Do not attempt to bypass the venue check (e.g., by tunneling Codex via the side-by-side bastion) without a superseding ADR that explicitly authorizes the change to ADR-010's blast radius.

## 7. What NOT to do

- **Do not auto-apply Codex review findings.** Per the `codex-result-handling` skill (and ADR-013's Decision), Codex's verdict is presented verbatim; the operator decides which findings to address. Mechanical-rewrite-to-satisfy-Codex is forbidden.
- **Do not swap Codex's rescue output past TEST, SECURITY, or REVIEW.** The rescue output re-enters all three gates with full containment per §2 (touched-file allowlist check, full TEST + SECURITY re-run, fresh REVIEW face-off). If any gate fails on the rescue output, the rescue diff is reverted and the PR does not land — the operator intervenes. The escape valve is not "skip the gates", and it is not "skip only REVIEW".
- **Do not enable Codex on Mirepoix-secure without a superseding ADR weakening ADR-010.** The venue policy in §6 makes Codex-disabled the default on Mirepoix-secure. The locked host's deny-all-egress posture is load-bearing for ADR-010, and runbook tweaks or environment variables cannot re-enable Codex on Mirepoix-secure — only a new ADR that explicitly authorizes the change to ADR-010's blast radius can.
- **Do not dispatch Codex during SPEC, PLAN, TEST, SECURITY, DOC, or BUILD phases.** Codex enters the pipeline only at CODE (retry-exhaust) and REVIEW (default-on). Other phases are architect / Claude territory.
- **Do not upgrade `codex-cli` from inside an `/on-loop` run.** Codex install state is an operator concern handled between runs. Upgrading mid-pipeline risks `/codex:status` returning a different version partway through REVIEW, with the orchestrator already mid-flight.
- **Do not SHA-pin `codex-cli` from this repo.** The Codex plugin's version is governed operator-side via `/plugin install codex@openai-codex` and the plugin marketplace's manifest. Pinning here would create a false-coupling between Mirepoix's PR cadence and OpenAI's plugin release cadence.
- **Do not manually invoke `/codex:review` or `/codex:adversarial-review` against a branch that is currently inside an `/on-loop` REVIEW.** The orchestrator is already dispatching the same command; a manual second invocation creates duplicate verdicts in the PR body.

## 8. Sub-phase E forward-compat

Sub-phase E (Mirepoix-the-harness running its own on-loop on scotty-gpu, the locked host) does **not** inherit the Mirepoix-build Codex-default. Per ADR-013 commitment 4 and the venue policy in §6, **Codex is disabled by default on Mirepoix-secure** — the locked host's deny-all-egress posture under ADR-010 precludes Codex's API path to OpenAI from inside the lockdown, and re-enabling Codex requires a **superseding ADR that explicitly weakens ADR-010** (not a runbook tweak, environment variable, or operator override).

The steady state on Mirepoix-secure under v1:

- REVIEW dispatches Claude-only (no Codex face-off). The orchestrator emits `[codex-unavailable] mirepoix-secure-default` to `changes.log` without probing `/codex:status` and posts a `## Codex adversarial review: SKIPPED — mirepoix-secure venue (ADR-010)` placeholder in the PR description.
- CODE retry-exhaust does not dispatch `codex:codex-rescue`. After three Claude coding attempts fail against TEST or SECURITY, the pipeline ends with operator intervention required — the Codex rescue escape valve is a Mirepoix-build affordance only.
- Operator-direct Codex commands (`/codex:review`, `/codex:adversarial-review`, `/codex:rescue`, etc.) are not available; the locked host has no path to OpenAI for them to succeed against.

**Forward-compat hooks.** When the JSONL audit gap from ADR-013's Known gaps section lands (`codex:verdict`, `codex:rescue-start`, `codex:rescue-end`, `codex:unavailable` event arms), Mirepoix-secure runs will emit `codex:unavailable` at REVIEW dispatch with `payload: { reason: "mirepoix-secure-default" }` so the JSONL session log records the venue-default-skip explicitly. Until those event arms exist, the venue-default-skip is recorded only in `changes.log` and the PR body — same gap as Mirepoix-build per ADR-013 Known gaps.

The Mirepoix-secure runbook (`docs/MIREPOIX-SECURE-RUNBOOK.md`) will gain a Codex section cross-referencing this section once sub-phase E lands the harness-on-scotty-gpu work. Re-enabling Codex on Mirepoix-secure — at any future point — requires raising a superseding ADR that explicitly authorizes the change to ADR-010's blast radius. The bastion-mediated-tunnel alternative is explicitly rejected per ADR-013's alternatives-considered: ADR-010 defines the side-by-side bastion as a narrow operator tunnel host, not a credential or token relay.
