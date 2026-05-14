# Mirepoix smoke-test acceptance — JSONL schema + runbook

This document is the binding acceptance contract for the post-merge smoke run
of `@mirepoix/cli`. It pairs a runbook (operator instructions) with a JSONL
schema (machine-checkable pass criteria). `scripts/smoke-accept.sh` is the
executable form of the pass criteria — a green run of that script against a
session log produced by the CLI is the gate that unblocks sub-phase D.1
(spike retirement, separate PR).

The schema and runbook live in one file (NQ-D-4). Field names are camelCase
throughout (OQ-1 / NQ-D-1). All `--cwd`, `--system-prompt-file`, and bash
behavior follows ADR-002 (OQ-3): bash is unrestricted, no command allowlist,
no path sandbox, no permission prompt. The operator runs the smoke inside a
container, VM, or directory they are willing to lose.

---

# Smoke runbook (post-D merge)

Prerequisites: `scotty-gpu` has Bun installed, has Ollama reachable on
localhost serving `qwen2.5-coder:32b-instruct`, has `jq` on `PATH`, and has a
checkout of `mirepoix` at `~/mirepoix`.

1. `scp ~/Documents/Claude/Projects/Project\ Pi/translation-experiments/multihead_attention.py scotty-gpu:~/workspaces/source/`
2. `scp ~/Documents/Claude/Projects/Project\ Pi/translation-experiments/pytorch-to-rust-prompt.txt scotty-gpu:~/workspaces/prompts/`
3. `ssh scotty-gpu`
4. `cd ~/mirepoix && git pull`
5. `bun install --frozen-lockfile`
6. `mkdir -p ~/workspaces/target`
7. ```
   bun packages/cli/src/index.ts \
     --system-prompt-file=~/workspaces/prompts/pytorch-to-rust-prompt.txt \
     --cwd=~/workspaces/target \
     "translate ~/workspaces/source/multihead_attention.py to Rust using candle-core"
   ```
8. `SESSION_LOG=$(ls -t ~/.local/share/mirepoix/sessions/*.jsonl | head -1)`
9. `bash scripts/smoke-accept.sh "$SESSION_LOG"`

A pass on step 9 (exit 0) unblocks sub-phase D.1. A fail (exit 1 with
`SMOKE FAIL: <why>` on stderr) blocks D.1 and is fed back to the coding agent
as the next-iteration target.

The runbook is prose, not executable; CI does not exercise step 7's real
Ollama call. CI's smoke is the stub-provider type-smoke at
`packages/cli/type-smoke/main-stub-provider.ts`.

---

# JSONL schema (`schemaVersion: "1"`)

Every line of a Mirepoix session log is a JSON object. The first line is a
synthetic header written by `createSessionLogger` with the schema version.
Subsequent lines correspond to `MirepoixEvent` emissions from the kernel
(`packages/core/src/events.ts`). The outer envelope is identical across
events:

```jsonc
{ "ts": "<ISO 8601 UTC>", "event": "<tag>", "payload": <object> }
```

The header line additionally carries `schemaVersion: "1"`.

## Header

```json
{ "schemaVersion": "1", "ts": "...", "event": "session:log-init", "payload": {} }
```

`session:log-init` is NOT a member of `MirepoixEvent` (NQ-1 from sub-phase C).
Consumers do not need to handle it as a tag arm.

## Required event lines

