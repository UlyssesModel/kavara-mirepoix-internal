# Mirepoix-secure deployment runbook

This runbook captures the procedure for provisioning a Mirepoix-secure deployment from scratch. It is the operational counterpart to ADR-010 — the ADR commits to the architectural shape, this runbook executes it. The first execution of this procedure happened on 2026-05-09 standing up scotty-gpu (locked host) plus mirepoix-bastion (trust hop) in `office-of-cto-491318`; that deployment is the working baseline against which any future deployment should match.

A Mirepoix-secure deployment consists of two GCE VMs on the same internal subnet: the **locked host** that runs the model and the harness, and the **bastion** that terminates the operator's Tailscale tunnel and ProxyJumps SSH/SCP traffic to the locked host's internal IP. The locked host has zero third-party software and zero egress except to the platform-internal allowlist. The bastion has a deliberately narrow install (Tailscale + sshd only) and is the documented hardenable trust hop.

Read ADR-010 for the architectural reasoning. This document only describes how to do it.

## Prerequisites

The operator running this procedure needs:

- gcloud SDK installed and authenticated (`gcloud auth login`) as a user with `roles/compute.admin` or equivalent in the target project, plus `roles/iap.tunnelResourceAccessor` for break-glass IAP-SSH.
- A Tailscale account on the same tailnet the operator's workstation is on. SSO via the operator's Google identity is the default.
- An SSH key pair at `~/.ssh/google_compute_engine[.pub]` — gcloud auto-generates this on first use of `gcloud compute ssh`. If you have never run `gcloud compute ssh`, run it once against any VM to bootstrap.
- The target GCP project's `default` network has Cloud NAT configured (or the bastion will be given an external IP — see Phase 3).

The locked host's model artifacts (weights, tokenizers) must be pulled during a provisioning phase when egress is open, before the firewall deny rule lands. Plan for ~20 GB of disk per Qwen2.5-Coder-32B-Instruct and ~280 GB per Qwen3-Coder-480B-A35B-Instruct. Boot disk sizing follows.

## Phase 1: Provision the locked host

The locked host needs a GPU appropriate to the model. For Qwen2.5-Coder-32B-Instruct, a single A100 40GB is sufficient (this is what scotty-gpu has). For Qwen3-Coder-480B-A35B-Instruct, multi-A100 capacity is required and procurement is a separate concern.

Create the VM with egress *open* — the firewall lockdown lands in Phase 2 after the model is pulled. Substitute the instance name, machine type, and accelerator config to match your target.

```sh
gcloud compute instances create LOCKED_HOST_NAME \
  --project=PROJECT_ID \
  --zone=us-central1-a \
  --machine-type=a2-highgpu-1g \
  --accelerator=type=nvidia-tesla-a100,count=1 \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=200GB \
  --boot-disk-type=pd-ssd \
  --network=default \
  --subnet=default \
  --tags=mirepoix-secure \
  --maintenance-policy=TERMINATE \
  --metadata=enable-oslogin=TRUE
```

