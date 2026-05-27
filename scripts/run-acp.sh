#!/bin/bash
# Wrapper script to execute the Mirepoix ACP server.
# Used by editors like Zed to start the Agent Client Protocol server.
#
# Routes inference to local Qwen3-Coder via Ollama on this host. Qwen is
# the canonical coding model for Kavara work (designed for coding, runs
# inside the customer perimeter for Modernize / Sovereign deployments).
#
# This static wiring is the interim solution. The model router on the
# roadmap will replace it with task-aware routing across local + hosted
# providers, optimizing for context window, token spend, and sovereignty
# constraints per request.

# Provider config — local Ollama, no external egress.
export OLLAMA_URL="http://127.0.0.1:11434/v1"
export MIREPOIX_MODEL="qwen3-coder:30b"

# Methodology overlay — loads the mise-en-place behavioral contract as
# the session's system prompt. Composed from SKILL.md + references/contract.md
# in /home/jekavara/workspaces/mise-en-place/skills/mise-en-place/ into a
# single file the @mirepoix/acp server reads via MIREPOIX_SYSTEM_PROMPT_FILE.
#
# If the composed file doesn't exist yet, regenerate with:
#   mkdir -p ~/.mirepoix
#   cat /home/jekavara/workspaces/mise-en-place/skills/mise-en-place/SKILL.md \
#       /home/jekavara/workspaces/mise-en-place/skills/mise-en-place/references/contract.md \
#     > ~/.mirepoix/mise-en-place.composed.md
export MIREPOIX_SYSTEM_PROMPT_FILE="$HOME/.mirepoix/mise-en-place.composed.md"

# JSONL session audit log location — matches @mirepoix/cli default.
export MIREPOIX_SESSION_DIR="$HOME/.local/share/mirepoix/sessions"

# Bun toolchain on PATH for non-interactive SSH (Zed launches via ssh -T).
export PATH="$HOME/.bun/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Execute the bun script directly to preserve process lifecycle signals.
exec "$HOME/.bun/bin/bun" "$SCRIPT_DIR/../packages/acp/src/index.ts"
