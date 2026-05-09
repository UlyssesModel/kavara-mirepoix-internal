# ADR-010: Mirepoix-secure deployment posture and scotty-gpu pilot

Status: Accepted
Date: 2026-05-09
Deciders: John Edge (CTO)
Supersedes: extends ADR-008 (model routing) and ADR-009 (deployment-mode field)

## Context

Phase Zero of Mirepoix has now validated end-to-end on scotty-gpu — the single-file TypeScript spike at `kavara-mirepoix-internal-seed/phase-zero-spike/mirepoix-spike.ts` executes the full ADR-001/002/005 loop against local Ollama serving Qwen2.5-Coder-32B-Instruct, both under open egress and under a deny-all-egress firewall, with no measurable latency difference and no implicit hyperscaler dependency. The session log captures every event in append-only JSONL per ADR-005. This is the empirical basis ADR-010 is drafted against.

Kavara needs a coding-agent harness it can apply to Kirk-confidential code without ever sending tokens to a hyperscaler API. That requirement has driven much of the platform design — ADR-002's no-permission-dialog posture assumes the harness operator already trusts the runtime; ADR-005's full-context-visibility commitment assumes the operator can audit what the agent saw; ADR-008's multi-substrate routing commits to a self-hosted Qwen3-Coder fleet — but no ADR has yet committed to a specific deployment shape that operationalizes those commitments. ADR-008 named the substrate options (GCP, Azure, AWS-AMD-SEV-SNP, on-prem TDX appliance) without picking a first pilot. ADR-009 added the `deployment` manifest field with values like `on-prem-appliance` and `hosted-saas` but left the Mirepoix-secure-on-GCP case unaddressed.

ADR-010 closes that gap. It defines **Mirepoix-secure** as a deployment posture distinct from the distribution-tier vocabulary in ADR-007/009, commits to scotty-gpu as the validated Phase-a pilot, and names multi-A100 Qwen3-Coder-480B-A35B-Instruct as the Phase-b expansion target. It also resolves several honesty issues that surfaced during the pre-migration audit, the most important of which is that the original lockdown narrative around scotty-gpu was aspirational — the audit captured the deny-all-egress firewall layer as documented intent that had never actually been engaged. The deny rule was created for the first time on 2026-05-09 as part of Phase Zero validation, not restored.

## Decision

ADR-010 makes four architectural commitments.

The first commitment is the Mirepoix-secure posture itself. **Mirepoix-secure** is a deployment configuration of Mirepoix-base (and any layer above it) in which the harness runs on a *locked host* with deny-all-egress at the IP layer except for explicitly enumerated destinations, paired with a *side-by-side bastion host* that concentrates third-party operator-tunnel infrastructure where it can be hardened in isolation. The locked host's enumerated destinations cover only its own loopback interface (where the model serves), the platform's metadata server (for instance-identity attestation), and the internal subnet shared with the bastion. All other egress from the locked host is denied. Model artifacts — weights, tokenizers, system prompts, evaluation packs — are pulled during a separate provisioning phase when egress is open, then the host is sealed. Once sealed, the harness has no path to exfiltrate tokens to any hyperscaler API, and no path to pull new code or model weights from any non-substrate-internal source. This posture is what makes Mirepoix safe to apply to Kirk-confidential code.

The bastion is a peer host on the same internal subnet, with no deny posture of its own and a minimal install footprint (operator-tunnel daemon plus sshd; no IDEs, compilers, container runtimes, or model-serving). Its role is exactly the third-party-trust-hop role: it terminates the operator's tunnel from outside the substrate (Tailscale on GCP/Azure/AWS, Twingate or substrate-equivalent on on-prem), and it ProxyJumps SSH/SCP traffic from the operator's workstation to the locked host's internal IP. The locked host has no Tailscale daemon, no DERP-relay dependency, no continuous network relationship with any third-party service. If the operator-tunnel provider is compromised, the bastion is exposed and the locked host is not. The substrate-native fallback path (`gcloud compute ssh --tunnel-through-iap` on GCP, equivalents elsewhere) remains available as break-glass operator access in case the bastion is unreachable.