The `mirepoix-secure` tag is the firewall scoping label introduced by ADR-010. If repurposing an existing VM (as we did with scotty-gpu's legacy `gemma-dev` tag), either rename the tag or use the existing one as the deny rule's target — the rule works either way.

SSH in and install Ollama and the model:

```sh
gcloud compute ssh LOCKED_HOST_NAME --tunnel-through-iap --zone=us-central1-a --project=PROJECT_ID

# on the locked host:
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable ollama
sudo systemctl start ollama
ollama pull qwen2.5-coder:32b-instruct
ollama list  # verify the model appears
```

Pull any additional models you want available for cross-model evaluation. Once they are pulled, the locked host has everything it needs and we can lock it.

## Phase 2: Engage lockdown on the locked host

The lockdown is a single GCE firewall rule that denies egress at the IP layer. Run from the operator's workstation:

```sh
# Confirm singleton — the deny rule will target everything tagged the same way
gcloud compute instances list \
  --project=PROJECT_ID \
  --filter="tags.items=mirepoix-secure" \
  --format="table(name,zone,status)"

# Create the deny-egress rule
gcloud compute firewall-rules create LOCKED_HOST_NAME-deny-egress \
  --project=PROJECT_ID \
  --network=default \
  --direction=EGRESS \
  --priority=1000 \
  --target-tags=mirepoix-secure \
  --action=DENY \
  --rules=all \
  --destination-ranges=0.0.0.0/0
```

The deny at priority 1000 sits below the priority-800 default `allow-internal-egress`, `allow-internal-NAME` (if present), and `allow-metadata-egress` rules, so the internal subnet and metadata server stay reachable while everything else is blocked.

Verify the lockdown is engaged. SSH back into the locked host via IAP (gcloud IAP-SSH is independent of the egress firewall):

```sh
gcloud compute ssh LOCKED_HOST_NAME --tunnel-through-iap --zone=us-central1-a --project=PROJECT_ID

# on the locked host:
echo "=== public egress (should fail / 000) ==="
curl -sS --max-time 5 -o /dev/null -w "google.com: %{http_code}\n" https://www.google.com 2>&1
curl -sS --max-time 5 -o /dev/null -w "anthropic: %{http_code}\n" https://api.anthropic.com 2>&1
curl -sS --max-time 5 -o /dev/null -w "huggingface: %{http_code}\n" https://huggingface.co 2>&1

echo "=== loopback (should list models) ==="
curl -sS http://127.0.0.1:11434/api/tags | jq -r '.models[].name'

echo "=== metadata (should print hostname) ==="
curl -sS -H "Metadata-Flavor: Google" http://169.254.169.254/computeMetadata/v1/instance/name; echo
```

Public probes returning `000` (timeout) is the validation gate for Phase 2. Loopback returning the model list and metadata returning the hostname confirms the allow rules still work. Do not proceed to Phase 3 until all three pass.

## Phase 3: Provision the bastion

From the operator's workstation:

```sh
gcloud compute instances create BASTION_NAME \
  --project=PROJECT_ID \
  --zone=us-central1-a \
  --machine-type=e2-small \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --network=default \
  --subnet=default \
  --no-address \
  --tags=mirepoix-bastion \
  --shielded-secure-boot \
  --shielded-vtpm \
  --shielded-integrity-monitoring \
  --metadata=enable-oslogin=TRUE
```

`--no-address` skips external IP allocation under the assumption Cloud NAT is configured on the `default` network for outbound. Several other VMs in `office-of-cto-491318` run successfully without external IPs, suggesting Cloud NAT is in place there. If Tailscale's coordination server is unreachable in the next step, attach an ephemeral external IP:

```sh
gcloud compute instances add-access-config BASTION_NAME \
  --project=PROJECT_ID \
  --zone=us-central1-a \
  --access-config-name="External NAT"
```

This was needed during the 2026-05-09 deployment — Cloud NAT in `office-of-cto-491318` covers Google services but not Tailscale's destinations. The external IP path is the simplest workaround and is hardened in Phase 5.

SSH in via IAP, sanity-check egress, install Tailscale, and authenticate:

```sh
gcloud compute ssh BASTION_NAME --tunnel-through-iap --zone=us-central1-a --project=PROJECT_ID

# on the bastion:
curl -sS --max-time 5 -o /dev/null -w "tailscale: %{http_code}\n" https://tailscale.com
curl -fsSL https://tailscale.com/install.sh | sudo sh
sudo tailscale up
```

`sudo tailscale up` blocks with a `https://login.tailscale.com/a/...` URL — copy it from the bastion's terminal, paste into the operator's browser, approve the bastion on the tailnet. Terminal unblocks with `Success.` Then:

```sh
tailscale ip -4
```

Capture the bastion's tailnet IP (will start with `100.`). This is what the operator's SSH config uses.

## Phase 4: Wire operator access

On the operator's workstation, append the SSH config block. Substitute `BASTION_TAILNET_IP` with the IP from the previous step and `LOCKED_HOST_INTERNAL_IP` with the locked host's internal IP (from `gcloud compute instances describe LOCKED_HOST_NAME`). Use the heredoc form so the contents are written to the file, not interpreted by the shell:

```sh
cat >> ~/.ssh/config <<'EOF'

Host BASTION_NAME
  HostName BASTION_TAILNET_IP
  User OS_LOGIN_USERNAME
  IdentityFile ~/.ssh/google_compute_engine
  IdentitiesOnly yes

Host LOCKED_HOST_NAME
  HostName LOCKED_HOST_INTERNAL_IP
  User OS_LOGIN_USERNAME
  IdentityFile ~/.ssh/google_compute_engine
  IdentitiesOnly yes
  ProxyJump BASTION_NAME
EOF
chmod 600 ~/.ssh/config
```

The OS Login username is derived from the operator's email — for `john.edge@kavara.ai` it is `john_edge_kavara_ai`. Confirm it from a previous gcloud SSH session's prompt if uncertain.

Test the chain:

```sh
ssh BASTION_NAME 'echo "tailscale path: $(hostname)"'
ssh LOCKED_HOST_NAME 'echo "proxyjump path: $(hostname)"'
```

Both should print successfully. The locked-host prompt should resolve to the locked host's hostname, confirming ProxyJump worked through the bastion.

Test SCP through the chain:

```sh
echo "runbook test $(date)" > /tmp/runbook-test.txt
scp /tmp/runbook-test.txt LOCKED_HOST_NAME:/tmp/
ssh LOCKED_HOST_NAME 'cat /tmp/runbook-test.txt && rm /tmp/runbook-test.txt'
rm /tmp/runbook-test.txt
```

This is the validation gate for Phase 4. If SSH and SCP both round-trip cleanly, the operator path is operational.

## Phase 5: Harden the bastion

If Phase 3 attached an external IP to the bastion (most likely), public TCP/22 is exposed by default via the network's `default-allow-ssh` rule. Close it while leaving IAP-SSH available as break-glass. Run from the operator's workstation:

```sh
gcloud compute firewall-rules create BASTION_NAME-allow-iap-ssh \
  --project=PROJECT_ID \
  --network=default \
  --direction=INGRESS \
  --priority=900 \
  --target-tags=mirepoix-bastion \
  --action=ALLOW \
  --rules=tcp:22 \
  --source-ranges=35.235.240.0/20

gcloud compute firewall-rules create BASTION_NAME-deny-public-ssh \
  --project=PROJECT_ID \
  --network=default \
  --direction=INGRESS \
  --priority=1000 \
  --target-tags=mirepoix-bastion \
  --action=DENY \
  --rules=tcp:22 \
  --source-ranges=0.0.0.0/0
```

`35.235.240.0/20` is Google's IAP source range. The allow rule at priority 900 wins for IAP traffic; the deny rule at priority 1000 catches everything else from the public internet.

Tailscale-mediated SSH is unaffected by these rules because WireGuard packets are decrypted in the kernel and the inner SSH traffic appears on the `tailscale0` virtual interface, which GCP firewall rules do not see.

Verify all three operator paths still work:

```sh
ssh BASTION_NAME 'echo "tailscale path: $(hostname)"'
ssh LOCKED_HOST_NAME 'echo "proxyjump path: $(hostname)"'
gcloud compute ssh BASTION_NAME --tunnel-through-iap --zone=us-central1-a --project=PROJECT_ID --command='echo "iap break-glass: $(hostname)"'
```

All three should print successfully. This is the validation gate for Phase 5.

## Phase 6: End-to-end smoke test

Push the Phase Zero spike (or whatever harness binary is the deployment payload) to the locked host and run a smoke task. Replace `mirepoix-spike.ts` with the harness build artifact for non-spike deployments.

```sh
scp ~/Documents/Claude/Projects/Project\ Pi/kavara-mirepoix-internal-seed/phase-zero-spike/mirepoix-spike.ts LOCKED_HOST_NAME:~/
ssh LOCKED_HOST_NAME 'rm -f /tmp/mirepoix-hello.txt && bun ~/mirepoix-spike.ts "create a file at /tmp/mirepoix-hello.txt with the words hello mirepoix locked inside, then read it back to confirm" && ls -la /tmp/mirepoix-hello.txt && cat /tmp/mirepoix-hello.txt'
```

Expected output: the spike rehydrates two tool calls from the model's response, executes write then read, and prints the file contents. The session log lands at `~/.local/share/mirepoix/sessions/`. If the smoke test passes under lockdown, the deployment is operational.

## Phase 7: Provisioning cleanup

Remove any third-party software left over from Phase 1 that is no longer needed. The most common case is Tailscale on the locked host — if Tailscale was installed before the lockdown engaged (for operator convenience during model pull), remove it now. Per ADR-010, the locked host has no third-party software, period.

```sh
ssh LOCKED_HOST_NAME 'sudo tailscale logout && sudo systemctl stop tailscaled && sudo systemctl disable tailscaled && sudo apt remove -y tailscale && which tailscale || echo "tailscale removed"'
```

Then go to the Tailscale admin UI and remove the locked host's stale tailnet entry.

Shred any provisioning-time artifacts that contain credentials, tokens, or other sensitive material:

```sh
ssh LOCKED_HOST_NAME 'shred -u /tmp/*.token 2>/dev/null; history -c'
```

## Operating procedures

**Pushing code to the locked host.** Use `scp` to the locked host's SSH alias:

```sh
scp local-file LOCKED_HOST_NAME:~/path/
```

Or `rsync` for directories:

```sh
rsync -av --delete src/ LOCKED_HOST_NAME:~/dst/
```

Both go through the bastion via ProxyJump automatically.

**Reading session logs.** Pull a session log to the operator's workstation for analysis:

```sh
scp LOCKED_HOST_NAME:~/.local/share/mirepoix/sessions/SESSION_ID.jsonl .
jq -c '{ts, event}' SESSION_ID.jsonl
```

**Updating model weights.** This requires temporarily opening egress on the locked host. Disable the deny rule (do not delete it — disable preserves the rule for re-enable), pull the new model, re-enable the deny rule, and verify the lockdown is back:

```sh
gcloud compute firewall-rules update LOCKED_HOST_NAME-deny-egress \
  --project=PROJECT_ID --disabled

ssh LOCKED_HOST_NAME 'ollama pull NEW_MODEL_TAG && ollama list'

gcloud compute firewall-rules update LOCKED_HOST_NAME-deny-egress \
  --project=PROJECT_ID --no-disabled

ssh LOCKED_HOST_NAME 'curl -sS --max-time 5 -o /dev/null -w "%{http_code}\n" https://www.google.com'
# expect: 000
```

The "open egress, pull, re-lock, verify" cycle should be fast (minutes) and rare (model updates only). Document each cycle in the session log directory or an audit log alongside it.

## Break-glass procedures

**Bastion is unreachable** (Tailscale tunnel down, bastion VM stopped, etc.):

```sh
gcloud compute ssh LOCKED_HOST_NAME --tunnel-through-iap --zone=us-central1-a --project=PROJECT_ID
```

IAP-SSH routes through Google's substrate-internal infrastructure independently of the bastion and the locked host's egress firewall. Use this to investigate or restart the bastion.

**Bastion's Tailscale auth has expired:**

```sh
gcloud compute ssh BASTION_NAME --tunnel-through-iap --zone=us-central1-a --project=PROJECT_ID
sudo tailscale up  # re-auth via browser as in Phase 3
```

**Locked host is unresponsive over SSH but VM is running:**

GCP serial console via the cloud console UI (Compute Engine → VM instances → click the VM → "Serial port 1 (console)" → "View"). Requires no firewall path; uses the substrate's out-of-band channel.

## Decommissioning

To spin down a Mirepoix-secure deployment:

```sh
# Remove the bastion's stale tailnet entry (Tailscale admin UI: Devices → BASTION_NAME → Remove device)

# Delete bastion firewall rules
gcloud compute firewall-rules delete BASTION_NAME-allow-iap-ssh BASTION_NAME-deny-public-ssh \
  --project=PROJECT_ID --quiet

# Delete the bastion VM
gcloud compute instances delete BASTION_NAME \
  --project=PROJECT_ID --zone=us-central1-a --quiet

# Delete the locked-host deny-egress rule (so the host can be repurposed)
gcloud compute firewall-rules delete LOCKED_HOST_NAME-deny-egress \
  --project=PROJECT_ID --quiet

# Delete or repurpose the locked host
gcloud compute instances delete LOCKED_HOST_NAME \
  --project=PROJECT_ID --zone=us-central1-a --quiet

# Remove SSH config entries from the operator's workstation
# (manual edit of ~/.ssh/config to remove the BASTION_NAME and LOCKED_HOST_NAME blocks)
```

Pull any session logs of audit value before deleting the locked host.

## Troubleshooting notes

These are the issues encountered during the 2026-05-09 deployment, captured here so they do not have to be re-debugged.

**`ubuntu-2404-lts` image family not found.** Ubuntu 24.04 LTS images are now architecture-suffixed in `ubuntu-os-cloud`. Use `ubuntu-2404-lts-amd64` for x86_64 and `ubuntu-2404-lts-arm64` for ARM. If unsure what is available, run `gcloud compute images list --project=ubuntu-os-cloud --filter="family~ubuntu-(22|24)" --format="value(family)" | sort -u`.

**`tailscale.com` connection times out from the bastion when `--no-address` was used.** Cloud NAT in `office-of-cto-491318` covers Google services but not all destinations. Workaround: attach an external IP via `gcloud compute instances add-access-config`. This was Phase 3's actual outcome; Phase 5 hardens the resulting public TCP/22 surface.

**Reauthentication required prompt during gcloud commands.** Run `gcloud auth login` to refresh via browser. Note that this resets the default project (`gcloud config set project PROJECT_ID` to restore).

**Operator copy-pastes example output into the shell.** Example URLs and config-file contents from documentation (or chat with an agent) sometimes get pasted into a terminal where the shell tries to execute them. The fix is operator vigilance; the document tries to mitigate by using full code blocks for shell commands and inline literals for example output.

**Ctrl-C mid-`curl ... | sudo sh`.** Kills the install before it finishes, leaving the binary missing. Re-run the install in full and let it complete (10-20 seconds for Tailscale).

**`who am i` returns empty in non-interactive SSH.** Expected — there is no controlling tty for `who` to query. Not a problem.

**Tailscale entry for the locked host shows "Connected" in the admin UI after the lockdown engages.** Stale state. The daemon cannot phone home to the coordination server under deny-all-egress. Remove Tailscale from the locked host (`sudo apt remove -y tailscale` etc.) and remove the device entry from the Tailscale admin UI to clean it up.
