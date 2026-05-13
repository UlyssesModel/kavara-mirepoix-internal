#!/usr/bin/env bash
# install-mirepoix-build.sh
#
# Idempotent installer for Mirepoix on a Mirepoix-build host (kavara-builder
# or successors of the same shape). Run as the operator account.
#
# Prerequisites per the runbook:
#   - Host is provisioned per Confluence PE/106233857
#   - Tailscale is up; you reached the host via `ssh kavara-builder`
#   - Your SSH key is on GitHub (personal account or repo deploy key)
#
# This script:
#   1. Ensures ~/workspaces exists
#   2. Clones kavara-mirepoix-internal if not already present
#   3. Installs Bun if not already installed
#   4. Runs workspace install (bun install)
#   5. Verifies the four-package surface compiles (tsc --noEmit)
#
# Safe to re-run — every step is idempotent. Re-running after a `git pull` is
# the canonical way to bring an installed host up to the latest main.
#
# Per ADR-012, the canonical source is github.com:UlyssesModel/kavara-mirepoix-internal.
# Both Mirepoix-build and Mirepoix-secure read from this repository.

set -euo pipefail

readonly REPO_URL="git@github.com:UlyssesModel/kavara-mirepoix-internal.git"
readonly REPO_DIR_NAME="kavara-mirepoix-internal"
readonly WORKSPACES_DIR="$HOME/workspaces"
readonly REPO_DIR="$WORKSPACES_DIR/$REPO_DIR_NAME"

step() {
  echo ""
  echo "=== $1 ==="
}

#
# 1. Workspace directory
#

step "Step 1 — workspace directory"
mkdir -p "$WORKSPACES_DIR"
echo "ready: $WORKSPACES_DIR"

#
# 2. Clone or pull
#

step "Step 2 — clone or update repo"
if [ -d "$REPO_DIR/.git" ]; then
  echo "repo present; fetching latest main"
  cd "$REPO_DIR"
  git fetch origin
  # Only fast-forward if working tree is clean; otherwise leave the operator
  # to reconcile rather than clobbering local changes.
  if [ -z "$(git status --porcelain)" ]; then
    git checkout main
    git pull --ff-only origin main
    echo "fast-forwarded to $(git rev-parse --short HEAD)"
  else
    echo "working tree has uncommitted changes; leaving HEAD where it is"
    echo "  resolve manually, then re-run this script"
  fi
else
  echo "cloning $REPO_URL into $REPO_DIR"
  cd "$WORKSPACES_DIR"
  git clone "$REPO_URL" "$REPO_DIR_NAME"
  cd "$REPO_DIR"
fi

#
# 3. Bun runtime
#

step "Step 3 — Bun runtime"
if command -v bun >/dev/null 2>&1; then
  echo "bun already installed: $(bun --version)"
else
  echo "installing Bun (https://bun.sh/install)"
  curl -fsSL https://bun.sh/install | bash
fi

# Ensure bun is on PATH for this session even if shell init hasn't picked it up
export PATH="$HOME/.bun/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: bun not on PATH after install"
  echo "  manually source $HOME/.bashrc or open a new shell, then re-run"
  exit 1
fi
echo "bun version: $(bun --version)"

#
# 4. Workspace install
#

step "Step 4 — workspace install"
cd "$REPO_DIR"
bun install

#
# 5. Type-check
#

step "Step 5 — type-check (bunx tsc --noEmit)"
if bunx tsc --noEmit; then
  echo "type-check: clean"
else
  echo "type-check: errors above (not blocking install, but worth reviewing)"
fi

#
# Summary
#

step "Install complete"
echo "host:        $(hostname)"
echo "repo:        $REPO_DIR"
echo "branch:      $(git rev-parse --abbrev-ref HEAD)"
echo "head commit: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"
echo "bun:         $(bun --version)"
echo ""
echo "Next steps (per docs/MIREPOIX-BUILD-RUNBOOK.md):"
echo ""
echo "  1. Configure model provider:"
echo ""
echo "     # Option A — scotty-gpu's Ollama over the GCP VPC (recommended)"
echo "     export OLLAMA_URL=http://10.128.0.16:11434/v1"
echo "     export MIREPOIX_MODEL=qwen2.5-coder:32b-instruct"
echo ""
echo "     # Option B — hyperscaler API (Claude / OpenAI)"
echo "     export OLLAMA_URL=https://api.anthropic.com/v1"
echo "     export ANTHROPIC_API_KEY=<your-key>"
echo "     export MIREPOIX_MODEL=claude-sonnet-4-6"
echo ""
echo "  2. For translation work, invoke the spike (until sub-phase D wires @mirepoix/cli):"
echo ""
echo "     bun phase-zero-spike/mirepoix-spike.ts \\\\"
echo "       --system-prompt-file=PATH \\\\"
echo "       --cwd=PATH \\\\"
echo "       \"task description\""
echo ""
echo "  3. For Mirepoix self-development, run on-loop in a Claude Code session:"
echo ""
echo "     claude               # launches Claude Code in this directory"
echo "     /on-loop ./specs/<sub-phase>.md"
echo ""