Mirepoix-secure is not a separate distribution tier. The distribution tags from ADR-007/009 (`internal`, `customer-licensed`, `public`, `collaborator-shared`) govern *who can install* an extension; Mirepoix-secure governs *what kind of host* the harness runs on. The two are independent and ADR-010 keeps them that way. A single bundle can target a Mirepoix-secure host without changes to its distribution tag, and a single Mirepoix-secure host can run bundles drawn from any combination of distribution tiers.

The second commitment is the scotty-gpu pilot as Phase a. The instance `scotty-gpu` in GCP project `office-of-cto-491318`, zone `us-central1-a`, on the `default` network, tagged `gemma-dev` (legacy, optional rename to `mirepoix-secure` for vocabulary alignment), serves Qwen2.5-Coder-32B-Instruct via Ollama on `127.0.0.1:11434`. The firewall rule `scotty-gpu-deny-egress` at priority 1000, target tag `gemma-dev`, action DENY, applies to all destinations — the rule sits below three priority-800 allow rules (`allow-internal-egress`, `allow-internal-scotty`, `allow-metadata-egress`) so the internal subnet and metadata server remain reachable while everything else times out at the IP layer. Operator access is via the side-by-side bastion `mirepoix-bastion` on the same `default` network: the operator's workstation reaches the bastion over Tailscale, and `~/.ssh/config` ProxyJump routes SSH and SCP from the workstation through the bastion to scotty-gpu's internal IP `10.128.0.16`. The existing priority-800 `allow-internal-scotty` rule covers TCP traffic from the internal subnet to scotty-gpu, which includes the bastion's internal IP. `gcloud compute ssh --tunnel-through-iap scotty-gpu` remains the break-glass path for the case where the bastion is unreachable, compromised, or under maintenance — IAP routes through Google's substrate-internal infrastructure independently of both the bastion and the VM's egress firewall.

The Phase-zero spike is what runs on scotty-gpu until Phase One delivers the four `@mirepoix/*` packages. The validation on 2026-05-09 demonstrated that the loop terminates correctly under lockdown, that the JSONL session log is complete and reconstructible, and that wall-clock latency does not degrade between open-egress and deny-all-egress configurations. Phase a is therefore not "to be validated" — it is the working pilot, and the bar for any subsequent Mirepoix-secure deployment is to match this baseline.

The third commitment is Phase b — Qwen3-Coder-480B-A35B-Instruct on multi-A100 GCP capacity, using the same Mirepoix-secure posture. The 480B-A35B model is the larger, more capable Qwen3-Coder variant from ADR-008's fleet specification. Single A100 40GB capacity on scotty-gpu is insufficient to host it; Phase b is gated on procuring multi-A100 capacity (either a multi-GPU instance or a small cluster) in `office-of-cto-491318` or a successor project. The architectural posture is unchanged from Phase a: Ollama on loopback (or vLLM on loopback if Ollama becomes a bottleneck), deny-all-egress firewall, IAP-only operator access, JSONL session logs as the source-of-truth audit trail. Procurement is a separate operational concern that does not require an ADR.

The fourth commitment is honesty about what scotty-gpu's lockdown does and does not provide. The pre-migration audit captured that the host CPU is Cascade Lake — which does not support Intel TDX — and that NVIDIA Confidential Computing on the attached A100 was OFF. Mirepoix-secure as deployed on scotty-gpu is therefore *firewall-and-IAM lockdown*, not *confidential-compute lockdown*. The architectural claim is meaningful: model traffic never leaves the VM, operator access is mediated by a Google-controlled path, the audit trail is complete. The architectural claim it does *not* make is that the GCP control plane cannot read VM memory — that is the claim TDX and NVIDIA CC make, and that requires Sapphire-Rapids-or-newer CPUs and a CC-enabled GPU posture. The on-prem TDX appliance from ADR-008 is the architectural answer to that stronger claim; Phase a does not pretend to offer it. ADR-010 commits to documenting this distinction in every Mirepoix-secure deployment manifest's `attestation` field, with values `firewall-and-iam` (Phase a baseline), `tdx-engaged` (when running on Sapphire Rapids+ with TDX confirmed), `nvidia-cc-engaged` (when running on a GPU with CC ON), and `multi-engaged` (when both are confirmed).

