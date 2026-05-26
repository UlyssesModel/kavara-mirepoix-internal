#!/bin/bash
# Local Mac SSH Bridge: pipes Zed's stdio JSON-RPC streams to the remote GCE host.
#
# Diagnostics go to stderr; stdout is reserved strictly for ACP JSON-RPC frames.

# Setup ControlMaster socket directory for SSH multiplexing to reduce connection latency
mkdir -p ~/.ssh/sockets 2>/dev/null

exec ssh -T \
  -o BatchMode=yes \
  -o ServerAliveInterval=30 \
  -o ControlMaster=auto \
  -o ControlPath=~/.ssh/sockets/control-%r@%h:%p \
  -o ControlPersist=600 \
  kavara-builder \
  "/home/jekavara/workspaces/kavara-mirepoix-internal/mirepoix-zed/kavara-builder/run-acp.sh"
