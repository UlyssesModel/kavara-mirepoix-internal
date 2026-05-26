# Git Synchronization Hooks

This directory contains the Git hooks used to manage symmetric synchronization between:
1. Local developer workspaces on `kavara-builder`
2. The bare bridge repository (`~/bridge/kavara-mirepoix-internal.git`)
3. The locked-down confidential computing VM `scotty-gpu`
4. The GitHub remotes (`origin`/`mirepoix`)

## Pre-push Hook (`pre-push`)
This hook runs locally in the developer's workspace whenever they push to a GitHub remote (`origin` or `mirepoix`). It automatically triggers an internal push of the `main` branch to the bare bridge repository.

### Installation
Symlink or copy this file into your local `.git/hooks/` directory:
```bash
ln -sf ../../scripts/git-hooks/pre-push .git/hooks/pre-push
```

## Post-receive Hook (`post-receive`)
This hook runs inside the bare bridge repository. When a push is received, it checks if the push originated from the `scotty-gpu` VM (IP `10.128.0.16`). If so, it propagates the updates out to GitHub and fast-forwards the local workspace on the builder VM.

### Installation
Symlink or copy this file into the bridge bare repository's `hooks/` directory:
```bash
ln -sf /home/jekavara/workspaces/kavara-mirepoix-internal/scripts/git-hooks/post-receive /home/jekavara/bridge/kavara-mirepoix-internal.git/hooks/post-receive
```
