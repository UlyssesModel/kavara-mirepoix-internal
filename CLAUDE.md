# CLAUDE.md — Kavara-Mirepoix Internal

Auto-loaded by Claude Code at session start. Project context for an agent working on the Kavara-Mirepoix harness.

## What you are working on

This is the source code for **Mirepoix** — Kavara's TypeScript-first coding-agent harness. Four-package monorepo:

```
packages/
├── ai/      provider abstraction (OpenAI-compatible + Qwen-via-Ollama rehydration)
├── coding/  base tools: bash, read, write, edit
├── core/    typed event bus, Session, JSONL log, agent loop
└── cli/     command-line entry (sub-phase D in progress)
```

## Architectural commitments — read before substantial changes

These ADRs are load-bearing. Do not contradict them without a superseding ADR:

- [`adrs/ADR-001`](adrs/ADR-001-minimal-core-and-package-boundaries.md) — four packages, <5kloc core budget
- [`adrs/ADR-002`](adrs/ADR-002-tool-surface-and-security-posture.md) — four base tools, **bash unrestricted, no permission dialogs, no allowlists, no cwd guards**
- [`adrs/ADR-003`](adrs/ADR-003-extension-model-and-self-modification.md) — TypeScript extensions, the harness writes its own
- [`adrs/ADR-004`](adrs/ADR-004-event-bus-over-hook-process-model.md) — typed in-process event bus, **never hook-spawn-process**
- [`adrs/ADR-005`](adrs/ADR-005-context-ownership-and-observability.md) — full context visibility, JSONL session log = source of truth, **no auto-pruning, no silent injection**
- [`adrs/ADR-010`](adrs/ADR-010-mirepoix-secure-and-scotty-gpu-pilot.md) — Mirepoix-secure deployment posture (deny-all-egress + side-by-side bastion)

## Conventions

- **TypeScript-first.** All source is `.ts`. Bun is the runtime, not Node. The lockfile is `bun.lock` (text), not `bun.lockb`.
- **Workspace deps via `workspace:*` protocol.** First cross-package import lives in `packages/core/package.json` (depends on `@mirepoix/ai`). `core ↛ coding` — tools are dependency-injected via `RunOptions.tools`.
- **camelCase for JSONL payload fields** (NQ-4 from sub-phase C). The CLI produces camelCase event payloads (`ollamaUrl`, `sessionId`, `systemPromptFile`, `workingDir`, `messagesCount`, etc.).
- **Error serialization in JSONL must be faithful** (NQ-13). `Error` instances must be replaced with `{ name, message, stack }`, not `{}` (the default `JSON.stringify` returns `{}` for non-enumerable Error properties — install an Error-aware replacer in `packages/core/src/log.ts`).
- **System prompts live in `packages/<pkg>/src/prompts/*.md`** (sub-phase D commitment), not hardcoded in TypeScript.
- **CI workflows** must SHA-pin GitHub Actions and declare `permissions: contents: read` explicitly.
- **Spec `## Deliverables` section** required. Every spec at `specs/<name>.md` MUST include a `## Deliverables` H2 section listing repo-relative paths it commits to producing, one per markdown bullet of the form `` - `path/to/file` ``. CI runs [`scripts/check-deliverables.sh`](scripts/check-deliverables.sh) against the latest spec on every PR; an undeclared or unstaged path is a hard fail. For decision-only specs, the section reads `None.` with an explanatory sentence. Caveat: trailing-slash directory entries (e.g., `` `packages/cli/src/` ``) pass the check if any file under the prefix is tracked — list individual files for stricter coverage. See [`specs/harness-deliverable-tracking.md`](specs/harness-deliverable-tracking.md).

## Multi-agent face-off (Codex as teammate)

Per [ADR-013](adrs/ADR-013-codex-as-teammate.md), the on-loop pipeline runs Claude and Codex as two teammates **on Mirepoix-build only**. The venue policy is load-bearing — see [ADR-012](adrs/ADR-012-two-venue-deployment-model.md) for venue definitions and ADR-013 commitment 4 for the split:

