#!/bin/bash
# Local Mac Wrapper Script: Pipes Zed's stdio JSON-RPC streams to the remote
# kavara-builder ACP server over SSH.
#
# Configured to use the local Qwen3-Coder model running on the GCE host.

# Use -T to disable pseudo-terminal allocation and preserve raw JSON-RPC streams
exec ssh -T kavara-builder \
  "OLLAMA_URL=http://127.0.0.1:11434/v1 \
   MIREPOIX_MODEL=qwen3-coder:30b \
   /home/jekavara/.bun/bin/bun /home/jekavara/workspaces/kavara-mirepoix-internal/packages/acp/src/index.ts"