For a session that ends with `reason: "model_done"` (the smoke's happy path):

| Sequence position | `event`                | Required payload fields                                                                                          | Notes |
| ----------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ----- |
| 1 (after header)  | `session:start`        | `id`, `systemPrompt`, `systemPromptFile`, `model`, `url`, `workingDir`                                            | `systemPromptFile` is `null` when default in-package prompt was used (OQ-4 / FR-005); a string when `--system-prompt-file=PATH` was passed. |
| 2                 | `message:user`         | `content`                                                                                                         | The user prompt verbatim.                                                                       |
| per turn          | `provider:request`     | `turn`, `messagesCount`                                                                                           | One per turn before the provider call.                                                          |
| per turn          | `provider:response`    | `turn`, `message`, `rehydrated`, `rehydratedToolCalls?`                                                          | Full `AssistantMessage` preserved (ADR-005 reconstructability).                                |
| per turn          | `message:assistant`    | `role`, `content`, `tool_calls?`                                                                                  | `content` may be `null` when tool calls were rehydrated.                                       |
| per tool call     | `tool:start`           | `name`, `args`, `callId`                                                                                          | `callId` is the provider-issued tool-call id.                                                  |
| per tool call     | `tool:end` or `tool:error` | `tool:end`: `name`, `callId`, `resultPreview`, `resultLength` / `tool:error`: `name`, `callId`, `error` | Exactly one of the two per `callId`. `error` is `{ name, message, stack, ...own }` (NQ-13 / FR-004). |
| final             | `session:end`          | `reason ∈ {"model_done", "max_turns"}`, `turns`                                                                  | Exactly one per session.                                                                       |

## Optional / error event lines

| `event`                | Required payload fields                          | Notes                                                                                                                  |
| ---------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `provider:error`       | `turn`, `error`                                  | Loop emits then rethrows. CLI catches and exits 1. NQ-13 acceptance: `error.message` non-empty.                       |
| `bus:error`            | `tag`, `error`, `handler?`                       | Handler containment surface (ADR-004). NQ-13 acceptance applies.                                                       |
| `bus:slow-handler`     | `tag`, `durationMs`, `handler?`                  | Default threshold 50ms; ADR-004.                                                                                       |
| `session:compact`      | `before`, `after`, `strategy`                    | Forward-compat; not emitted by sub-phase D's loop.                                                                     |

## Payload key conventions (OQ-1 / NQ-D-1)

All payload keys are camelCase. Sub-phase B's snake_case spike fields are
renamed as follows; the schema, the JSONL emissions, and
`scripts/smoke-accept.sh`'s jq paths are all consistent:

| Spike key            | Schema key         |
| -------------------- | ------------------ |
| `messages_count`     | `messagesCount`    |
| `result_preview`     | `resultPreview`    |
| `working_dir`        | `workingDir`       |
| `system_prompt_file` | `systemPromptFile` |
| `ollama_url`         | `url`              |
| `session_id`         | `id`               |

The JSONL file is per-session; the outer envelope's `event` tag is implicitly
scoped to one session, so the field stays `id` (not `sessionId`) inside
`session:start.payload`. NQ-D-1.

## Error-payload shape (NQ-13 / FR-004)

`@mirepoix/core/src/log.ts` installs an `errorAwareReplacer` that serializes
`Error` instances faithfully. The `error` field of `bus:error`,
`provider:error`, and `tool:error` payloads is:

```json
{
  "name": "<Error constructor name>",
  "message": "<error.message>",
  "stack": "<error.stack>",
  ...<own enumerable props>
}
```

`message` is a non-empty string. `stack` is best-effort but always populated
when the error was constructed via `new Error(...)` in V8 / JavaScriptCore.

The pass-criteria script (`scripts/smoke-accept.sh`) checks that any
error-bearing payload has `error.message` as a non-empty string. Stack-trace
leakage to the log is accepted (Sec-004): the session log is local-host and
operator-controlled.

## Tool-surface wiring (OQ-2 reconciliation)

All four base tools (`bash`, `read`, `write`, `edit`) are already defined and
dispatched in `packages/coding/src/{tools,execute}.ts` per sub-phase B. The
tool-surface gap closed in sub-phase D is the **CLI wiring** — the absence of
any production caller, plus `tool:start`/`tool:end` events firing through
`@mirepoix/core`'s bus rather than being lost. No new tool definitions are
added in D.

## Security posture (OQ-3 / Sec-001)

Per ADR-002, bash is unrestricted. There is no command allowlist, no path
sandbox, and no permission dialog. The `--cwd` flag is operator convenience
for setting the working directory; it is not a security boundary. The
operator runs Mirepoix inside a container, VM, or directory they are willing
to lose. `read`, `write`, and `edit` resolve paths against `process.cwd()`
and can read or write anywhere the process has filesystem permission.

The schema's predecessor wording (cwd guard, allowlist hooks, write-style
path guard for edit) contradicted ADR-002 and was removed in OQ-3.

---

# Pass criteria

The script at `scripts/smoke-accept.sh` is the executable form of these
criteria. The script takes one positional argument (the path to a JSONL
session log), exits 0 on pass, or exits 1 on the first failure with a
`SMOKE FAIL: <why>` message on stderr.

## Criteria

1. **File exists and is non-empty.** `test -s <path>` succeeds.
2. **Every line is valid JSON.** `jq -e .` on each line exits 0.
3. **First line is the header.** `event === "session:log-init"` and
   `schemaVersion === "1"`.
4. **Exactly one `session:start` line.** Payload fields populated: `id`
   (string), `systemPrompt` (string), `model` (string), `url` (string),
   `workingDir` (string), `systemPromptFile` (string OR `null`).
5. **Exactly one `session:end` line.** `payload.reason` is one of
   `"model_done"` or `"max_turns"`. `payload.turns` is a number.
6. **At least one `provider:request` and one `provider:response`.** Each
   payload has a numeric `turn` and a numeric `messagesCount` (for
   `provider:request`).
7. **Tool round-trip integrity.** For every `tool:start` line, there is a
   matching `tool:end` OR `tool:error` line with the same `callId`. (The
   reverse is not required — `tool:end`/`tool:error` without `tool:start`
   would indicate corruption upstream of D's scope.)
8. **NQ-13 / FR-004 error round-trip.** Every `tool:error`, `provider:error`,
   and `bus:error` line's `payload.error.message` is a non-empty string.
9. **Field-name casing.** No snake_case keys appear in any payload. The
   forbidden tokens (regex hit failure) are:
   `messages_count`, `working_dir`, `system_prompt_file`, `result_preview`,
   `ollama_url`, `session_id`.

## Reference smoke (CI-time, stub provider)

`packages/cli/type-smoke/main-stub-provider.ts` produces a known-good JSONL
trace using an in-process stub provider. Build-agent self-test:

```sh
bun packages/cli/type-smoke/main-stub-provider.ts                 # prints "smoke-log: <path>"
bash scripts/smoke-accept.sh <path>                                # must exit 0

echo "" > /tmp/empty.jsonl
! bash scripts/smoke-accept.sh /tmp/empty.jsonl                    # must exit 1
```

---

# Sub-phase D.1 gate

A pass of `scripts/smoke-accept.sh` against a real `scotty-gpu` session log
unblocks sub-phase D.1. D.1 is a separate single-commit PR that:

1. Deletes `phase-zero-spike/mirepoix-spike.ts` (and the `phase-zero-spike/`
   directory if it has no other files).
2. Removes the `Spike-frozen guard` step from `.github/workflows/ci.yml`.
3. References this document and the green-smoke session-log URL in its PR
   description.

D.1's diff is therefore: one file delete + one CI step delete. No other
production changes are anticipated.