## Consequences

The first consequence is that Kavara now has a validated home for applying Mirepoix to Kirk-confidential code. The Phase-a host can be cloned (or its bundle re-deployed to a project closer to where the Kirk-confidential workloads live) using the same posture, the same firewall pattern, and the same access path. The architectural claim is portable.

The second consequence is that the deployment-mode vocabulary from ADR-009 needs one more value. ADR-009 defined `on-prem-appliance`, `hosted-saas`, `customer-cloud`, and `collaborator-environment`. Mirepoix-secure-on-GCP — and by extension Mirepoix-secure-on-Azure and Mirepoix-secure-on-AWS — does not fit cleanly into any of those four. ADR-010 introduces a fifth value, `secure-locked-vm`, to describe the firewall-and-IAM-locked single-host configuration. The bundler accepts this as a peer to the existing four. Future bundles that target scotty-gpu or its successors should declare `deployment: secure-locked-vm` plus the appropriate `attestation` field.

The third consequence is that the Phase-zero spike is now load-bearing in a way it was not designed to be. The spike was a single-file harness intended to validate the architecture end-to-end and then be discarded as Phase One ships the four `@mirepoix/*` packages. ADR-010 commits to running it as the Phase-a Mirepoix-secure runtime until Phase One ships, which means the spike's normalization quirks — most notably the `tryParseToolCallsFromContent` rehydration that handles Qwen2.5-Coder's emit-tools-as-content quirk — must persist across the package split. The normalization belongs in `@mirepoix/ai` once it exists, not in the spike, and Phase One should produce a provider abstraction that hides the difference between Qwen-via-Ollama tool emission and OpenAI-shaped tool_calls.

The fourth consequence is that the operator's network trust surface is reorganized rather than reduced. The locked host has zero third-party network surface — no Tailscale daemon, no DERP-relay dependency, no coordination-server traffic — but operator convenience is preserved by concentrating that trust on the side-by-side bastion. The bastion is a documented, hardenable trust hop with a deliberately narrow install footprint: Tailscale (or substrate-equivalent operator-tunnel daemon), sshd, the minimal toolchain needed for SSH key custody and routine maintenance, and nothing else. SSH-key custody on the bastion becomes its own operational concern, treated with the same rigor as any production credential. If Tailscale Inc. (or the substrate-equivalent provider) is compromised, the bastion is exposed; the locked host is not. This separation is the architectural payoff of the bastion pattern and the reason ADR-010 chose it over either Tailscale-on-secure-host or substrate-fallback-only operator access. Pre-existing scripts that assumed direct Tailscale connectivity to scotty-gpu need updating to ProxyJump via the bastion; this is a one-time migration captured in the Mirepoix-secure runbook.

The fifth consequence is that Phase b is gated on hardware procurement, not on architectural work. Once multi-A100 capacity is available (either by upgrading scotty-gpu, by provisioning a peer instance, or by standing up a small cluster), the Phase-b deployment shape is mechanical: clone the firewall pattern, install Ollama or vLLM with Qwen3-Coder-480B-A35B-Instruct, repeat the Phase-zero validation, declare the posture. ADR-010 does not commit Kavara to a procurement timeline; ADR-008's substrate-aware routing tells the harness how to use Phase a and Phase b once both exist.

