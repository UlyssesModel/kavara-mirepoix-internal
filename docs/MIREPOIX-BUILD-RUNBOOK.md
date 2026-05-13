# Mirepoix-build deployment runbook

This is the Mirepoix-specific layer on top of the canonical Kavara Builder runbook. It captures how to install Mirepoix on `kavara-builder` (or any host of the same shape), configure the model provider, run the harness, and decide when a workload belongs on Mirepoix-secure instead.

The host provisioning runbook — VM creation, Docker, Tailscale, ACLs, cost management, decommissioning — is canonical at [Confluence PE/106233857 — Kavara Builder — Always-On Linux Build Host](https://kavara.atlassian.net/wiki/spaces/PE/pages/106233857/Kavara+Builder+Always-On+Linux+Build+Host). Read that first. This document does **not** duplicate it; it adds only the Mirepoix layer.

## What this is

Mirepoix-build is the **default Mirepoix deployment posture** per [ADR-012](../adrs/ADR-012-two-venue-deployment-model.md). The host is `kavara-builder` (or successors of the same shape): always-on Debian 12 VM on GCP, standard egress, Tailscale-reachable for operators, CPU-only, no on-host model. The Mirepoix harness running on Mirepoix-build uses an external model provider — hyperscaler API or scotty-gpu's Ollama over the GCP VPC.

Use Mirepoix-build for everyday Mirepoix work: harness development, public image builds, translations of non-confidential code, on-loop pipeline runs against non-confidential specs, smoke testing.

Use [Mirepoix-secure](MIREPOIX-SECURE-RUNBOOK.md) (the alternative posture, on `scotty-gpu`) only when the workload's confidentiality requires zero hyperscaler API exposure at the execution host.

## Prerequisites

1. **`kavara-builder` is provisioned** per [Confluence PE/106233857](https://kavara.atlassian.net/wiki/spaces/PE/pages/106233857). Tailscale is up. Docker is installed. The operator can `ssh kavara-builder` over the tailnet.
2. **Operator's SSH key is on GitHub** — either as a personal authentication key, or as a deploy key on `UlyssesModel/kavara-mirepoix-internal` if Kavara org policy authorizes deploy keys. (Per session history 2026-05-09, org policy currently disables deploy keys; personal key is the working path.)
3. **GCP IAM** — operator has `roles/compute.instanceAdmin.v1` or equivalent for stopping/starting the VM if cost-management cycling is needed.

## Step 1 — Install Mirepoix on kavara-builder

From the Mac, SSH into kavara-builder (operator-to-host over Tailscale):

```sh
ssh kavara-builder
```

On kavara-builder, install the Bun runtime and clone the repository:

```sh
mkdir -p ~/workspaces && cd ~/workspaces
git clone git@github.com:UlyssesModel/kavara-mirepoix-internal.git
cd kavara-mirepoix-internal

# Install Bun (Mirepoix's TypeScript runtime)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version

# Workspace install
bun install

# Verify the four-package surface compiles
bunx tsc --noEmit
```

GitHub auth from kavara-builder uses standard SSH to `git@github.com` over the host's external IP (public-internet egress). No ProxyJump, no bastion — kavara-builder has no deny-egress posture to work around.

## Step 2 — Configure the model provider

Mirepoix-build has no on-host model. Pick one provider per [ADR-012](../adrs/ADR-012-two-venue-deployment-model.md):

**Option A — scotty-gpu's Ollama over the GCP VPC (recommended for cross-venue consistency):**

```sh
export OLLAMA_URL=http://10.128.0.16:11434/v1
export MIREPOIX_MODEL=qwen2.5-coder:32b-instruct
```

Verify reachability:

```sh
curl -sS --max-time 5 http://10.128.0.16:11434/api/tags | jq -r '.models[].name'
```

Should print the four models on scotty-gpu (qwen2.5-coder:32b-instruct, gemma3:12b, gemma4:26b, gemma4:31b). This path uses the GCP-internal subnet — same model the Mirepoix-secure smoke validates against, no Tailscale needed on scotty-gpu, no compromise to scotty-gpu's deny-egress posture (which is on egress, not ingress).

**Option B — Hyperscaler API (Claude / OpenAI):**

```sh
export OLLAMA_URL=https://api.anthropic.com/v1   # or OpenAI equivalent
export ANTHROPIC_API_KEY=<your-key>              # or OPENAI_API_KEY
export MIREPOIX_MODEL=claude-sonnet-4-6          # or gpt-4-class equivalent
```

Faster per-token, easier setup, no dependency on scotty-gpu being up. Use when the workload is genuinely non-confidential and the marginal cost of API tokens is acceptable.

**Option C — Local Ollama on kavara-builder (for fully offline development):**

```sh
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5-coder:7b-instruct
export OLLAMA_URL=http://127.0.0.1:11434/v1
export MIREPOIX_MODEL=qwen2.5-coder:7b-instruct
```

Slower per-token than scotty-gpu's A100-served 32B model. Useful only when scotty-gpu is unavailable.

## Step 3 — Run a smoke or development task

Once the model provider is configured, invoke the harness on a fixture or working repo. Phase Zero spike example (pre-Phase-D):

```sh
cd ~/workspaces/kavara-mirepoix-internal
bun phase-zero-spike/mirepoix-spike.ts \
  --system-prompt-file=PATH \
  --cwd=$HOME/workspaces/some-source-tree \
  "describe the task here"
```

Post-Phase-D (when `@mirepoix/cli` is the canonical entry):

```sh
bun packages/cli/src/index.ts \
  --system-prompt-file=PATH \
  --cwd=PATH \
  "task"
```

Session logs land at `~/.local/share/mirepoix/sessions/<id>.jsonl` per [ADR-005](../adrs/ADR-005-context-ownership-and-observability.md).

## Step 4 — Run on-loop pipelines

On-loop pipelines for sub-phase specs run inside a Claude Code session on `kavara-builder`. The pattern is identical to running on a Mac workstation; the difference is the always-on VM persists state across operator sessions and eliminates the Mac-sleep-interrupts-the-build class of problem.

```sh
# On kavara-builder
cd ~/workspaces/kavara-mirepoix-internal
claude  # launch Claude Code in this directory
```

Inside the Claude Code session:

```
/on-loop ./specs/<sub-phase>.md
```

Worktrees land at `.claude/worktrees/<sub-phase>` (gitignored). Session logs at `.on-loop/sessions/` (gitignored, persistent for resume).

## When to escalate to Mirepoix-secure

A workload belongs on Mirepoix-secure ([scotty-gpu, MIREPOIX-SECURE-RUNBOOK.md](MIREPOIX-SECURE-RUNBOOK.md)) when **all** of the following are true:

- The source material is Kirk-confidential or otherwise must not touch a hyperscaler API
- The workload's output is itself confidential and must not leave the locked host
- Auditable isolation from the public internet at the execution host is a stated requirement

Otherwise, the workload belongs on Mirepoix-build. The two-posture rule from ADR-012 is: **default to Mirepoix-build; escalate only when the confidentiality posture is articulated**.

A passing smoke on Mirepoix-build does **not** authorize spike retirement (see `specs/sub-phase-d1-spike-retirement.md`); only a passing Mirepoix-secure smoke does. The two postures are interchangeable in the development-iteration direction; they are not interchangeable in the retirement-authorization direction.

## Hard exclusions

`kavara-builder` does **not** build Kirk-real (proprietary-algorithm-bearing) container images, per the IP-protection boundary documented in the Kavara Builder runbook and in [feedback_ai_agent_boundary_ny5](https://kavara.atlassian.net/wiki/spaces/PE/pages/101810179). Kirk-real builds happen only on TDX-attested appliance hosts. Mirepoix-build is for the non-Kirk-real portion of the image build matrix and for Mirepoix's own harness development.

## Cost management

Per the Kavara Builder runbook, kavara-builder costs ~$60/month always-on, ~$10/month stopped. If Mirepoix work is daily, leave it running. If weekly or less, stop it when idle:

```sh
gcloud compute instances stop kavara-builder --zone=us-central1-a
```

Restart and reattach:

```sh
gcloud compute instances start kavara-builder --zone=us-central1-a
# Tailscale reconnects automatically; ~30s
ssh kavara-builder
```

Mirepoix state on the VM is reproducible from GitHub. Nothing on `kavara-builder` is irreplaceable beyond uncommitted local work; commit and push before stopping if you've been editing.

## Decommission

If the VM is being retired, the canonical decommission steps live in the Kavara Builder runbook. Mirepoix-build state on the VM is reproducible — git working copy + Bun install + model-provider env vars. Push any uncommitted work to GitHub first, then follow the Confluence runbook's decommission instructions.

## Cross-references

- **Architectural commitment**: [ADR-012 — Two-venue Mirepoix deployment model](../adrs/ADR-012-two-venue-deployment-model.md)
- **Canonical host runbook**: [Confluence PE/106233857 — Kavara Builder — Always-On Linux Build Host](https://kavara.atlassian.net/wiki/spaces/PE/pages/106233857/Kavara+Builder+Always-On+Linux+Build+Host)
- **Counterpart posture**: [Mirepoix-secure runbook](MIREPOIX-SECURE-RUNBOOK.md) per [ADR-010](../adrs/ADR-010-mirepoix-secure-and-scotty-gpu-pilot.md)
- **Smoke-test acceptance**: `specs/smoke-test-acceptance.md`
- **Project-context for agents**: `CLAUDE.md` at the repo root