- **Venue policy (Mirepoix-build vs Mirepoix-secure)**: the Codex teammate is enabled by default on **Mirepoix-build** (`kavara-builder` and operator-workstation runs against non-confidential specs). It is **disabled by default on Mirepoix-secure** (`scotty-gpu` deny-all-egress posture per ADR-010 precludes Codex's auth path). Re-enabling Codex on Mirepoix-secure requires a **superseding ADR that explicitly weakens ADR-010** — not a runbook tweak, env var, or operator override.
- **REVIEW phase (default-on, Mirepoix-build)**: when `/on-loop` reaches REVIEW, the orchestrator dispatches BOTH the Claude reviewer agent AND `/codex:adversarial-review` on the same branch, in parallel. Both verdicts are presented verbatim; either REQUEST_CHANGES (Claude) or needs-attention (Codex) blocks merge. The orchestrator normalizes each reviewer's source vocabulary to a binary block/approve decision; see RUNBOOK §4 for the normalization table and deadlock adjudication rules.
- **CODE phase (retry-exhaust fallback, Mirepoix-build)**: after 3 retries against the Claude coding agent (TEST or SECURITY blocking), the orchestrator dispatches `codex:codex-rescue` with the accumulated feedback. Rescue containment: the orchestrator verifies the rescue's touched files are within the spec's diff allowlist, re-runs FULL TEST + SECURITY, and dispatches a fresh REVIEW face-off on the rescue output. Rescue does NOT skip any gate; see RUNBOOK §2 for the containment sequence.
- **Architect output style**: per the `gpt-5-4-prompting` skill that ships with `codex-plugin-cc`, the architect's notes adopt XML-block sections (`<task>`, `<structured_output_contract>`, `<default_follow_through_policy>`, `<verification_loop>`, `<grounding_rules>`, `<action_safety>`) instead of plain markdown headers for the load-bearing structure. This tightens the contract with downstream agents and is required for any prompt that's eventually dispatched to Codex.
- **Codex unavailable (Mirepoix-build)**: if `/codex:status` reports Codex not installed, not authenticated, or version-incompatible, the orchestrator falls back to Claude-only review/code and logs a `[codex-unavailable]` warning in the session's `changes.log`. The PR is not blocked on tooling state. On Mirepoix-secure this is the steady state per venue policy (above); the orchestrator emits `[codex-unavailable] mirepoix-secure-default` at REVIEW dispatch without probing `/codex:status`.
- **Enforcement is convention-only in v1**: the on-loop plugin source is unchanged in this PR (cross-repo). CLAUDE.md is the load-bearing mechanism that propagates the default-on convention; a future cross-repo PR to `openai/on-loop` will gate REVIEW dispatch on the convention. Until that lands, default-on is honored by reading CLAUDE.md, not enforced by code.

Operator-direct Codex commands (outside the on-loop pipeline) remain available **on Mirepoix-build**: see [`docs/CODEX-TEAMMATE-RUNBOOK.md`](docs/CODEX-TEAMMATE-RUNBOOK.md).

## Deployment venues

Mirepoix has **two standard postures**, per [ADR-012](adrs/ADR-012-two-venue-deployment-model.md):

- **Mirepoix-build** — `kavara-builder` always-on Debian VM on GCP. Standard egress, Tailscale-reachable directly (no bastion). CPU-only. **This is the default** for non-confidential Mirepoix development: harness work, public image builds, ad-hoc engineering, on-loop runs against non-confidential specs.
- **Mirepoix-secure** — `scotty-gpu` A100 host with continuous deny-all-egress, IAP-only break-glass, side-by-side bastion. Local Ollama serving Qwen2.5-Coder on loopback. **Exception only** for Kirk-confidential workloads where the source must never touch hyperscaler APIs.

When in doubt, the work belongs on Mirepoix-build. Mirepoix-secure is for workloads that explicitly require auditable isolation from the public internet at the execution host.

**Hard rule**: Kirk-real (proprietary-algorithm-bearing) container images build only on TDX-attested appliance hosts. Neither Mirepoix-build nor Mirepoix-secure is authorized to build them.

## Smoke test

The current smoke fixture is `multihead_attention.py` (multi-head attention, ~80 lines) translated to Rust+candle on **scotty-gpu** (Mirepoix-secure validates against the full posture). JSONL acceptance schema: [`specs/smoke-test-acceptance.md`](specs/smoke-test-acceptance.md). Acceptance script: [`scripts/smoke-accept.sh`](scripts/smoke-accept.sh).

Phase One landed via this gate; D.1 retired the spike on a green smoke. The schema + script remain in-repo as the regression contract for any future CLI changes touching the JSONL surface.

For routine development testing on non-confidential fixtures, run the same smoke on `kavara-builder` (Mirepoix-build) — same CLI, same expected JSONL shape. Model provider on Mirepoix-build is one of: (a) hyperscaler API (Claude / OpenAI), or (b) scotty-gpu's Ollama at `http://10.128.0.16:11434/v1` over the internal subnet (works because scotty-gpu's deny rule is on egress, not ingress, and `default-allow-internal` permits the connection — no Tailscale on scotty-gpu required). Option (b) is preferred when verifying that a CLI which works on Mirepoix-build will also work on Mirepoix-secure under the same model.

