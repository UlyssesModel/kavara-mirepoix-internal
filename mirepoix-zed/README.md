# Zed Integration: Remote Mirepoix ACP Server Setup

This directory contains the scripts and configuration needed to drive the remote **Mirepoix ACP (Agent Client Protocol) Server** on `kavara-builder` from the **Zed Editor** running locally on your Mac.

---

## 1. Architecture & Topology

Zed acts as the **ACP Client**, communicating over a secure SSH stdio redirect tunnel to the **ACP Server** running on `kavara-builder`. The ACP server interacts directly with the local **Ollama** service hosting the Qwen3-Coder model.

```
+------------------+                   +------------------+                   +------------------+
|    Local Mac     |                   |  kavara-builder  |                   |  kavara-builder  |
|                  |                   |  (GCE Remote)    |                   |  (Local Port)    |
|   Zed Editor     | -- SSH (Stdio) -> |  run-acp.sh      | -> Stdio / IPC -> |  Ollama Service  |
|  (ACP Client)    |                   |  (ACP Server)    |                   | (qwen3-coder:30b)|
+------------------+                   +------------------+                   +------------------+
```

---

## 2. Installation & Pre-requisites

### Step 1: SSH Configuration (Mac)
Ensure that you have `kavara-builder` configured in your local `~/.ssh/config` file so you can connect via command-line without interactive password prompts:
```ssh
Host kavara-builder
  HostName 10.128.0.37
  User jekavara
  IdentityFile ~/.ssh/google_compute_engine
```

### Step 2: Make Scripts Executable
Ensure the bridge scripts are marked executable:
* **On Mac**:
  ```bash
  chmod +x /Users/jekavara/code/kavara/kavara-mirepoix-internal/mirepoix-zed/mac/mirepoix-acp-zed.sh
  ```
* **On kavara-builder**:
  ```bash
  chmod +x /home/jekavara/workspaces/kavara-mirepoix-internal/mirepoix-zed/kavara-builder/run-acp.sh
  ```

### Step 3: Register in Zed settings.json
Add the `agent_servers` block from `mac/zed-settings-fragment.jsonc` directly into your global settings (press `Cmd + ,` in Zed to open it):
```json
  "agent_servers": {
    "Mirepoix": {
      "command": "/Users/jekavara/code/kavara/kavara-mirepoix-internal/mirepoix-zed/mac/mirepoix-acp-zed.sh"
    }
  }
```

---

## 3. Three-Step Sanity Test

1. **Save Configuration**: Save your `settings.json` file in Zed.
2. **Open Agent Panel**: Press `Ctrl + ?` (or click the sparkle icon ✨ in the bottom-right corner) to open the Assistant Panel.
3. **Check Connection Status**: Click the settings gear icon in the top-right corner of the Assistant Panel. You should see **Mirepoix** listed with a **green indicator dot**, meaning the SSH stdio bridge is active and transmitting JSON-RPC frames.

---

## 4. Failure-Mode Table

| Exit Code / Symptom | Probable Cause | Action / Verification |
| :--- | :--- | :--- |
| **Exit Code 69 (EX_UNAVAILABLE)** | Ollama service is not running on the remote builder host. | Log in to `kavara-builder` and run `systemctl status ollama` or check `curl http://127.0.0.1:11434`. |
| **SSH Permission Denied** | SSH keys are missing or not added to the ssh-agent on your Mac. | Verify connection by running `ssh -T kavara-builder` from a standard Mac terminal. |
| **Zed: Invalid Settings** | JSON syntax formatting error in your `settings.json` file. | Check for missing commas, trailing commas, or misplaced curly braces `{}`. |
| **No response in Agent Panel** | `bun` command not found in the remote environment. | Check the logs inside `~/.mirepoix/acp-logs/acp.log` on the builder host. |

---

## 5. Architectural Rationale: Why Not `context_servers`?

* **ACP (Agent Client Protocol)**: The `@mirepoix/acp` server implements the AAIF specification, which handles a full multi-turn conversational agent loop (including streaming message chunks, tool invocation approvals, and face-off reviews). Zed integrates custom ACP agents using the `"agent_servers"` block.
* **MCP (Model Context Protocol)**: Exposes tools and resources to Zed's *internal* models (like Claude or GPT). If you register the script under `"context_servers"`, Zed expects it to act as an MCP tool-server rather than an agent, resulting in communication handshake failures due to protocol mismatches.
