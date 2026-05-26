#!/bin/bash
# Remote Runner: executes the Mirepoix ACP server on the GCE builder VM.
#
# Alt invocation (if pnpm script isn't used):
#   node packages/acp/dist/bin/mirepoix-acp.js --transport stdio
#
# Standard Exit Codes:
#   69 (EX_UNAVAILABLE) - Ollama is offline or unreachable.

export MIREPOIX_PROVIDER="ollama"
export MIREPOIX_MODEL="qwen3-coder:30b"
export OLLAMA_URL="http://127.0.0.1:11434/v1"
export OLLAMA_BASE_URL="http://127.0.0.1:11434/v1"
export PATH="$HOME/.bun/bin:$PATH"

# Fail fast with EX_UNAVAILABLE (69) if the local Ollama instance is down
if ! curl -sf http://127.0.0.1:11434/ >/dev/null 2>&1; then
  echo "Mirepoix-ACP: Error: Ollama is offline or unreachable at http://127.0.0.1:11434" >&2
  exit 69
fi

# Ensure logging directory exists
mkdir -p "$HOME/.mirepoix/acp-logs"
log_file="$HOME/.mirepoix/acp-logs/acp.log"

# Navigate to the workspace root
cd /home/jekavara/workspaces/kavara-mirepoix-internal || exit 1

# Execute pnpm so the process replaces this script (preserving PID)
# Stderr is teed to a rolling log
exec pnpm --filter @mirepoix/acp run start:stdio 2> >(tee -a "$log_file" >&2)
