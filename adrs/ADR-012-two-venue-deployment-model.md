# ADR-012: Two-venue Mirepoix deployment model — Mirepoix-build alongside Mirepoix-secure

Status: Accepted
Date: 2026-05-13
Deciders: John Edge (CTO)
Supersedes: extends ADR-010 (which committed to Mirepoix-secure as the deployment posture); references the existing Kavara Builder runbook at [Confluence PE/106233857](https://kavara.atlassian.net/wiki/spaces/PE/pages/106233857)

## Context

ADR-010 committed to **Mirepoix-secure** as the Mirepoix deployment posture, with scotty-gpu as the Phase a pilot. That commitment was correct for the workloads Mirepoix-secure was designed for — Kirk-confidential code translation, eventual sub-agent work that must run with no hyperscaler-API exposure on the execution host. But ADR-010 implicitly framed Mirepoix-secure as **the** deployment shape, which over-applies the posture to workloads that don't need its isolation.

In practice, Mirepoix's own development (the sub-phases that produce the harness itself), public image builds, translation work against non-confidential source — and indeed everything we have done in this session — does not need the continuous deny-all-egress + bastion + IAP-only posture. Applying Mirepoix-secure to those workloads costs real ergonomics (no direct egress, no hyperscaler APIs available, brittle dev loop) while buying nothing architecturally because there is no confidential content involved.

A second venue exists: **`kavara-builder`**, a standard always-on Debian 12 VM on GCP, documented at [Confluence PE/106233857 — Kavara Builder — Always-On Linux Build Host](https://kavara.atlassian.net/wiki/spaces/PE/pages/106233857). Created 2026-05-13 as the canonical build host for non-IP Kavara container images, replacing IvorHQ as the single-physical-machine dependency. The host runs Docker, Tailscale, standard egress; it sits in `office-of-cto-491318/us-central1-a/default` alongside scotty-gpu and mirepoix-bastion.

ADR-012 commits to using `kavara-builder` as Mirepoix's **default** deployment venue, and Mirepoix-secure on scotty-gpu as the **exception** invoked when a workload's posture requirements demand it. The two postures are peers — not a hierarchy — distinguished by what workloads each is appropriate for.

## Decision

ADR-012 makes four architectural commitments.

The first commitment is the two-posture deployment model. **Mirepoix runs in two standard postures**, neither of which dominates the other; the choice between them is workload-driven.

**Mirepoix-build** is the default posture. It runs on `kavara-builder` (or its successors of the same shape — always-on Debian/Ubuntu VMs with Docker, Tailscale, and standard egress). The host has no deny-egress firewall and no bastion mediation. Operators reach it directly over Tailscale as `kavara-builder`. The host can reach any hyperscaler API, any public registry (Quay, npm, crates.io), and any GitHub repository the operator's credentials authorize. The Mirepoix harness running on Mirepoix-build uses external model providers — Claude API, OpenAI, or scotty-gpu's Ollama via Tailscale — because the host itself does not serve models.

**Mirepoix-secure** is the exception posture, committed by ADR-010. It runs on `scotty-gpu` (or successors with the same locked-host shape). Continuous deny-all-egress at the IP layer, side-by-side bastion concentrating third-party-trust infrastructure, IAP-only break-glass operator access, local Ollama serving Qwen2.5-Coder on loopback. The harness running on Mirepoix-secure uses only the locally-served model; no hyperscaler API ever sees the workload.

The second commitment is the **workload-allocation rule**. Use Mirepoix-build for:

- All Mirepoix development work that produces the harness itself (sub-phases, ADRs, runbooks, specs)
- Translation work where the source code is non-confidential (open-source code, internal Kavara code that is not Kirk-real)
- Public Kavara container image builds (per the existing Kavara Builder runbook scope)
- On-loop pipeline runs against non-confidential specs
- Smoke testing on non-confidential fixtures
- Any workload where the operator can articulate why hyperscaler API exposure is acceptable

Use Mirepoix-secure for:

- Kirk-confidential code translation (the original motivating workload from ADR-010)
- Any future workload where the source material's confidentiality requires zero hyperscaler API exposure at the execution host
- Validation runs that prove a CLI built on Mirepoix-build also works under the stricter posture (the smoke-test acceptance gate per `specs/smoke-test-acceptance.md`)

If a workload's posture is ambiguous, the default is Mirepoix-build. Moving from Mirepoix-build to Mirepoix-secure requires explicit operator declaration of the confidentiality reason; the reverse direction does not.

The third commitment is the **Kirk-real exclusion boundary**, which applies to **both** Mirepoix venues. Kirk-real (proprietary-algorithm-bearing) container images build only on TDX-attested appliance hosts. Neither Mirepoix-build nor Mirepoix-secure is authorized to build Kirk-real images. This boundary is documented separately in the Appliance Storage & Runtime Posture doc; ADR-012 references it explicitly to prevent confusion when later workloads might naively look at scotty-gpu's GPU-availability and conclude it could host Kirk-real builds. It cannot.

The fourth commitment is the **canonical-source unification — one repository, two venues**. Both Mirepoix-build and Mirepoix-secure pull from the same canonical source: `UlyssesModel/kavara-mirepoix-internal` on GitHub. Working copies on `kavara-builder`, on `scotty-gpu`, and on operator workstations are all peers; the source of truth is GitHub. The pull mechanism differs by posture (Mirepoix-build uses direct git over its standard external IP; Mirepoix-secure uses SSH ProxyJump through the bastion under continuous deny-all-egress per ADR-010), but the canonical source does not.

This is the mirepoix metaphor operating at the repository layer: the *base* sits in one place, and venues compose on top of it as the venue's own work requires. Today, `kavara-mirepoix-internal` is the single repo, and both venues read from it directly. Per-venue overlays — for example `UlyssesModel/mirepoix-kavara-builder` and `UlyssesModel/mirepoix-scotty-gpu` — are explicitly anticipated future-state and are not required by the architecture. They would emerge only when a venue accumulates enough venue-specific configuration, extensions, or operational artifacts (Docker image build helpers for `kavara-builder`; Kirk-confidential smoke fixtures or local-Ollama Modelfiles for `scotty-gpu`) that pulling them out of the shared base makes the base cleaner. Until that threshold is reached, **the single repo is the right shape** and adding overlay repos prematurely would create maintenance overhead with no compensating benefit.

The future-state pattern (when and if it lands) follows the same layering as ADR-007/009's distribution-tier model, just on the orthogonal *venue* axis:

- **Mirepoix-base** — the four `@mirepoix/*` packages, the ADRs, the deployment runbooks, the smoke acceptance schema. Currently lives inside `kavara-mirepoix-internal`; would eventually publish to public NPM and the public `kavara-mirepoix` repo per ADR-007.
- **Kavara-Mirepoix distribution** — Kavara-internal extensions, the audit baselines, internal runbooks. Currently lives inside `kavara-mirepoix-internal`.
- **Venue overlays (future)** — venue-specific configuration and extensions for `kavara-builder` and `scotty-gpu` respectively. Would live in their own repos once the venue-specific surface justifies separation.
- **Customer-X-Mirepoix (future, per ADR-007)** — per-customer remixes.

The venue axis is orthogonal to the distribution axis. An extension's distribution tag (`internal` / `customer-licensed` / `public` / `collaborator-shared`) governs *who can install it*; an extension's venue affinity (if any) governs *where it can run*. Most extensions will be venue-agnostic; only those that depend on venue-specific infrastructure (a deny-egress firewall guard, a Docker daemon, a GPU) carry a venue affinity.

## Consequences

The first consequence is operational: most of the Mirepoix development workflow shifts from operator-Mac-as-dev-environment to `kavara-builder`-as-dev-environment. The Mac becomes one of several workstations that SSH into kavara-builder; the always-on VM becomes the durable place where on-loop pipelines run, where git working copies live without Mac-sleep interruptions, and where the development context persists across operator sessions. This is closer to the "always-on dev box" pattern many serious engineering shops use, and it eliminates the IvorHQ-as-SPOF class of problem that motivated kavara-builder's creation in the first place.

The second consequence is that Mirepoix-secure's role becomes architecturally clearer. ADR-010 framed it as "the deployment posture"; ADR-012 reframes it as "the exception posture invoked when the workload's confidentiality requires it." That framing makes Mirepoix-secure's discipline easier to maintain — it is only engaged when something specific is being protected, rather than being engaged by default and tempting operators to weaken it for ergonomics. The bastion stays narrow. The deny-egress rule stays engaged. IAP stays break-glass.

The third consequence is that the smoke-test acceptance gate (`specs/smoke-test-acceptance.md`) gains additional meaning. A new CLI build can be smoke-tested **first** on Mirepoix-build (faster iteration, hyperscaler models available for comparison) and then validated **again** on Mirepoix-secure to confirm the same behavior under the stricter posture. The acceptance schema is venue-agnostic; what differs is the model provider and the egress assumptions. Both runs producing the same JSONL trace is strong evidence the CLI is correctly factored.

The fourth consequence is a small documentation refactor. The Mirepoix-secure runbook at `docs/MIREPOIX-SECURE-RUNBOOK.md` was written with a "this is **the** runbook" framing; ADR-012 makes that "this is the runbook for the **secure** posture; the build-posture runbook lives in Confluence at PE/106233857." A small revision pass updates the first paragraph and adds a cross-link. No structural change to the runbook itself.

The fifth consequence is cost transparency. Mirepoix-build adds ~$60/month ongoing operational cost (per the Kavara Builder runbook's transparent cost table). This is a real budget line and worth tracking. The cost is justified by the elimination of IvorHQ-as-SPOF for image builds, the always-on Mirepoix dev environment, and the operational ergonomics of a Tailscale-reachable Linux VM that does not require a deny-egress dance for everyday work. If the cost becomes unjustifiable, the VM can be stopped (~$10/month) without losing state, since everything reproducible lives in GitHub.

The sixth consequence is that Mirepoix-build's posture is **easier to extend** than Mirepoix-secure's. New tooling, new dependencies, new external integrations land on Mirepoix-build first and prove themselves before any consideration of whether they belong on Mirepoix-secure. The locked-host posture should not be the first place where new ideas get tested.

## Alternatives considered

We considered keeping Mirepoix-secure as the sole posture and treating Mirepoix-build as out-of-scope for Mirepoix entirely. Rejected. Building Mirepoix's own harness on a locked deny-all-egress host is operationally absurd — it would mean opening egress windows for every npm install, every git clone, every model fetch, every reference-pack pull. The bootstrap pattern proved this morning that the harness develops faster with standard connectivity, and there is no architectural reason to handicap that work.

We considered making `kavara-builder` itself the locked-host posture, eliminating scotty-gpu's role. Rejected for two reasons: kavara-builder is CPU-only and cannot serve the local Qwen2.5-Coder model that ADR-010's confidential-workload posture requires; and the existing scotty-gpu infrastructure (GPU, Ollama, model cache, the bastion pattern, the deny-egress firewall, all the polyglot tooling) represents real operational investment that already works.

We considered defining a third venue — for instance, a "Mirepoix-restricted" middle posture with some egress restrictions but no bastion. Rejected as premature optimization. The two-posture model covers every workload we currently have or plan to have within Phase Two. Additional postures can be added by future ADR when an actual workload demands them.

We considered building Kirk-real images on Mirepoix-secure on the grounds that it has the strongest isolation among Mirepoix venues. Rejected — the existing IP-protection boundary is that Kirk-real builds happen on TDX-attested appliance hosts only. Mirepoix-secure's deny-egress posture protects against runtime exfiltration; the appliance host posture protects against build-time IP exposure to AI agents. Different protections, different hosts. ADR-012 codifies this rather than weakens it.

We considered routing Mirepoix-build's GitHub access through the mirepoix-bastion for consistency with Mirepoix-secure's ProxyJump pattern. Rejected. Mirepoix-build has no deny-egress to protect; routing its GitHub access through the bastion adds latency and a failure point with no architectural benefit. The bastion's role is specifically to mediate the Mirepoix-secure locked host's external traffic; extending it to Mirepoix-build dilutes that purpose.

## Implementation notes

### Network roles in the two-venue model

Three networks operate in concert; each has a single distinct role:

- **Tailscale** — operator-to-host only. The Mac (or any tailnet-connected operator workstation) reaches `kavara-builder` and `mirepoix-bastion` directly over the tailnet. Tailscale is the operator's tunnel into the project's VMs. It is **not** used for host-to-host coordination, host-to-GitHub, or host-to-hyperscaler traffic.
- **GCP VPC (the project's internal subnet, `10.128.0.0/9`)** — host-to-host within the project. `kavara-builder ↔ scotty-gpu`, `kavara-builder ↔ mirepoix-bastion`, `mirepoix-bastion ↔ scotty-gpu` all run over this secure software-defined network. SCP for file transfer, SSH for terminal sessions, HTTP for service communication (e.g., reaching scotty-gpu's Ollama on internal IP `10.128.0.16:11434`), all flow through the VPC. This is the only inter-host path Mirepoix uses; the network is GCP-controlled and never traverses the public internet.
- **Public internet** — host-to-external-service. `kavara-builder` reaches GitHub, hyperscaler APIs, npm registries, public Quay, etc. over standard egress through its assigned external IP. `scotty-gpu` reaches GitHub via SSH ProxyJump through `mirepoix-bastion` per ADR-010 (its only external path; everything else is denied at the egress firewall).

Operationally that means:

- The operator's `ssh kavara-builder` from the Mac → **Tailscale**
- The operator's `ssh scotty-gpu` from the Mac → **Tailscale** to bastion → **GCP VPC** to scotty-gpu (the bastion is the trust hop)
- `kavara-builder` running `curl http://10.128.0.16:11434/api/tags` → **GCP VPC** to scotty-gpu
- `kavara-builder` running `scp file scotty-gpu:~/` (using the host's internal IP or a host alias mapped to it) → **GCP VPC**
- `kavara-builder` running `git push origin main` → **public internet** (kavara-builder has standard egress; no bastion mediation needed because there's no deny-egress posture to work around)
- `scotty-gpu` running `git push origin main` → **GCP VPC** to mirepoix-bastion → **public internet** to GitHub (ProxyJump per ADR-010)

The bastion's only role is to be the trust hop for Mirepoix-secure's external traffic. It does not mediate Mirepoix-build's traffic, and it does not mediate inter-host coordination between Mirepoix-build and Mirepoix-secure.

### Provisioning Mirepoix on kavara-builder

`kavara-builder` already exists per the Kavara Builder runbook. To add Mirepoix to it:

```sh
# From the Mac, SSH to kavara-builder via Tailscale (operator-to-host path)
ssh kavara-builder

# On kavara-builder
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

GitHub auth from kavara-builder uses standard SSH-to-`git@github.com` over the host's external IP (public-internet egress). No ProxyJump, no bastion. The operator's SSH key on kavara-builder must be registered with GitHub (either as a personal authentication key on the operator's account, or as a deploy key on the repository if org policy allows).

### Model provider on Mirepoix-build

`kavara-builder` is fully open — standard egress, Tailscale-mediated, can reach any destination the operator's credentials authorize. It has no on-host GPU and serves no model itself. The CLI needs an external provider; three options are architecturally clean:

**Option 1 — Hyperscaler API (Claude or OpenAI).** Set the CLI's provider URL to `https://api.anthropic.com` (or OpenAI's equivalent) and provide a key. Simplest, fastest model, no infrastructure to maintain. The right choice for everyday Mirepoix development where the workload is non-confidential and the marginal cost of API tokens is acceptable. ADR-012's workload-allocation rule already authorizes hyperscaler API use on Mirepoix-build.

**Option 2 — scotty-gpu's Ollama over the internal subnet.** Set the CLI's provider URL to `http://10.128.0.16:11434/v1` (scotty-gpu's internal IP). Reachable from `kavara-builder` because both hosts sit on `10.128.0.0/9`, scotty-gpu's Ollama listens on `*:11434` per the pre-migration audit, and scotty-gpu's `default-allow-internal` ingress rule permits the connection. This routes Mirepoix-build's inference through the locally-served Qwen2.5-Coder on scotty-gpu **without compromising scotty-gpu's deny-egress posture** — scotty-gpu's deny rule is on *egress*, not on ingress, and its response packets to kavara-builder go out via the existing priority-800 `allow-internal-egress` allow rule. No Tailscale on scotty-gpu required (the bastion-mediated SSH path stays intact for operator access). **This is the architecturally cleanest cross-venue inference path** — it uses infrastructure that already exists, doesn't compromise any commitment from ADR-010, and gives Mirepoix-build access to the same model Mirepoix-secure uses, ensuring development-against-build matches the model behavior validated under deny-all-egress.

**Option 3 — Local Ollama on kavara-builder with a smaller CPU-capable model.** Install Ollama on kavara-builder and serve a CPU-suitable variant like Qwen2.5-Coder-7B. Slower per-token than scotty-gpu's A100-served 32B model, fully self-contained, no dependency on scotty-gpu being up. Useful for purely offline iteration but architecturally redundant with Option 2 once Option 2 is verified to work.

**Recommendation: Option 2 first, Option 1 as fallback, Option 3 only if Option 2 is unavailable for an operational reason.** Option 2 keeps the model context consistent across venues, which makes a CLI that works on Mirepoix-build provably likely to also work on Mirepoix-secure (where the same model is served, just over loopback).

The CLI's `--system-prompt-file` and `--cwd` flags work identically on either venue; only the provider URL (and possibly the model name) differ.

### Smoke-test acceptance across venues

The acceptance schema at `specs/smoke-test-acceptance.md` is venue-agnostic. The same JSONL shape, the same pass criteria, the same `scripts/smoke-accept.sh` apply. The two valid run patterns are:

- **Mirepoix-build smoke**: invoke the CLI on `kavara-builder` against the non-confidential fixture, using whichever model provider is configured. Validates correctness under the easier posture.
- **Mirepoix-secure smoke**: invoke the CLI on `scotty-gpu` against the same fixture, using the local Ollama. Validates correctness under continuous deny-all-egress with no external model dependency. This is the gate that authorizes sub-phase D.1 (spike retirement) per the existing acceptance contract.

A passing smoke on Mirepoix-build does **not** authorize spike retirement on its own; only a passing Mirepoix-secure smoke does. The two are not interchangeable in that direction. They are interchangeable in the development-iteration direction: a CLI that passes Mirepoix-build's smoke is ready to attempt Mirepoix-secure's smoke.

### Documentation updates triggered by ADR-012

- Root `README.md` — add a "Deployment venues" section covering both postures (already drafted in this session's staged docs pass)
- `CLAUDE.md` — add the venue-allocation rule and the Kirk-real exclusion boundary (already drafted in this session's staged docs pass)
- `docs/MIREPOIX-SECURE-RUNBOOK.md` — small revision: replace "this is the runbook" framing with "this is the runbook for the **secure** posture; the build-posture runbook lives in Confluence at PE/106233857."
- New file: `docs/MIREPOIX-BUILD-RUNBOOK.md` — **optional**. The Kavara Builder Confluence page is the canonical runbook; a thin pointer doc in the repo could cross-reference it. JE's call whether to add this or just link to Confluence from the README.

### Tag / network distinctions for reference

| | kavara-builder | mirepoix-bastion | scotty-gpu |
|---|---|---|---|
| Project | office-of-cto-491318 | office-of-cto-491318 | office-of-cto-491318 |
| Zone | us-central1-a | us-central1-a | us-central1-a |
| Network | default | default | default |
| Internal IP | (assigned at create time, in `10.128.0.0/9`) | 10.128.0.25 | 10.128.0.16 |
| External IP | assigned (default GCE behavior, for standard egress) | attached (for Tailscale coordination + GitHub via ProxyJump) | none |
| Network tag | `tag:builder` (Tailscale ACL) | `mirepoix-bastion` (GCP firewall) | `gemma-dev` (legacy; optional rename to `mirepoix-secure`) |
| Egress firewall | none (default-allow) | none (operator network — Tailscale + sshd only outbound usage) | `scotty-gpu-deny-egress` priority 1000 |
| Operator path (Mac → host) | Tailscale → `kavara-builder` direct | Tailscale → `mirepoix-bastion` direct | Tailscale → `mirepoix-bastion` → `scotty-gpu` (ProxyJump) |
| Inter-host path (within project) | GCP VPC (`10.128.0.0/9`) to either peer | GCP VPC to either peer | GCP VPC to either peer |
| Host-to-public-internet | Standard egress over external IP | Standard egress over external IP | Denied except for IAP responses; outbound git via bastion ProxyJump |

Inter-host coordination flows over the **GCP VPC** (the project-internal subnet, `10.128.0.0/9`). Tailscale never carries inter-host traffic; it is operator-to-host only. The relevant inter-host patterns this enables:

- **Cross-venue model serving** — kavara-builder reaches scotty-gpu's Ollama at `http://10.128.0.16:11434/v1` for inference during development on Mirepoix-build (per "Model provider on Mirepoix-build" above)
- **Code transfer** — `scp file scotty-gpu:~/` from kavara-builder when staging non-confidential reference material on the locked host without round-tripping through GitHub
- **Bidirectional SSH** — either host can SSH the other under OS Login if a workload genuinely needs it

The canonical source for Mirepoix code remains GitHub. Inter-host paths are operational seams for coordination, not source-of-truth replacements.
