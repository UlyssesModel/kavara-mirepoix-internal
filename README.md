# Mirepoix Internal

[![CI](https://github.com/UlyssesModel/kavara-mirepoix-internal/actions/workflows/ci.yml/badge.svg)](https://github.com/UlyssesModel/kavara-mirepoix-internal/actions/workflows/ci.yml)

The Kavara-confidential half of the Kavara-Mirepoix distribution. The four-package TypeScript monorepo that delivers Mirepoix — Kavara's coding-agent harness — together with the ADRs, deployment runbook, and audit baselines that anchor the architecture. **Not for external distribution.**

## What this repository is

Per [ADR-007](adrs/ADR-007-layered-distribution-and-license-tagging.md), Kavara-Mirepoix is physically split across two repositories. This is the private surface:

- The Mirepoix harness source as the four `@mirepoix/*` packages
- Architecture Decision Records (ADRs 001–010)
- The Mirepoix-secure deployment runbook at [`docs/MIREPOIX-SECURE-RUNBOOK.md`](docs/MIREPOIX-SECURE-RUNBOOK.md)
- Audit baselines for the locked-host deployment ([`docs/SCOTTY-GPU-PREMIGRATION-AUDIT.md`](docs/SCOTTY-GPU-PREMIGRATION-AUDIT.md), [`docs/INFRASTRUCTURE-AUDIT.md`](docs/INFRASTRUCTURE-AUDIT.md))
- Per-sub-phase design docs for Phase One under [`specs/`](specs/)

The public surface lives at [`UlyssesModel/kavara-mirepoix`](https://github.com/UlyssesModel/kavara-mirepoix) and contains only `public`-tagged content.

## Status

| Phase | State |
|---|---|
| **Phase Zero** — single-file spike, validated the architecture end-to-end on scotty-gpu under deny-all-egress | ✅ Complete (retired in D.1) |
| **Phase One** — split into `@mirepoix/{ai,core,coding,cli}`, retire the spike | ✅ Complete |

Phase One sub-phase tracker (per [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md)):

| Sub-phase | Scope | State |
|---|---|---|
| A | Scaffold the four-package monorepo | ✅ Merged |
| B | Extract provider + base tools from spike → `@mirepoix/{ai,coding}` | ✅ Merged |
| B.1 | Types (`@types/node`), Biome, GitHub Actions CI workflow | ✅ Merged |
| C | Event bus + Session + JSONL log + agent loop → `@mirepoix/core`. First cross-package import (`core → ai`). | ✅ Merged |
| D | Wire `@mirepoix/cli`, carry NQ-13 (Error-aware JSONL) + NQ-7 (`RunOptions.workingDir`) forward, system prompt extraction, CI hardening (SHA-pin Actions, `permissions: contents: read`) | ✅ Merged |
| D.1 | Retire `phase-zero-spike/` (gated on JSONL smoke pass per [`specs/smoke-test-acceptance.md`](specs/smoke-test-acceptance.md)) | ✅ Merged |

## Packages

| Package | Purpose | Source |
|---|---|---|
| `@mirepoix/ai` | Provider abstraction. Issues tool-using inference requests against an OpenAI-compatible endpoint. Normalizes tool calls across wire formats (the Qwen-via-Ollama emit-tools-as-content rehydration helper). | [`packages/ai/`](packages/ai/) |
| `@mirepoix/coding` | The four base tools per [ADR-002](adrs/ADR-002-tool-surface-and-security-posture.md): `bash`, `read`, `write`, `edit`. Bash is unrestricted; no permission dialogs, no allowlists. | [`packages/coding/`](packages/coding/) |
| `@mirepoix/core` | Kernel: typed in-process event bus per [ADR-004](adrs/ADR-004-event-bus-over-hook-process-model.md), Session lifecycle, JSONL log per [ADR-005](adrs/ADR-005-context-ownership-and-observability.md), agent loop. | [`packages/core/`](packages/core/) |
| `@mirepoix/cli` | Command-line entry point. Composes the three other packages and exposes the `mirepoix` binary. (Sub-phase D scaffold; full implementation in progress.) | [`packages/cli/`](packages/cli/) |

First cross-package import landed in sub-phase C: `core → ai`. The boundary `core ↛ coding` is preserved — tools are dependency-injected via `RunOptions.tools` per ADR-002.

## Architecture

The ten ADRs in [`adrs/`](adrs/) lock the load-bearing decisions. Highlights:

- [ADR-001](adrs/ADR-001-minimal-core-and-package-boundaries.md) — four-package decomposition, <5kloc core budget (currently at ~600 lines across `ai + coding + core`)
- [ADR-002](adrs/ADR-002-tool-surface-and-security-posture.md) — four base tools, bash unrestricted, no permission dialogs
- [ADR-003](adrs/ADR-003-extension-model-and-self-modification.md) — TypeScript extensions with hot reload; the harness writes its own extensions; no marketplace
- [ADR-004](adrs/ADR-004-event-bus-over-hook-process-model.md) — typed in-process event bus, never hook-spawn-process
- [ADR-005](adrs/ADR-005-context-ownership-and-observability.md) — full context visibility, JSONL session log as source of truth, no auto-pruning, no silent injection
- [ADR-007](adrs/ADR-007-layered-distribution-and-license-tagging.md) — three-layer distribution model with per-extension license tagging
- [ADR-008](adrs/ADR-008-model-routing-and-substrate-aware-serving.md) — cascade and task-class routing, multi-substrate Qwen3-Coder fleet
- [ADR-010](adrs/ADR-010-mirepoix-secure-and-scotty-gpu-pilot.md) — Mirepoix-secure deployment posture, scotty-gpu Phase a pilot, side-by-side bastion pattern

## Development

```sh
git clone git@github.com:UlyssesModel/kavara-mirepoix-internal.git
cd kavara-mirepoix-internal
bun install
bun test
bunx biome check .
```

CI runs validators, Biome, type-checks, and per-package surface smoke tests on every PR to `main`. See [`.github/workflows/`](.github/workflows/).

Sub-phase work flows through `/on-loop ./specs/<sub-phase>.md` in a Claude Code session. Worktrees live at `.claude/worktrees/<sub-phase>` (gitignored). Audit logs at `.on-loop/sessions/` (gitignored).

## Deployment venues

Mirepoix has **two standard deployment postures** per [ADR-012](adrs/ADR-012-two-venue-deployment-model.md):

| Venue | Posture | When to use |
|---|---|---|
| **`kavara-builder`** (Mirepoix-build) | Always-on Debian 12 VM on GCP. Standard egress, Tailscale-reachable. CPU-only. | The default. Non-confidential Mirepoix development (the harness itself), public image builds, translations of non-confidential code, anything where the source + target are non-secret. |
| **`scotty-gpu`** (Mirepoix-secure) | A100 GPU host with continuous deny-all-egress, IAP-only break-glass, side-by-side bastion. Local Ollama serving Qwen2.5-Coder on loopback. | Exception. Kirk-confidential code translation; any workload that must run with zero hyperscaler API exposure on the execution host. |

Runbooks:

- **Mirepoix-build** — host operations runbook in Confluence at [PE/106233857 — Kavara Builder — Always-On Linux Build Host](https://kavara.atlassian.net/wiki/spaces/PE/pages/106233857/Kavara+Builder+Always-On+Linux+Build+Host); Mirepoix-specific layer (harness install, model provider, on-loop) in [`docs/MIREPOIX-BUILD-RUNBOOK.md`](docs/MIREPOIX-BUILD-RUNBOOK.md).
- **Mirepoix-secure** — operations runbook in [`docs/MIREPOIX-SECURE-RUNBOOK.md`](docs/MIREPOIX-SECURE-RUNBOOK.md) per [ADR-010](adrs/ADR-010-mirepoix-secure-and-scotty-gpu-pilot.md). Provisioning, the bastion ProxyJump pattern, smoke validation, decommissioning.

**One repository, two venues.** Both Mirepoix-build and Mirepoix-secure read from this single repository as their canonical source — the mirepoix base sits in one place and venues compose on top of it. Per [ADR-012](adrs/ADR-012-two-venue-deployment-model.md), this is the deliberate current shape. Per-venue overlay repositories (e.g., `UlyssesModel/mirepoix-kavara-builder`, `UlyssesModel/mirepoix-scotty-gpu`) are anticipated future state if venue-specific surface accumulates enough to justify separation; they are not required by the current architecture.

Hard boundary: **Kirk-real (proprietary-algorithm-bearing) container images build only on TDX-attested appliance hosts.** Neither Mirepoix venue is authorized to build Kirk-real images. The IP-protection boundary is documented in the Appliance Storage & Runtime Posture doc and in the Kavara Builder runbook above.

Current Mirepoix-secure Phase a target: scotty-gpu (Qwen2.5-Coder-32B-Instruct via Ollama on loopback). Phase b expands to multi-A100 capacity for Qwen3-Coder-480B-A35B-Instruct per [ADR-010](adrs/ADR-010-mirepoix-secure-and-scotty-gpu-pilot.md).

## Repository visibility

This repository **must be private**. The default distribution tag for every extension authored here is `internal` — Kavara-confidential. A public repository containing `internal` content defeats the architectural purpose of the tag.

## Distribution tags

Two tags are valid here:

- **`internal`** (default) — Kavara-confidential. Never publishable to public NPM. Loadable only from this repository or via path reference under a Kavara-internal checkout.
- **`customer-licensed`** — Intended for shipment as part of a Kavara MaaS deliverable. Bundled into signed customer-deliverable artifacts per [ADR-005](adrs/ADR-005-context-ownership-and-observability.md).

Promotion to `public` requires a manifest change + commit + review and a physical move to the public repository. Never a default.

## License

Proprietary, all rights reserved by Kavara. See [`LICENSE`](LICENSE).

## Background

For the broader architectural framing — three-layer Mirepoix model, Software 3.0 distribution thesis, the full ADR set — see [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md) and the public [`UlyssesModel/kavara-mirepoix`](https://github.com/UlyssesModel/kavara-mirepoix) repository.
