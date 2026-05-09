# Mirepoix infrastructure audit

Internal working document. Date: 2026-05-08, refreshed with VM-side audit 2026-05-09.

Purpose: inventory what GPU and confidential-compute substrate is already deployed at Kavara, what's reusable for Mirepoix's Qwen3-Coder fleet (per ADR-008), what's load-bearing for existing work, and what's greenfield. ADR-010 cites this audit when committing to procurement and operating plans.

Live numbers (cloud credit balances, monthly burn rate, per-substrate utilization) are placeholders to be filled in by the CTO from console data.

## Pre-migration audit on scotty-gpu (verified 2026-05-09)

Direct VM-side inspection via the audit script run during a maintenance window with egress temporarily relaxed. Raw artifact: [`SCOTTY-GPU-PREMIGRATION-AUDIT.md`](SCOTTY-GPU-PREMIGRATION-AUDIT.md).

**Documented-vs-actual lockdown layer status.** The Kirk Infrastructure Security explainer (Notion, 2026-04-15) describes a six-layer lockdown for the gemma-dev-gpu / scotty-gpu host. VM-side inspection on 2026-05-09 shows three of those layers are not currently active.

| Layer | Documented (explainer) | Actual (VM-side audit) |
|---|---|---|
| 1. Hardware memory encryption (Intel TDX) | enabled | **not active** — CPU is `Intel Family 6 Model 85` (Cascade Lake / Skylake-X), TDX requires Sapphire Rapids; `dmesg` shows no TDX/SEV/TEE markers |
| 2. GPU memory encryption (NVIDIA CC) | enabled | **OFF** — `nvidia-smi conf-compute -f` returns `CC status: OFF` |
| 3. Disk encryption (CMEK) | enabled with `kirk-keyring/kirk-disk-key` | unknown — VM service account has insufficient scope to query `gcloud kms`; needs out-of-band check from CTO laptop |
| 4. Deny-all-egress firewall | enabled | **temporarily relaxed** for the maintenance/model-pull window; needs re-locking before Mirepoix-secure goes live |
| 5. Air-gapped AI (local Ollama) | enabled | active — Ollama running as systemd service on port 11434 |
| 6. IAM lockdown | only JE has Owner | service account on the VM is `578895797177-compute@developer.gserviceaccount.com` with narrow scopes (cannot describe instances, list disks, list KMS keys); IAM at the project level not verifiable from inside |

**Implication.** scotty-gpu's lockdown as currently deployed is firewall-and-IAM-based, not hardware-attested-confidential. The TDX / NVIDIA CC story applies to what gemma-dev-gpu was *designed* to be per the explainer; the current scotty-gpu reality is a strong-but-software-only lockdown. ADR-010 should reflect this honestly rather than carry the documented-but-not-actual six-layer story forward.

**Hardware verified.**
- CPU: Intel Xeon @ 2.20 GHz, Family 6 Model 85, 12 vCPUs (6 cores × 2 threads), 38.5 MiB L3
- Memory: 83 GiB total, 81 GiB available
- GPU: 1 × NVIDIA A100-SXM4-40GB (UUID `GPU-5428af19-1e82-a38c-ee42-cdd3ad745b7e`), driver 580.126.09, CUDA 13.0, CC mode OFF
- Disk: 200 GB SSD root partition, 95 GB used / 99 GB free (49% full); single boot disk, no separate `kirk-model-disk` mounted
- OS: Ubuntu 24.04.4 LTS Noble, kernel `6.17.0-1012-gcp`
- Pending: 39 system updates plus a kernel restart

**Currently running AI stack.**
- Ollama systemd service active 5+ days, listening on `*:11434` (all interfaces)
- Models loaded: `qwen2.5-coder:32b-instruct` (19 GB, 3 days ago) — **already pre-positioned for Mirepoix-secure**; `gemma4:31b` (19 GB), `gemma4:26b` (17 GB), `gemma3:12b` (8.1 GB) — Wonderwall serving stack
- Total model storage: ~63 GB
- No vLLM, TGI, or alternate serving runtime present
- Claude Code installed (`.claude/` directory with cache, sessions, telemetry; one project workspace under `.claude/projects/-home-john-edge-kavara-ai-wonderwall`)

