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

`phase-zero-spike/mirepoix-spike.ts` is the original single-file harness, **preserved** until the new CLI is validated against it (sub-phase D.1, gated on the JSONL smoke acceptance at [`specs/smoke-test-acceptance.md`](specs/smoke-test-acceptance.md)).

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
- **camelCase for JSONL payload fields** (NQ-4 from sub-phase C). The spike's payloads used snake_case; the new CLI must produce camelCase event payloads (`ollamaUrl`, `sessionId`, `systemPromptFile`, `workingDir`, `messagesCount`, etc.).
- **Do not modify `phase-zero-spike/mirepoix-spike.ts`.** The spike is the fallback while the new CLI is being proven. It retires in sub-phase D.1, never before.
- **Error serialization in JSONL must be faithful** (NQ-13). `Error` instances must be replaced with `{ name, message, stack }`, not `{}` (the default `JSON.stringify` returns `{}` for non-enumerable Error properties — install an Error-aware replacer in `packages/core/src/log.ts`).
- **System prompts live in `packages/<pkg>/src/prompts/*.md`** (sub-phase D commitment), not hardcoded in TypeScript.
- **CI workflows** must SHA-pin GitHub Actions and declare `permissions: contents: read` explicitly.

## Deployment venues

Mirepoix has **two standard postures**, per [ADR-012](adrs/ADR-012-two-venue-deployment-model.md):

- **Mirepoix-build** — `kavara-builder` always-on Debian VM on GCP. Standard egress, Tailscale-reachable directly (no bastion). CPU-only. **This is the default** for non-confidential Mirepoix development: harness work, public image builds, ad-hoc engineering, on-loop runs against non-confidential specs.
- **Mirepoix-secure** — `scotty-gpu` A100 host with continuous deny-all-egress, IAP-only break-glass, side-by-side bastion. Local Ollama serving Qwen2.5-Coder on loopback. **Exception only** for Kirk-confidential workloads where the source must never touch hyperscaler APIs.

When in doubt, the work belongs on Mirepoix-build. Mirepoix-secure is for workloads that explicitly require auditable isolation from the public internet at the execution host.

**Hard rule**: Kirk-real (proprietary-algorithm-bearing) container images build only on TDX-attested appliance hosts. Neither Mirepoix-build nor Mirepoix-secure is authorized to build them.

## Smoke test

The current smoke fixture is `multihead_attention.py` (multi-head attention, ~80 lines) translated to Rust+candle on **scotty-gpu** (Mirepoix-secure validates against the full posture). JSONL acceptance schema: [`specs/smoke-test-acceptance.md`](specs/smoke-test-acceptance.md). Acceptance script: [`scripts/smoke-accept.sh`](scripts/smoke-accept.sh).

**Pass on the schema is the gate that authorizes sub-phase D.1 (spike retirement).** No other gate counts.

For routine development testing on non-confidential fixtures, run the same smoke on `kavara-builder` (Mirepoix-build) — same CLI, same expected JSONL shape. Model provider on Mirepoix-build is one of: (a) hyperscaler API (Claude / OpenAI), or (b) scotty-gpu's Ollama at `http://10.128.0.16:11434/v1` over the internal subnet (works because scotty-gpu's deny rule is on egress, not ingress, and `default-allow-internal` permits the connection — no Tailscale on scotty-gpu required). Option (b) is preferred when verifying that a CLI which works on Mirepoix-build will also work on Mirepoix-secure under the same model.

## On-loop discipline

Substantial PRs land via `/on-loop ./specs/<sub-phase>.md` in a Claude Code session. The pipeline is architect → coding → testing → security → docs+build → review → git → CI. Worktrees: `.claude/worktrees/<sub-phase>` (gitignored). Session audit logs: `.on-loop/sessions/` (gitignored, persistent for resume).

Sub-phases shipped: A, B, B.1, C. In progress: D. Queued: D.1, E.

## Hard "don't"s during agent work

- Spike modifications (any edit to `phase-zero-spike/*`)
- Adding CI `permissions` beyond `contents: read` without explicit justification
- Adding `bash` allowlists, cwd guards, or path filters (contradicts ADR-002)
- CI workflows that reach out to network (must be deterministic against the local cache)
- Coupling spike retirement (D.1) to non-destructive work in the same PR
- Renaming `bun.lock` back to `bun.lockb` (Bun's text format is current; the spec for B.1 had a typo on this point)
- Inventing helper functions / files that don't trace back to existing source (sub-phase B caveat — the model has been known to hallucinate `./utils` when uncertain)

## Quick references

- Architecture overview: [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md)
- Deployment: [`docs/MIREPOIX-SECURE-RUNBOOK.md`](docs/MIREPOIX-SECURE-RUNBOOK.md)
- Currently-active spec: [`specs/sub-phase-d.md`](specs/sub-phase-d.md)
- Acceptance schema for spike retirement: [`specs/smoke-test-acceptance.md`](specs/smoke-test-acceptance.md)
- Queued spec: [`specs/sub-phase-d1-spike-retirement.md`](specs/sub-phase-d1-spike-retirement.md)

## Useful commands

```sh
bun install               # workspace install (idempotent)
bun test                  # workspace-wide tests
bunx biome check .        # lint + format
bunx tsc --noEmit         # type-check all packages
gh pr checks <PR>         # CI status for an open PR
git log --oneline | head  # quick history glance
```
