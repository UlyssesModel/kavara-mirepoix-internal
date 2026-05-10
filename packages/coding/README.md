# @mirepoix/coding

The four base coding tools for Mirepoix, per ADR-002: `bash`, `read`, `write`,
`edit`. No more, no permission dialogs, no allow-lists. An executor dispatches
tool calls by name and returns a plain string result in every case — success,
tool error, or unknown name. The explicit security posture (bash unrestricted,
no path sandboxing, no timeouts) is intentional and documented in ADR-002;
operators are expected to run Mirepoix inside a container or VM they can lose.

## Public surface

### `PACKAGE_NAME`

```ts
export const PACKAGE_NAME = "@mirepoix/coding" as const;
// value: "@mirepoix/coding"
```

Identity sentinel. Useful for log prefixes and diagnostic assertions.

---

### `tools`

```ts
export const tools: Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: { type: "object"; properties: Record<string, unknown>; required: string[] };
  };
}>;
```

Array of four tool definitions in the OpenAI function-calling wire format,
passed verbatim to `callProvider` from `@mirepoix/ai`. The definitions are:

| Tool | Required parameters | Description |
|------|--------------------|-|
| `bash` | `command: string` | Run a shell command; return stdout, stderr, and exit code. |
| `read` | `path: string` | Read a file and return its contents as a string. |
| `write` | `path: string`, `content: string` | Write content to a file; creates parent directories; overwrites if it exists. |
| `edit` | `path: string`, `old_string: string`, `new_string: string` | Replace `old_string` with `new_string`; `old_string` must match exactly and uniquely. |

---

### `executeTool(name, args) → Promise<string>`

```ts
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string>;
```

Dispatches to the tool implementation identified by `name`. Returns a result
string in all cases — the function never throws to its caller. The return
strings are byte-equivalent to the Phase Zero spike:

| Outcome | Return string |
|---------|--------------|
| `bash` success | `"stdout:\n${stdout}\nstderr:\n${stderr}\nexit: ${code}"` |
| `read` success | file contents (string) |
| `write` success | `"wrote ${n} bytes to ${path}"` |
| `edit` success | `"edited ${path}"` |
| `edit` — `old_string` absent | `"error: old_string not found in ${path}"` |
| `edit` — `old_string` matches more than once | `"error: old_string matches ${n} times in ${path}, must be unique"` |
| unknown `name` | `"unknown tool: ${name}"` |
| any thrown exception | `"error: ${e.message}"` |

`path` arguments are resolved via `resolve(args.path)` against `process.cwd()`
before any filesystem operation.

## Why `runBash` is internal

`runBash` (in `src/bash.ts`) is exported from its module so `execute.ts` can
import it, but it is deliberately not re-exported from `src/index.ts`. The
package's public contract is "four named tools via `executeTool`"; exposing
`runBash` directly would invite callers to bypass the tool dispatcher and
create an unversioned surface that is harder to evolve. If a future use case
genuinely requires direct shell access with custom semantics, export it then
(per ADR-001's principle: add surface when you have a consumer, not in
anticipation). Consumers that need bash call `executeTool("bash", { command })`.

## Security posture

This package carries the ADR-002 posture commitment verbatim from the Phase
Zero spike. Operators must understand and accept these before deploying:

- **Bash unrestricted.** `executeTool("bash", { command })` passes the
  model-provided string to `spawn("bash", ["-c", command])` with no
  allow-list, no sandbox, and no permission prompt.
- **No path sandboxing.** `read`, `write`, and `edit` resolve paths against
  `process.cwd()` and can read or write anywhere the process has filesystem
  permission. There is no chroot or path prefix constraint.
- **No timeouts.** Bash commands, file reads, and file writes run unbounded.
  Operators who need timeouts add them in an extension layer (ADR-002
  implementation notes).

ADR-002 treats Mirepoix as a tool for developers running in an environment
they control. The sandbox/VM is the operator's responsibility, not the
package's. See `adrs/ADR-002-tool-policy.md` for the full rationale.

## Sub-phase C dependency

The Phase Zero spike calls `log("tool:start", ...)`, `log("tool:end", ...)`,
and `log("tool:error", ...)` around tool execution to write structured events
to the JSONL session log (ADR-005). Those calls were intentionally dropped from
`executeTool` in this sub-phase: observability is a `@mirepoix/core` concern.

In sub-phase C, `@mirepoix/core` introduces the typed event bus (ADR-004). The
dispatcher in core will wrap `executeTool` and emit `tool:start` / `tool:end` /
`tool:error` events without `@mirepoix/coding` needing to know about the bus.
Until then, tool invocations produce no session-log audit trail.

## Source of truth

Extracted from the Phase Zero spike at `phase-zero-spike/mirepoix-spike.ts`:

| File | Spike lines |
|------|-------------|
| `src/tools.ts` | 101-160 |
| `src/bash.ts` | 162-173 |
| `src/execute.ts` | 240-278 (with `log()` calls dropped) |

The spike remains the working harness through sub-phase D and must not be
modified.

## Stability

Sub-phase B surface. `tools`, `executeTool`, and `PACKAGE_NAME` are stable for
sub-phase C. The sub-phase C event-bus integration will wrap `executeTool` from
outside this package; no breaking changes to this surface are anticipated.

## Local development

Run from the repo root. See root-level docs for the full command reference.

```bash
bun install                                                    # install devDeps (once)
bun x biome ci .                                               # lint + format check
bun x biome check --write .                                    # auto-fix lint (Biome 2.x)
bun x tsc --noEmit -p packages/coding/tsconfig.json           # type-check this package
```

CI runs all four steps automatically on every push and PR via `.github/workflows/ci.yml`.