The sixth consequence is that the pre-migration audit document at `kavara-mirepoix-internal-seed/docs/SCOTTY-GPU-PREMIGRATION-AUDIT.md` becomes the canonical baseline of what scotty-gpu was before Mirepoix-secure was engaged. Subsequent audits should diff against it. The document is not retracted or rewritten — its honesty about the documented-vs-actual lockdown gap is what makes it useful as a baseline.

The seventh consequence is that the `attestation` field opens a small amount of observability surface. Bundle manifests can now declare the attestation posture they were tested under, downstream tooling (telemetry, eval harnesses, customer-facing trust documentation) can read the field, and a hypothetical future ADR can promote the field from observational to enforced — refusing to deploy a `tdx-engaged`-required bundle to a `firewall-and-iam`-only host. ADR-010 keeps the field observational; enforcement is a forward-looking concern.

## Alternatives considered

We considered making Mirepoix-secure a separate distribution tier rather than a deployment posture. Rejected. The distribution tags answer "who can install this extension" and the deployment posture answers "what kind of host runs the harness". Conflating them creates a combinatorial explosion of tags (`internal-secure`, `customer-licensed-secure`, `public-secure`, `collaborator-shared-secure`) and forecloses combinations that should be allowed (a `public` extension running on a Mirepoix-secure host is fine, a `customer-licensed` extension running on a non-secure host is fine if the customer's terms permit it). The orthogonal axes are simpler.

We considered using on-prem TDX appliance as the first pilot. Rejected for now. The on-prem TDX appliance from ADR-008 is the architectural answer to the strongest confidential-compute claim, but it has a longer procurement and provisioning lead time, no validated software path yet, and would block Phase Zero validation behind hardware that does not yet exist. scotty-gpu is hardware Kavara already operates, with a software path that has been validated. The on-prem TDX appliance becomes Phase c in a future ADR, after Phase b has delivered the multi-A100 GCP fleet.

We considered Azure TDX or AWS AMD SEV-SNP as the first pilot. Rejected. Kavara's working VM with operator tooling, IAP access path, and an installed Ollama+Qwen stack is on GCP. Re-creating the same on Azure or AWS for the first pilot would burn weeks of operational work before any architectural validation. ADR-008's multi-substrate fleet stays the target shape; ADR-010 does not commit Kavara to pursuing all three substrates simultaneously.

We considered skipping the firewall layer and relying on IAM and the Ollama-listens-on-loopback pattern alone. Rejected. The deny-all-egress firewall is the cleanest empirical proof of the architectural claim — a curl to a public destination either succeeds (claim violated) or times out at the IP layer (claim upheld). IAM and loopback-binding are weaker because they rely on application-level discipline that is harder to audit. The firewall is the load-bearing layer.

We considered allowing Tailscale-required egress through the firewall on the locked host directly. Rejected. Tailscale's coordination server and DERP relays are run by Tailscale Inc., which is a third-party service Kavara does not control. Allowing egress to those endpoints under the Mirepoix-secure posture would weaken the architectural claim — model traffic stays loopback, but Tailscale-mediated traffic touches a third party, and the locked host carries a continuous network dependency on third-party infrastructure. The side-by-side bastion pattern is the architectural answer: Tailscale runs on a peer VM whose role is exactly the third-party-trust-hop role, the locked host has no Tailscale dependency at all, and operator UX is preserved via SSH ProxyJump. A future ADR may revisit Tailscale-allowed egress for less-strict deployment postures (e.g., Mirepoix-restricted as a peer to Mirepoix-secure), but the strict posture uses the bastion.

We considered substrate-fallback-only operator access (gcloud IAP-SSH on GCP, equivalents elsewhere) without a bastion. Rejected. IAP-only access works architecturally — the trust boundary is the substrate provider Kavara already accepts — but degrades operator UX in ways that compound over a working session: every connection goes through gcloud auth, file pushes via `gcloud compute scp` are noticeably slower than direct SCP, and habitual `ssh hostname` does not work. The bastion pattern recovers the ergonomics without weakening the architectural claim. IAP-SSH retains its role as break-glass fallback — the cost of standing up a bastion is bounded (one tiny VM, one trust-hop to harden), and the operational lift of working without one daily is unbounded.

We considered putting the Phase-a pilot in a project closer to where Kirk-confidential workloads live. Rejected for the pilot. The architectural claim is about the harness, not about the project boundary; validating the claim on the host Kavara already operates is the cheapest path to ground-truth. Production Kirk-confidential work moves to its own project and applies the same posture; the migration is a procurement-and-IAM concern, not an architectural one.

## Implementation notes

The Phase-a deployment is captured by the following manifest fragment, suitable for inclusion in any bundle targeting scotty-gpu:

```yaml
deployment: secure-locked-vm
substrate:
  cloud: gcp
  project: office-of-cto-491318
  zone: us-central1-a
  instance: scotty-gpu
  internal_ip: 10.128.0.16
  network: default
  egress_rule: scotty-gpu-deny-egress
  egress_priority: 1000
  attestation: firewall-and-iam
  bastion:
    instance: mirepoix-bastion
    role: tailscale-trust-hop
    machine_type: e2-small
    install: tailscale-and-sshd-only
model:
  served_by: ollama
  endpoint: http://127.0.0.1:11434/v1
  name: qwen2.5-coder:32b-instruct
  weights_pulled_at: 2026-05-06T00:00:00Z
operator_access:
  primary: tailscale-via-bastion
  fallback: gcloud-iap-ssh
  break_glass: gcp-console
session_log:
  path: ~/.local/share/mirepoix/sessions/
  format: jsonl
  schema: adr-005
```

The Phase-b deployment manifest will mirror this shape with `model.name: qwen3-coder:480b-a35b-instruct` and an updated `substrate.instance` once procurement lands. The `attestation` field stays `firewall-and-iam` until and unless the host CPU is Sapphire Rapids+ with TDX confirmed engaged or the GPU is in a CC-ON posture.

The optional tag rename from `gemma-dev` to `mirepoix-secure` is captured here so it does not get lost. Tags are immutable strings, so the rename is `gcloud compute instances add-tags scotty-gpu --tags=mirepoix-secure` followed by `gcloud compute instances remove-tags scotty-gpu --tags=gemma-dev` and an update to the firewall rule's `--target-tags` argument. The rename produces a single round of network-policy churn and is reversible if it produces unexpected effects. Either tag works for the architectural claim; the rename is purely vocabulary alignment with this ADR.

The pre-migration audit document at `kavara-mirepoix-internal-seed/docs/SCOTTY-GPU-PREMIGRATION-AUDIT.md` and the synthesized infrastructure audit at `kavara-mirepoix-internal-seed/docs/INFRASTRUCTURE-AUDIT.md` are the canonical baselines for this ADR. Both are referenced from the Mirepoix-secure deployment runbook (forthcoming) and should not be modified or rewritten without an explicit superseding note.

The Phase-zero spike's normalization quirks — specifically `tryParseToolCallsFromContent` and `extractJsonObjects` in `mirepoix-spike.ts` — must be preserved when the spike is split into `@mirepoix/ai` during Phase One. The provider abstraction that lands in `@mirepoix/ai` should expose a single normalized tool-call surface to the rest of the harness, with provider-specific shims (Qwen-via-Ollama, OpenAI-shaped, Anthropic-shaped) below the line. Phase One's first deliverable in this area should be a unit-test pack that exercises both wire formats against the same harness logic.

Subsequent ADRs may revisit specific elements of this commitment without re-litigating the whole posture. ADR-011 or beyond may promote the `attestation` field from observational to enforced; may add Mirepoix-restricted as a less-strict peer posture; may commit to a specific procurement timeline for Phase b; or may extend the posture to cover Azure TDX or AWS AMD SEV-SNP substrates. Those are forward-looking concerns. ADR-010 commits to the architectural shape and the validated Phase-a baseline.