**Network and access.**
- Primary interface: `ens5` at `10.128.0.16/32` (GCP internal)
- Tailscale interface up: `tailscale0` at `100.120.101.79/32`, listening UDP/41641 + TCP/41753
- Listening ports: SSH (22), Ollama (11434), systemd-resolved (53), Tailscale (41641, 41753, 48522)
- Firewall: only Tailscale-related iptables / nft rules visible from inside; the deny-all-egress firewall is at the GCP project level, not visible to the VM
- DNS search domains include `office-of-cto-491318.internal`, `ibis-allosaurus.ts.net` (Tailnet), `kavara.ai`

**Egress probe results during audit window (deny-all-egress *was* relaxed):**
- google.com → 200
- api.anthropic.com → 404 (reached, no auth)
- api.openai.com → 421 (reached, no auth)
- huggingface.co → 200

All four reached, confirming the GCP-level deny-all-egress was off during the audit. Needs re-enabling before Mirepoix-secure goes live.

**Code present on scotty-gpu (directory inspection only — no source content read).**
- `~/scotty/` — `UlyssesModel/scotty.git` (private), v6.2 ("anti-hallucination prompt + temperature 0.2"), v0.2.0 initial release
- `~/wonderwall/` — `UlyssesModel/wonderwall.git`, latest commit "v0.1 plumbing-validation results"
- `~/stac-venv/` — Python 3.12 virtualenv, role unclear (likely STAC-related)
- `~/` is itself a git repo with auto-commit history from Scotty agent operations
- `/opt` and `/mnt` empty

**Security findings to address before Mirepoix-secure goes live.**

1. **GitHub PAT exposed.** The `~/scotty/.git/config` has `https://ghp_REDACTED@github.com/UlyssesModel/scotty.git` as the remote — token embedded in URL. Token has been written to `/tmp/scotty-gpu-premigration-audit.md` on the VM (twice — the audit ran twice during the session) and to the asciinema cast on the laptop. Action: rotate the PAT, switch to `git credential helper`, shred the audit file copies that leaked it.

2. **deny-all-egress disabled.** Re-enable before Mirepoix-secure handles any Kirk-secret-code work.

3. **39 OS updates pending plus kernel restart.** Apply during the egress-open window.

4. **VM service account scopes are narrow.** `gcloud compute instances describe`, `gcloud compute disks list`, `gcloud kms keys list` all fail with `ACCESS_TOKEN_SCOPE_INSUFFICIENT`. This is actually a reasonable security posture (least-privilege) but it means CMEK status, snapshot inventory, and machine-type confirmation have to be done from the CTO laptop, not from inside the VM.

