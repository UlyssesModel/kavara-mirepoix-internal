# Sub-phase D: CLI wiring, system prompt extraction, NQ carry-forwards, CI hardening

## Status

Phase: One. Sub-phase: D. Bootstrap mode: Claude Code via on-loop on Mac, with
the smoke gate executed on `scotty-gpu` post-merge (per the addendum to
ADR-003 — D is the last Claude-assisted sub-phase before sub-phase E moves
execution to the locked host).

## Context

Phase One sub-phases A, B, B.1, and C have shipped. The four packages are now:

- `@mirepoix/ai` — provider call + rehydration (sub-phase B, PR #1)
- `@mirepoix/coding` — four base tools + executor (sub-phase B, PR #1)
- `@mirepoix/core` — typed event bus + Session + JSONL log + agent loop (sub-phase C, PR #3)
- `@mirepoix/cli` — placeholder (sub-phase A scaffold; never implemented)

The Phase Zero spike at `phase-zero-spike/mirepoix-spike.ts` is still the
working harness; it owns all the wiring (env reads, CLI argv parsing, the
inline `DEFAULT_SYSTEM_PROMPT`, the main loop calling everything inline).
Sub-phase D delivers the production CLI that supersedes the spike, but
**does not** retire it. Spike retirement is sub-phase D.1 — a separate
single-commit PR gated on the JSONL smoke acceptance running green on
scotty-gpu.

Sub-phase D is also where two open NQ-class carry-overs from C land
(NQ-7 `RunOptions.workingDir`, NQ-13 `Error`-aware JSONL replacer), where
the system-prompt-extraction commitment from ADR-005 finally happens
(prompt moves from the spike to `packages/coding/src/prompts/coding.md`),
and where two CI-hygiene follow-ups originally scheduled for sub-phase E
(SHA-pin GitHub Actions, `permissions: contents: read`) are pulled
forward because scotty-gpu becomes the dev execution target the moment
D merges — supply-chain hygiene matters now, not later.

## Goal

Wire the four packages into a runnable `@mirepoix/cli` that produces JSONL
session logs satisfying the smoke acceptance schema at
`specs/smoke-test-acceptance.md` (a deliverable of D itself). After D
merges:

1. `bun packages/cli/src/index.ts "translate prompt"` on a host with
   Bun + reachable Ollama produces a JSONL session log.
2. The CLI script + fixture + system-prompt-file already staged in the
   user's `translation-experiments/` folder scp to scotty-gpu.
3. The smoke runs on scotty-gpu; `scripts/smoke-accept.sh` verifies the
   JSONL trace against the schema.
4. A green smoke unblocks sub-phase D.1 (spike retirement).

## Concrete work

### Concern 1 → `packages/coding/src/prompts/coding.md`

Extract `DEFAULT_SYSTEM_PROMPT` from `phase-zero-spike/mirepoix-spike.ts`
(lines 48-59) to a new file `packages/coding/src/prompts/coding.md` as
plain markdown. Per ADR-005: *"The system prompt is open. It lives at
`packages/mirepoix-coding/src/prompts/coding.md` as plain markdown."*

`@mirepoix/coding` exposes a way for the CLI to read this prompt — either
as a re-exported string (`export const DEFAULT_SYSTEM_PROMPT = "..."`)
or by exporting the file path. Engineer chooses; document choice.

The spike is NOT modified — it still carries its inline copy. Sub-phase
D.1 deletes both the spike and that inline copy.

### Concern 2 → `@mirepoix/core` NQ-7 + NQ-13 carry-forwards

#### NQ-7: `RunOptions.workingDir` (`packages/core/src/loop.ts`)

Add `workingDir: string` to `RunOptions` as a **required** field (not
optional — the CLI always passes one; defaulting inside core would
re-introduce a `process.cwd()` call). Replace the existing
`process.cwd()` call in `loop.ts` (line ~61 per sub-phase C) with
`options.workingDir`. The `session:start` payload's `workingDir` field
now reflects the caller's intent, not the process's incidental state.

After this change, `grep 'process\.cwd()' packages/core/src/` must
produce zero matches. The FR-011 layering grep from sub-phase C's plan
tightens accordingly.

#### NQ-13: Error-aware JSONL replacer (`packages/core/src/log.ts`)

Install a `JSON.stringify` replacer that serializes `Error` instances
faithfully. Implementation (from the schema doc, lines 142-156):

```typescript
function errorAwareReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value as unknown as Record<string, unknown>),
    };
  }
  return value;
}
```

Apply to every `JSON.stringify(...)` call in `log.ts`. Targets:
`bus:error`, `provider:error`, `tool:error` payloads — anywhere an
`Error` reaches the logger. The top-of-file comment cited in sub-phase
C's `log.ts` (the NQ-13 known-gap marker) gets removed; the gap is
closed.

### Concern 3 → `@mirepoix/cli` implementation

The CLI is the entry point. It owns argv parsing, env reads, stdout
rendering, exit codes — all the boundary concerns that ADR-001 keeps
out of `core`. Per ADR-001 layering, `cli → coding → {core, ai}`.

#### `packages/cli/package.json`

Add dependency: `"@mirepoix/coding": "workspace:*"`. (Transitive deps
on `core` and `ai` resolve via `coding`'s own deps.)

Add `bin` field: `"bin": { "mirepoix": "./src/index.ts" }`. Bun runs
`.ts` directly; no build step.

#### `packages/cli/src/index.ts`

The entry point. Public surface (sorted):

- `PACKAGE_NAME` (preserve `as const`)
- `main(argv?: string[]): Promise<number>` — the CLI entry. Returns
  exit code. Takes optional `argv` for testability; defaults to
  `process.argv.slice(2)`.

`main()` does, in order:

1. **Parse argv**: `--system-prompt-file=PATH`, `--cwd=PATH`, then
   positional prompt. Mirror the spike's parsing exactly (lines 62-74).
   On no positional prompt: print usage to stderr and return exit 1.

2. **Env reads**:
   - `OLLAMA_URL` (default `http://127.0.0.1:11434/v1`)
   - `MIREPOIX_MODEL` (default `qwen2.5-coder:32b-instruct`)
   - `MIREPOIX_SESSION_DIR` (default `${homedir()}/.local/share/mirepoix/sessions`)

3. **Load system prompt**: if `--system-prompt-file=PATH`, read that
   file. Otherwise, load the default from `@mirepoix/coding`'s
   `prompts/coding.md` (Concern 1).

4. **Resolve working dir**: if `--cwd=PATH`, use the resolved absolute
   path. Otherwise, `process.cwd()`. The CLI **may** `process.chdir`
   here (it's the boundary; that's allowed in `cli` but not in
   `core`). Document the choice.

5. **Session ID + log path**: generate `sessionId` from
   `new Date().toISOString().replace(/[:.]/g, "-")` (matches spike).
   Compute `sessionLogPath = ${MIREPOIX_SESSION_DIR}/${sessionId}.jsonl`.
   `mkdirSync(MIREPOIX_SESSION_DIR, { recursive: true })`.

6. **Build the session**: `new Session({ id: sessionId, systemPrompt })`.

7. **Wire the logger**: `createSessionLogger(session.bus, sessionLogPath)`.
   Capture the disposer for cleanup-on-exit.

8. **Wire the stdout renderer**: subscribe to bus events for human
   output (see "Stdout renderer" below). Capture disposers.

9. **Assemble the run options**: `{ session, userPrompt, providerConfig:
   { url: OLLAMA_URL, model: MIREPOIX_MODEL }, tools, executeTool,
   workingDir }`. Import `tools` and `executeTool` from
   `@mirepoix/coding`.

10. **Print bootstrap line**: `[mirepoix] session <sessionId> model
    <MODEL>\n[user] <userPrompt>` (mirror spike line 293).

11. **Call `run(options)`**. On thrown error, print to stderr, dispose
    subscriptions, return exit 1.

12. **On success**: print `\n[mirepoix] session log: <sessionLogPath>`
    (matches spike line 381). Dispose subscriptions. Return exit 0.

#### Stdout renderer

The CLI subscribes to a subset of bus events and writes human-readable
lines to stdout. Matches the spike's rendering format so the live
experience is unchanged:

| Event | stdout format |
|---|---|
| `session:start` | (already printed at step 10; no subscription needed) |
| `tool:start` | `\n[tool:<name>] <JSON args, first 200 chars>` |
| `tool:end` | `[result] <resultPreview, first 400 chars>...` (truncate `…` if longer) |
| `tool:error` | `[error] <error.message>` |
| `message:assistant` | when `rehydrated`: `[mirepoix] rehydrated N tool call(s) from content`; when no tool calls and `content` is non-null: `\n[mirepoix] <content>` |
| `session:end` | (already printed at step 12; no subscription needed) |

The renderer uses `console.log` — `console.*` is forbidden in `core`
but allowed in `cli` (the boundary).

#### Process-level error handling

The CLI MAY `process.exit(N)`. The CLI MAY `process.chdir(path)` if
`--cwd` was supplied. Both are boundary concerns and are allowed only
in `@mirepoix/cli`.

### Concern 4 → CI workflow hardening (`.github/workflows/ci.yml`)

Two changes folded forward from sub-phase E. The rationale is captured
in this spec's Context: scotty-gpu becomes the dev execution target as
soon as D merges; the supply-chain posture should match.

#### 4a. SHA-pin GitHub Actions

Replace major-tag references with commit-SHA pins. Engineer looks up
the current SHA for the major tag at install time and pins to it. Add
an inline comment of the form `# v4 (released YYYY-MM-DD)` so renovate
(or a future humans) can see the version family.

Targets:
- `actions/checkout@v4` → `actions/checkout@<40-char-SHA>`
- `oven-sh/setup-bun@v2` → `oven-sh/setup-bun@<40-char-SHA>`

#### 4b. `permissions: contents: read`

Add a top-level `permissions:` block to the workflow:

```yaml
permissions:
  contents: read
```

This is strictly tighter than the GitHub default token scope. The
workflow does not need write permissions (no commit, no comment, no
release). Forks already get `contents: read` by default; making it
explicit prevents an accidental widening later.

#### 4c. Per-package `tsc` + surface smoke for `@mirepoix/cli`

Following the sub-phase B.1 + C pattern, add two steps after the
existing `coding` and `core` smokes:

```yaml
- name: Type-check @mirepoix/cli
  run: bun x tsc --noEmit -p packages/cli/tsconfig.json

- name: Smoke test — @mirepoix/cli surface
  run: |
    bun -e 'import * as cli from "./packages/cli/src/index.ts"; const keys = Object.keys(cli).sort(); const expected = ["PACKAGE_NAME","main"]; if (JSON.stringify(keys) !== JSON.stringify(expected)) { console.error("cli surface mismatch:", keys); process.exit(1); } console.log("cli surface OK");'
```

After D the CI has 14 steps (sub-phase C's 12 + 2 new for cli).

### Concern 5 → Smoke-test runbook + acceptance script

#### 5a. `specs/smoke-test-acceptance.md`

Copy the staged schema from
`~/Documents/Claude/Projects/Project Pi/translation-experiments/smoke-acceptance-schema.md`
into `specs/smoke-test-acceptance.md`. Resolve the three discrepancies
flagged in this spec's Open Questions (snake_case → camelCase; the
edit-is-already-in-the-package note; the ADR-002-vs-bash-guard
contradiction) before committing.

#### 5b. `scripts/smoke-accept.sh`

Extract the pass-criteria bash block (lines 73-120 of the schema) into
an executable file at `scripts/smoke-accept.sh`. Make it executable
(`chmod +x`). The script takes one argument (the path to a session log
JSONL file) and exits 0 on pass / 1 on fail with a `SMOKE FAIL: <why>`
message.

Update the jq paths to match camelCase keys (NQ-4 carry-through):
- `.payload.messages_count` → `.payload.messagesCount`
- `.payload.result_preview` → `.payload.resultPreview`
- `.payload.working_dir` → `.payload.workingDir`
- `.payload.system_prompt_file` → `.payload.systemPromptFile`
- `.payload.ollama_url` → `.payload.url`

#### 5c. Runbook for executing the smoke on scotty-gpu

A short prose runbook lives at the top of
`specs/smoke-test-acceptance.md` (or as a sibling file
`docs/smoke-runbook.md` — engineer chooses):

```
# Smoke runbook (post-D merge)

1. scp ~/Documents/Claude/Projects/Project\ Pi/translation-experiments/multihead_attention.py scotty-gpu:~/workspaces/source/
2. scp ~/Documents/Claude/Projects/Project\ Pi/translation-experiments/pytorch-to-rust-prompt.txt scotty-gpu:~/workspaces/prompts/
3. ssh scotty-gpu
4. cd ~/mirepoix && git pull
5. bun install
6. mkdir -p ~/workspaces/target
7. bun packages/cli/src/index.ts \
     --system-prompt-file=~/workspaces/prompts/pytorch-to-rust-prompt.txt \
     --cwd=~/workspaces/target \
     "translate ~/workspaces/source/multihead_attention.py to Rust using candle-core"
8. SESSION_LOG=$(ls -t ~/.local/share/mirepoix/sessions/*.jsonl | head -1)
9. bash scripts/smoke-accept.sh "$SESSION_LOG"
```

A pass on step 9 unblocks sub-phase D.1.

## Constraints

- **Spike frozen.** `phase-zero-spike/mirepoix-spike.ts` MUST NOT be
  modified. `git diff phase-zero-spike/` after D must be empty. The
  spike retirement is **sub-phase D.1, NOT this sub-phase**. D.1 ships
  in a separate single-commit PR.
- **No new ADRs.** ADR-001/002/004/005 are authoritative for everything
  D touches.
- **No new third-party deps.** The `cli` package adds only the workspace
  dep `@mirepoix/coding`. No commander/yargs/oclif — argv parsing is a
  ~10-line for-loop, same shape as the spike's.
- **Layering preserved.** `cli` MAY import from `coding`. `cli` MAY NOT
  import from `core` or `ai` directly (they're transitive via `coding`).
  Verify with grep.
- **Boundary concerns stay in `cli`.** `process.env`, `process.exit`,
  `process.chdir`, `console.*`, `process.argv` — all these live in
  `cli`. Grep on `packages/{core,ai,coding}/src/` for any of these
  must remain clean.
- **Containment**: D's `git status` must show changes only in the FR-010
  allowlist (see Success criteria).
- **No new test framework.** Smoke tests stay as `bun -e` for the CI
  surface check + the bash acceptance script for the post-merge smoke.

## Success criteria

After D, all of the following must hold:

1. `packages/coding/src/prompts/coding.md` exists with the default
   system prompt extracted from the spike (lines 48-59, byte-equivalent
   modulo formatting).

2. `packages/core/src/loop.ts` has `workingDir: string` as a required
   `RunOptions` field; `process.cwd()` is gone from `packages/core/src/`.

3. `packages/core/src/log.ts` installs an `Error`-aware JSON replacer;
   `tool:error` / `provider:error` / `bus:error` JSONL lines carry
   non-empty error payloads (`name`, `message`, `stack`).

4. `packages/cli/src/index.ts` exports `PACKAGE_NAME` and `async function
   main(argv?: string[]): Promise<number>`. Public surface sorted:
   `["PACKAGE_NAME", "main"]`.

5. `packages/cli/package.json` has `"@mirepoix/coding": "workspace:*"`
   in `dependencies` and a `bin: { "mirepoix": "./src/index.ts" }`
   entry.

6. `bun packages/cli/src/index.ts "hello"` (with a stub `OLLAMA_URL`
   pointing at a mock or a real Ollama) produces a JSONL session log
   at `${MIREPOIX_SESSION_DIR}/<sessionId>.jsonl` with a `session:start`
   line, a `session:end` line, and the schema's required event sequence.

7. `specs/smoke-test-acceptance.md` exists in the repo, copy of the
   staged schema with the three discrepancies resolved (Open Questions
   below).

8. `scripts/smoke-accept.sh` exists, is executable, exits 0 on a passing
   JSONL trace and 1 with a `SMOKE FAIL` message otherwise.

9. `.github/workflows/ci.yml` has:
   - SHA-pinned `actions/checkout` and `oven-sh/setup-bun` with inline
     version-family comments
   - Top-level `permissions: contents: read`
   - Two new steps for `@mirepoix/cli`: tsc + surface smoke (14 steps total)

10. CI passes on the PR (the workflow itself is the binding signal for
    items 1-9 minus the post-merge smoke).

11. All sub-phase B/C regression smokes continue to pass:
    - `@mirepoix/ai` surface (FR-001 from B)
    - `@mirepoix/coding` surface (FR-002 from B)
    - rehydration acceptance fragment (FR-003 from B)
    - `@mirepoix/core` surface (FR-009 from C)
    - All 5 core type-smoke scripts (sub-phase C)
    - Negative type-smoke for unknown event tag (sub-phase C)

12. Layering greps clean:
    - No `process.env` in `packages/{ai,coding,core}/src/`
    - No `process.exit`, `process.chdir`, `console.*` in
      `packages/{ai,coding,core}/src/`
    - No `process.cwd()` in `packages/core/src/`
    - No `@mirepoix/coding` imports in `packages/core/src/`

13. Spike untouched: `git diff phase-zero-spike/` empty.

## FR-010 diff allowlist

Engineer may modify/create:

- `packages/coding/src/prompts/coding.md` (new)
- `packages/coding/src/index.ts` (export prompt — choose mechanism)
- `packages/coding/README.md` (one-line note about the prompts directory)
- `packages/core/src/loop.ts` (NQ-7)
- `packages/core/src/log.ts` (NQ-13 replacer)
- `packages/core/README.md` (note NQ-7/13 closed)
- `packages/cli/package.json` (add workspace dep + bin)
- `packages/cli/src/index.ts` (rewrite from placeholder)
- `packages/cli/src/main.ts`, `packages/cli/src/argv.ts`, `packages/cli/src/render.ts` (or wherever the engineer splits — within `packages/cli/src/`)
- `packages/cli/README.md` (write — replace placeholder)
- `packages/cli/type-smoke/` (optional; smoke files for surface + main-with-stub-provider)
- `specs/smoke-test-acceptance.md` (new — from staged schema)
- `scripts/smoke-accept.sh` (new)
- `.github/workflows/ci.yml` (SHA pins + permissions + 2 new steps)
- `bun.lock` (auto-update for the workspace dep)

Engineer MUST NOT modify:

- `packages/{ai}/**` (sub-phase B's territory)
- `packages/coding/src/{tools,execute,bash}.ts` (sub-phase B's territory; tools already complete)
- `packages/core/src/{bus,events,session}.ts` (sub-phase C's territory; D only touches `loop.ts` and `log.ts`)
- `phase-zero-spike/**` (D.1's territory)
- `adrs/**` (no new ADRs)
- `specs/sub-phase-{a,b,b1-tooling,c}.md` (historical)
- Root `package.json`, root `tsconfig.json`, `biome.json`

## Non-goals (explicit)

- **Spike retirement.** D wires; D.1 retires the spike in a separate
  single-commit PR, gated on the smoke passing the JSONL acceptance
  schema on scotty-gpu. D.1's PR description references this spec.

- Compaction (later in Phase One; lives in `@mirepoix/coding` per ADR-005).
- Skills loader (later in Phase One).
- Streaming, cancellation (Phase Four).
- Multi-provider (Phase Four).
- Self-modification on the locked host (sub-phase E).
- New tools beyond the four base ones (later, via extension API).
- Hot reload of extensions (Phase Two).
- Test framework (Vitest/Jest/Bun test) — smoke + acceptance script remains the contract.
- Status badge in root README, root README "Packages" table updates,
  CLAUDE.md, cross-cutting docs pass (still deferred).
- Renovate / Dependabot automation around the SHA pins.

## Open questions

Three discrepancies between the staged schema doc and the existing
codebase/ADRs. Architect resolves these in the SPEC phase before
committing the doc to the repo.

- **OQ-1 (JSONL key casing).** The staged schema uses snake_case
  (`messages_count`, `working_dir`, `system_prompt_file`,
  `result_preview`, `ollama_url`). Sub-phase C's NQ-4 explicitly chose
  camelCase throughout `MirepoixEvent` payloads (rationale: no legacy
  consumers, spike is going away). *Suggested:* convert the schema doc
  to camelCase before committing. Update the jq paths in
  `scripts/smoke-accept.sh` accordingly. The schema's intent — the
  event vocabulary contract — is preserved; only field names change.

- **OQ-2 (`edit` tool claim).** The staged schema says (line 171)
  "`edit` — NOT YET in the package (sub-phase B's gap). Needs both
  definition + dispatch." Verified against the worktree:
  `packages/coding/src/tools.ts` already exports all four tools
  (`bash`, `read`, `write`, `edit`) and `execute.ts` dispatches all
  four. *Suggested:* update the schema's "Notes for sub-phase D
  implementation → Tool-surface wiring" section to reflect that the
  closing of the tool-surface gap in D is the **CLI wiring** (the
  absence of any caller, plus `tool:start`/`tool:end` events firing
  in production), not the absence of the tool definitions. Drop the
  "needs definition + dispatch" claim.

- **OQ-3 (ADR-002 paraphrase).** The staged schema says (lines 169-173)
  "Per ADR-002: bash gets a cwd guard (don't escape `workingDir`) +
  allowlist hooks (extension-modifiable in later phases); edit gets the
  same path guard as write." ADR-002 explicitly states (line 20):
  *"There is no command allow-list. There is no permission dialog.
  Bash is unrestricted by default."* The schema's ADR-002 paraphrase
  contradicts the real ADR-002. *Suggested:* drop the cwd-guard /
  allowlist-hooks paragraph from the schema. ADR-002's posture stays:
  bash is unrestricted, operator runs in a sandbox/VM. Sub-phase D
  ships no path sandboxing, no command allowlist, no permission
  prompts. The `--cwd` flag is convenience for the operator, not a
  security boundary.

- **OQ-4 (`session:start.systemPrompt` content vs path).** ADR-005's
  reconstructability invariant says the JSONL must preserve enough
  state to replay. Sub-phase C's `session:start` carries
  `systemPrompt` (the content). The staged schema's `session:start`
  has `system_prompt_file` (the path). These are different —
  content vs provenance. *Suggested:* extend `session:start`'s payload
  to carry BOTH:
  - `systemPrompt: string` (content, from C, ADR-005 invariant —
    unchanged)
  - `systemPromptFile: string | null` (path provenance — new in D;
    `null` when the default in-package prompt was used)
  This is a one-line addition to the event union and is in scope for D
  (it's the CLI's piece of provenance).

- **OQ-5 (where the CLI's prompt loader lives).** Two natural shapes
  for loading `packages/coding/src/prompts/coding.md`:
  1. `@mirepoix/coding` exports `DEFAULT_SYSTEM_PROMPT: string` at
     build/load time (read the .md file inside the package and inline
     it via a side-effect-free top-level call).
  2. `@mirepoix/coding` exports `DEFAULT_SYSTEM_PROMPT_PATH: string`
     (a function or constant returning the absolute path) and the CLI
     reads the file.
  *Suggested:* (1). The prompt is a static asset; reading it at module
  load time is cheap and avoids exposing filesystem paths through the
  package boundary. Bun loads `.md` via the text loader if configured;
  otherwise a one-line `readFileSync` inside the package suffices.

- **OQ-6 (`process.chdir` in CLI).** The CLI may or may not actually
  call `process.chdir` when `--cwd=PATH` is supplied. Two shapes:
  1. CLI calls `process.chdir(resolved)` early; all downstream code
     sees the new cwd; `run(...)` receives `workingDir: process.cwd()`.
  2. CLI does not chdir; passes the resolved path as
     `workingDir` to `run(...)`; bash tool invocations inherit
     `process.cwd()` (the original) unless `runBash` is changed to
     accept a cwd.
  *Suggested:* (1) — matches the spike's behavior (line 80-82) and
  keeps `runBash` unchanged. The spike has been validated end-to-end;
  the CLI inheriting that behavior is the lowest-risk path. NQ-7's
  `workingDir` becomes "what the operator asked for"; the bash tool's
  effective cwd is the same value via `process.chdir`. Document the
  choice; sub-phase E may revisit if self-modification needs a
  cwd-per-tool-call model.

- **OQ-7 (SHA-pin lookup mechanism).** The engineer needs the current
  commit SHA for `actions/checkout@v4` and `oven-sh/setup-bun@v2`.
  Two options: (a) query GitHub's API at SPEC/CODE time and pin to the
  returned SHA; (b) let the engineer pick the latest stable SHA from
  the action's release page and document the date. *Suggested:* (b).
  Encode the SHA plus an inline comment of the form
  `# v4.2.2 — released 2026-04-30 (commit abc1234)`. Renovate (not
  installed in this sub-phase) could automate later.

## Key references

- `specs/sub-phase-b.md`, `specs/sub-phase-b1-tooling.md`,
  `specs/sub-phase-c.md` — predecessor sub-phases.
- `phase-zero-spike/mirepoix-spike.ts` — the source for argv parsing
  (lines 62-74), env reads (lines 41-44), default system prompt (lines
  48-59), session ID generation (line 45), mkdir + log path
  construction (lines 43-46, 84), bootstrap line (line 293), session
  log line (line 381).
- `adrs/ADR-001-minimal-core-and-package-boundaries.md` — layering;
  `cli → coding → {core, ai}`.
- `adrs/ADR-002-tool-surface-and-security-posture.md` — bash
  unrestricted; no allowlist; no permission dialog.
- `adrs/ADR-005-context-ownership-and-observability.md` — system prompt
  lives in `packages/coding/src/prompts/coding.md`; JSONL log is the
  source of truth.
- `~/Documents/Claude/Projects/Project Pi/translation-experiments/smoke-acceptance-schema.md`
  — staged JSONL acceptance schema; copied into the repo as part of D.
- `~/Documents/Claude/Projects/Project Pi/translation-experiments/multihead_attention.py`
  — smoke fixture; scp'd to scotty-gpu post-merge.
- `~/Documents/Claude/Projects/Project Pi/translation-experiments/pytorch-to-rust-prompt.txt`
  — smoke system prompt; scp'd to scotty-gpu post-merge.
- `packages/core/src/loop.ts` — NQ-7 target.
- `packages/core/src/log.ts` — NQ-13 target.
- `packages/coding/src/{tools,execute,bash}.ts` — already-complete tool
  surface; D wires it, doesn't modify it.
- `packages/cli/{package.json,src/index.ts,tsconfig.json}` — current
  placeholder state.
- Sub-phase D.1 (forthcoming, separate PR): spike retirement, gated on
  smoke pass.

## Deliverables

Files this sub-phase committed to the repository tree (backfilled retroactively
per `specs/harness-deliverable-tracking.md`; every path below is tracked on
`main` as of the harness-deliverable-tracking PR):

- `packages/cli/src/index.ts`
- `packages/cli/src/main.ts`
- `packages/cli/src/argv.ts`
- `packages/cli/src/render.ts`
- `packages/cli/type-smoke/surface.ts`
- `packages/cli/type-smoke/main-stub-provider.ts`
- `packages/cli/type-smoke/run-options-missing-wd.ts`
- `packages/cli/type-smoke/tsconfig-negative.json`
- `packages/cli/package.json`
- `packages/cli/README.md`
- `packages/coding/src/prompts.ts`
- `packages/coding/src/prompts/coding.md`
- `packages/coding/src/index.ts`
- `packages/coding/README.md`
- `packages/core/src/events.ts`
- `packages/core/src/loop.ts`
- `packages/core/src/log.ts`
- `packages/core/type-smoke/loop-end-to-end.ts`
- `packages/core/type-smoke/log-roundtrip.ts`
- `packages/core/README.md`
- `specs/smoke-test-acceptance.md`
- `scripts/smoke-accept.sh`
- `.github/workflows/ci.yml`
- `bun.lock`