## On-loop discipline

Substantial PRs land via `/on-loop ./specs/<sub-phase>.md` in a Claude Code session. The pipeline is architect → coding → testing → security → docs+build → review → git → CI. Worktrees: `.claude/worktrees/<sub-phase>` (gitignored). Session audit logs: `.on-loop/sessions/` (gitignored, persistent for resume).

Phase One sub-phases shipped: A, B, B.1, C, D, D.1. Queued: E (self-modification mechanics on the locked host).

## Hard "don't"s during agent work

- Adding CI `permissions` beyond `contents: read` without explicit justification
- Adding `bash` allowlists, cwd guards, or path filters (contradicts ADR-002)
- CI workflows that reach out to network (must be deterministic against the local cache)
- Renaming `bun.lock` back to `bun.lockb` (Bun's text format is current; the spec for B.1 had a typo on this point)
- Inventing helper functions / files that don't trace back to existing source (sub-phase B caveat — the model has been known to hallucinate `./utils` when uncertain)
- Auto-apply Codex review findings — the `codex-result-handling` skill explicitly forbids this. Always present verbatim and ask which findings (if any) the operator wants addressed.
- Dispatch Codex during SPEC or PLAN phases — architect/orchestrator territory. Codex enters at CODE (retry-exhaust) and REVIEW (default-on) only.
- Enable Codex on Mirepoix-secure without a superseding ADR weakening ADR-010 — the deny-all-egress posture of the locked host is load-bearing. Runbook tweaks, environment variables, and operator overrides cannot re-enable Codex on Mirepoix-secure; only a new ADR that explicitly authorizes the change to ADR-010's blast radius can.
- Land a sub-phase spec without a `## Deliverables` section — CI will reject the PR. See [`specs/harness-deliverable-tracking.md`](specs/harness-deliverable-tracking.md).

## Quick references

- Architecture overview: [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md)
- Deployment: [`docs/MIREPOIX-SECURE-RUNBOOK.md`](docs/MIREPOIX-SECURE-RUNBOOK.md)
- Acceptance schema (JSONL regression contract): [`specs/smoke-test-acceptance.md`](specs/smoke-test-acceptance.md)
- Last shipped spec: [`specs/sub-phase-d1-spike-retirement.md`](specs/sub-phase-d1-spike-retirement.md)

## Useful commands

```sh
bun install               # workspace install (idempotent)
bun test                  # workspace-wide tests
bunx biome check .        # lint + format
bunx tsc --noEmit         # type-check all packages
gh pr checks <PR>         # CI status for an open PR
git log --oneline | head  # quick history glance
```