**Mirepoix-secure pilot path on scotty-gpu (changed from the original plan based on audit findings).** Because Qwen2.5-Coder-32B-Instruct is already pulled and Ollama is already serving, the pilot is materially simpler than originally described: install Mirepoix-base on the VM (or run it from the laptop pointed at scotty-gpu's Ollama via Tailscale), configure it to use the OpenAI-compatible endpoint at `http://127.0.0.1:11434/v1`, validate end-to-end on a Kirk-code task, then re-enable deny-all-egress. No machine-type upgrade is needed for the pilot — the existing 1× A100 40GB serves the 32B model comfortably. ADR-010 captures this as the Phase a deployment, with Qwen3-Coder-480B-A35B-Instruct as the target model when fleet capacity is provisioned later.

## GCP

### Confirmed running

**scotty-gpu** (us-central1-a, instance `4391311520127905515`)
- Machine type: `a2-highgpu-1g` (12 vCPUs, 85 GB memory)
- GPU: 1 × NVIDIA A100 40GB
- CPU platform: Intel Cascade Lake (no AMX, no TDX support)
- Confidential VM service: **disabled**
- vTPM: on. Integrity monitoring: on. Secure Boot: off.
- OS: Ubuntu 24.04 Noble
- Boot disk: 200 GB SSD persistent
- Network tag: `gemma-dev`
- Public IP: 136.115.162.133 (ephemeral)
- Created: 2026-04-15. Status: running.
- **Workload context: Wonderwall / Kirk-encoder-to-Gemma-4 LLaVA-pattern bridge.** This is the gemma-dev host. Not free capacity for Mirepoix.
- **On-demand cost reference:** ~$3.67/hour, $88/day, $2,640/month. ~$1,800 burned since 2026-04-15.
- **Capacity for Qwen3-Coder-480B-A35B-Instruct: insufficient.** Single A100 40GB cannot hold the model at any reasonable quantization plus KV cache.
- **Confidential-compute eligibility for federal Customer-X-Mirepoix: no** — non-Confidential VM, Cascade Lake CPU.

### Confirmed deployed (from Confluence)

**ulysses-demo cluster** (GCP SNO on `c3-standard-44`, Intel SPR)
- OCP 4.21.9 SNO, AMX-capable
- Kata-VM pod-level confidential boundary
- Phase 3A KServe InferenceService for Kirk (`ulysses-sor-inference`, V2 OpenInference, 3.09 ms RTT)
- **GPU status: TBD.** SOR work was AMX-CPU-based. Whether the cluster has GPU nodes attached is unclear from current data. Audit gap.
- Cost: covered by GCP credits per Confluence.

**ulysses-rt-bench** (GCP `c3-standard-8`, Intel SPR)
- Used for Phase 3B PREEMPT_RT bench (167μs p95 result)
- Torn down post-bench (per Confluence 2026-04-29)
- Re-provisionable in 20-30 min via `experiments/rhel-rt-latency/provision.sh`
- Not currently consuming budget.

### Other GCP instances visible (2026-05-08 paste)

All in `us-central1-a`. Machine types and GPU counts not yet captured — gap to fill.

| Name | Internal IP | External IP | Likely role | GPU? |
|---|---|---|---|---|
| `amd-sevsnp-benchmark` | 10.128.0.15 | — | AMD SEV-SNP benchmarking lane (per Confluence Substrate Matrix) | unknown |
| `gke-kirk-serving-confidential-c3-a909481f-0kcp` | 10.128.0.12 | 34.63.246.194 | **GKE confidential serving cluster for Kirk** — node in `kirk-serving-confidential` GKE cluster on c3 (Sapphire Rapids confidential VMs). Second candidate substrate for Mirepoix Qwen3-Coder serving on GCP. | unknown |
| `gke-kirk-serving-default-pool-7dfd3b03-zwlq` | 10.128.0.11 | 35.238.244.22 | Default-pool node in same GKE cluster | unknown |
| `kavara-visual-studio-ui` | 10.128.0.5 | 34.29.80.46 | Kavara-Visual-Studio UI host (drag-and-drop canvas for Kirk pipelines) | unlikely |
| `openshift-intel-tdx` | 10.128.0.19 | — | OpenShift Intel TDX instance (separate from ulysses-demo master) | unknown |
| `scotty-gpu` | 10.128.0.16 | 136.115.162.133 | Wonderwall / Gemma 4 host. **1 × NVIDIA A100 40GB** (audited above) | yes |
| `stac-claude-dev` | 10.128.0.24 | 136.119.126.47 | Claude/STAC dev environment | unlikely |
| `tdx-amx-node-octo` | 10.128.0.4 | 34.61.232.106 | Original AMX testbed (Intel SPR + TDX, GCE-internal per Confluence) | unlikely |
| `trader-dev` | 10.128.0.23 | — | Trader dev environment | unlikely |
| `ulysses-demo-2g6tw-master-0` | (truncated) | (truncated) | OpenShift `ulysses-demo` SNO cluster master node | unknown (likely no — SOR work was AMX-CPU) |

**New architectural finding:** GCP has *two* candidate confidential-serving substrates for Mirepoix Qwen3-Coder, not one:

(a) **OpenShift `ulysses-demo`** — Kata-VM pod-level confidential boundary, matches the Phase 3A Kirk KServe pattern verbatim, established workflow.

(b) **GKE `kirk-serving-confidential-c3`** — managed-Kubernetes cluster-level confidential VMs on Sapphire Rapids, simpler operationally, currently serving Kirk in a separate deployment.

ADR-010 picks one (or commits to running both in parallel for redundancy). The OpenShift one is the natural choice if pattern-consistency with Phase 3A matters most; the GKE one is the natural choice if managed-K8s simplicity matters most.

**Data still needed before ADR-010 lands:**

```sh
gcloud compute instances list --format='table(name,zone,machineType.basename(),guestAccelerators.acceleratorCount,guestAccelerators.acceleratorType.basename(),status)'
```

Plus the GKE cluster's node-pool composition:

```sh
gcloud container clusters describe kirk-serving-confidential --zone us-central1-a --format='value(nodePools[].config.machineType,nodePools[].config.accelerators)'
```

### GCP credits

To be filled in. Estimated balance: $______. Estimated burn (ex-Mirepoix): ~$2,640/month for scotty-gpu plus ulysses-demo cluster ongoing.

## Azure

### Confirmed deployed (from Confluence)

**ulysses-tdx-demo cluster** (Azure SNO on `Standard_DC16es_v6`, westus3)
- Intel SPR + TDX cluster-level confidential boundary (host-level TDX confirmed via dmesg)
- OCP 4.21.9 SNO with `securityType: ConfidentialVM` cleanly exposed in install-config
- runc on TDX host (Kata-cc-tdx structurally blocked by nested-virt restriction inside TDX guest)
- End-to-end pipeline live since 2026-04-27 (Polygon → Kafka → SOR → entropy → Grafana)
- **GPU status: none.** DC16es_v6 is CPU-only. GPU on Azure TDX requires a different SKU and the GPU-on-TDX combination has not been validated at Kavara yet.
- Cost: ~$38/day per Confluence (~$1,140/month).

### SKU sweep

Five DCesv6 SKUs evaluated (DC2 / DC8 / DC16 / DC32 / DC64) per Confluence — all CPU-only, no GPU.

### Other Azure instances

To be filled in. Run `az vm list --query "[].{name:name, vmSize:hardwareProfile.vmSize, status:powerState, location:location}"` and append.

```
[paste output here]
```

### Azure credits

To be filled in. Estimated balance: $______. Estimated burn (ex-Mirepoix): ~$1,140/month for ulysses-tdx-demo.

## AWS

### Confirmed planned (from tiberius-substrate-matrix)

**aws-cells / m6a.8xlarge** (AMD EPYC Milan + SEV-SNP)
- 32 vCPU, 128 GiB, AMD Milan (3rd-gen EPYC)
- Status: **parked 2026-04-22** — SEV-SNP is region-gated and quota increases route to human review
- Account: 417673081359 (Kavara), us-east-1
- On-demand: ~$1.38/hour ($33/day, $993/month). Spot was $0.55 at probe time.
- m7a (Genoa) does NOT support SEV-SNP per AWS — must use m6a (Milan)
- **GPU status: none.** This is CPU-only.
- Unblock path: peer-pods sub-project or bare-metal Granite Rapids — tracked separately.

### Other AWS instances

To be filled in. Run `aws ec2 describe-instances --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name,Placement.AvailabilityZone]' --output table` and append.

```
[paste output here]
```

### AWS credits

To be filled in. Estimated balance: $______. Estimated burn (ex-Mirepoix): aws-cells parked, ~$0/month current.

## Bare metal

### NY5 kirk-td

- Intel Granite Rapids + TDX
- Tailscale-only access, JE-manual operation
- `hardware_id=gnr-tdx`, `amx-stride2-32` venue (expected, not yet measured)
- Confidential boundary: TDX host
- **GPU status: none.** AMX-CPU-based per the Granite Rapids design intent.
- Operating cost: bare metal, no per-hour billing.

### Databank DL360 Gen11

- Intel Granite Rapids + TDX
- Building per v1 install plan
- Flagship showroom appliance
- Same posture as NY5: AMX-CPU, no GPU yet.

## Workload-versus-capacity gap analysis

Mirepoix's ADR-008 commits to a Qwen3-Coder-480B-A35B-Instruct serving fleet across three substrates. Capacity requirements per endpoint:

- **At INT4 quantization:** ~240 GB VRAM for weights plus KV cache budget. 6-8 × A100 40GB or 4 × H100 80GB.
- **At FP8 quantization:** ~480 GB VRAM. 12 × A100 40GB or 6 × H100 80GB.
- **At BF16:** ~960 GB VRAM. Not practical without H200 or H100 NVL clusters.
- **CPU-only on AMX (KTransformers fallback):** feasible at ~1-5 tokens/sec, too slow for interactive coding sessions, viable only as on-prem-appliance fallback when GPU is unavailable inside the Trust Domain.

**Current state vs target:**

| Substrate | Current GPU capacity | Target Mirepoix capacity | Gap |
|---|---|---|---|
| GCP (Kavara-internal) | 1 × A100 40GB (scotty-gpu, allocated to Wonderwall) | `a2-highgpu-8g` (8 × A100 40GB) or `a3-highgpu-8g` (8 × H100 80GB) on Confidential VM | Greenfield procurement |
| GCP (federal Customer-X-Mirepoix) | None on Confidential boundary | Confidential A100/H100 cluster with KServe + Kata-VM | Greenfield, depends on H100 CC GA |
| Azure (Customer-X-Mirepoix) | None | NCv5/NDv5 series with TDX + GPU when available | Greenfield, validation pending |
| AWS (federal Customer-X-Mirepoix) | None (m6a.8xlarge parked, CPU-only anyway) | EC2 instance with AMD SEV-SNP + GPU | Greenfield, blocked on AWS quota path |
| Bare metal (NY5, Databank) | None | Optional GPU add-on for on-prem Customer-X-Mirepoix appliances | Hardware procurement decision |

## Cost-runway projection (placeholder structure)

To be filled in once credit balances are confirmed. Structure:

- **Total cloud credits across GCP + Azure + AWS:** $_______
- **Current monthly burn (ex-Mirepoix):** $_______
  - scotty-gpu: ~$2,640/month
  - ulysses-tdx-demo: ~$1,140/month
  - ulysses-demo cluster: $______ (TBD)
- **Mirepoix-fleet additional monthly burn at first-substrate launch (GCP only):**
  - At a2-highgpu-8g (A100×8) on Confidential VM: ~$22,000/month
  - At a3-highgpu-8g (H100×8) on Confidential VM: ~$65,000/month
- **Mirepoix-fleet monthly burn at all-three-substrates steady state:**
  - Estimated $50K-150K/month depending on instance class and utilization
- **Credit runway at full Mirepoix fleet:** ~$_______ ÷ ~$_______/month = ~__ months

## Recommendations for ADR-010

Based on the audit picture so far:

**Phase a (Mirepoix-internal serving on GCP only):** Launch one Qwen3-Coder endpoint on `a2-highgpu-8g` Confidential VM in `ulysses-demo` adjacency. INT4 quantization to fit on 8 × A100 40GB. Use credits. Validate KServe + Kata-VM + GPU + confidential boundary end-to-end. ~$22K/month burn during this phase.

**Phase b (federal Customer-X-Mirepoix on AWS):** When the first federal POC engagement is real, unblock the AWS SEV-SNP quota path (or use peer-pods alternative). Procure GPU+SEV-SNP capacity. Bundle Qwen3-Coder weights into the appliance. Phase a remains Mirepoix-internal-only until this lands.

**Phase c (Azure as third substrate):** When customer mix justifies. Validate GPU+TDX combination on Azure. Lower priority than the AWS path.

**Phase d (on-prem appliance with GPU):** When Databank or NY5 customers contractually require it. Procure GPU hardware for the bare-metal sites.

**Trigger for Phase b:** First signed federal POC contract.
**Trigger for Phase c:** Customer mix demand or Azure-specific deal.
**Trigger for Phase d:** Customer contract requiring bundled-into-appliance GPU.

## Next concrete steps

1. CTO populates the placeholder fields (instance lists, credit balances, monthly burn).
2. ADR-010 is drafted citing the populated audit.
3. Phase a procurement is initiated (one Confidential GPU instance on GCP for Qwen3-Coder serving).
4. The first eval run of `mirepoix sweep` against the populated endpoint validates routing recommendations before any default hardens in Kavara-Mirepoix bundles.
