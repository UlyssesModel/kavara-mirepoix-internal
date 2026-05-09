# Mirepoix Phase Zero spike

Single-file TypeScript harness that validates the Mirepoix-base architecture end-to-end against scotty-gpu's local Ollama serving Qwen2.5-Coder-32B-Instruct. ~150 lines. No dependencies beyond the runtime.

## What this proves

- Mirepoix can talk to a self-hosted model via the OpenAI-compatible API
- The four base tools from ADR-002 (bash, read, write, edit) work end-to-end
- The tool-calling loop terminates correctly when the model is done
- Session log per ADR-005 captures every event in append-only JSONL
- The whole loop runs under deny-all-egress (after re-locking) — no hyperscaler API touched

## What it doesn't include

The Phase Zero spike is deliberately not the production architecture. Per the implementation plan, Phase One splits this into the four packages (`@mirepoix/ai`, `@mirepoix/core`, `@mirepoix/coding`, `@mirepoix/cli`), Phase Two adds the extension API, and so on. This file is the validation that the basic shape works before any of that scaffolding lands.

## Deploy and run

Run on scotty-gpu via SSH (`gcloud compute ssh scotty-gpu --tunnel-through-iap --zone=us-central1-a --project=office-of-cto-491318`).

### One-time setup (egress must be open)

Apply pending OS updates and reboot:

```sh
sudo apt update
sudo apt upgrade -y
sudo reboot
```

After reboot, SSH back in and install Bun:

```sh
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

### Get the spike onto the VM

From the laptop:

```sh
gcloud compute scp --tunnel-through-iap --zone=us-central1-a --project=office-of-cto-491318 \
  ~/Documents/Claude/Projects/Project\ Pi/kavara-mirepoix-internal-seed/phase-zero-spike/mirepoix-spike.ts \
  scotty-gpu:~/mirepoix-spike.ts
```

### Run a smoke test

On scotty-gpu:

```sh
cd ~
bun mirepoix-spike.ts "create a file at /tmp/mirepoix-hello.txt with the words 'hello mirepoix' inside, then read it back to confirm"
```

Expected: the model issues `write` then `read` tool calls, the file is created, the read returns its contents, and the model responds with a short summary. The session log lands at `~/.local/share/mirepoix/sessions/<timestamp>.jsonl`.

### Validate the session log

```sh
ls -la ~/.local/share/mirepoix/sessions/
tail -1 ~/.local/share/mirepoix/sessions/*.jsonl | jq .
```

Every event is timestamped and typed: `session:start`, `provider:request`, `provider:response`, `tool:start`, `tool:end`, `session:end`. The full conversation is reconstructible from the log alone.

## Re-lock the firewall

Once the spike validates end-to-end, restore the deny-all-egress posture before any Kirk-secret-code work happens. From the GCP console (or via `gcloud` with appropriate scopes from the laptop), re-enable the firewall rule that blocks outbound traffic from scotty-gpu to anything other than the metadata server.

The Mirepoix spike keeps working under deny-all-egress because all model traffic goes to `127.0.0.1:11434` (loopback, never leaves the VM). The Tailscale tunnel remains the access path for the laptop to reach scotty-gpu, and Tailscale's UDP/41641 stays allowed.

## Verification under lockdown

After re-locking, re-run the smoke test on scotty-gpu. Same expected output. Then test from the laptop via Tailscale: install Bun on the Mac, set `OLLAMA_URL=http://100.120.101.79:11434/v1` (scotty-gpu's Tailscale IP, but Ollama only listens on the local interface so this won't work without an additional step — see "Remote access" below), run the spike against a simple task.

## Remote access (optional, after spike validates locally)

Ollama on scotty-gpu listens on `*:11434` per the audit. To make it reachable over Tailscale only (not over the GCE network), set the systemd override:

```sh
sudo systemctl edit ollama
```

Add:

```ini
[Service]
Environment="OLLAMA_HOST=100.120.101.79:11434"
```

Then `sudo systemctl restart ollama`. Now Ollama is reachable from the laptop at `http://100.120.101.79:11434` over the Tailscale tunnel, and not from the GCP-internal network.

## Next steps after Phase Zero validates

ADR-010 drafts against the verified state, naming Qwen2.5-Coder-32B-Instruct on scotty-gpu as the Phase a Mirepoix-secure deployment with Qwen3-Coder-480B-A35B-Instruct on multi-A100 capacity as the Phase b target. Phase One begins splitting the spike into the four `@mirepoix/*` packages.
