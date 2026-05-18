# Issue #14 — Plumb workingDir through executeTool as ToolContext aggregate

## Status

Phase: One follow-up. Not a sub-phase; a discrete refactor closing
[Issue #14](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/14).
First concrete deliverable under [ADR-014](adrs/ADR-014-domain-driven-design-adoption.md)
**Refactor 2 / MS-3** — the `ToolContext` aggregate that carries the
`workingDir` value object to each tool at invocation time.

Pre-OQ snapshot per the spec-resolution convention (commit `1a83a67`).
The resolved contract lives in this file's `## Open Questions (OQs)` and
`## Negative Questions (NQs)` resolutions plus the merged PR body.

**Disambiguation:** the originating prompt mis-numbered this as "Refactor 1."
Per [ADR-014 §40](adrs/ADR-014-domain-driven-design-adoption.md) and
[CONTEXT-MAP.md R1](CONTEXT-MAP.md), Refactor 1 is the prospective
`Message` + `Tool` types refactor (MS-1 / MS-2); **Refactor 2 is
`ToolContext` + `ToolRegistry` (MS-3)** and is what this PR delivers.
The CLAUDE.md "NQ-7 concession" section already cites this correctly as
"the first concrete ADR-014 Refactor 2 deliverable."

## Context

The harness has carried a transitional NQ-7 holding-pattern assertion at
`packages/core/src/loop.ts:84` since commit `781c653`:

```ts
if (options.workingDir !== process.cwd()) {
  throw new Error(
    `workingDir/process.cwd() divergence — see ADR-014 issue #14. ` +
      `options.workingDir=${options.workingDir}; process.cwd()=${process.cwd()}`,
  );
}
```

The assertion exists because `@mirepoix/coding`'s tools bind to
`process.cwd()` at invocation time (not at session-construction time):

- `packages/coding/src/bash.ts:10` — `spawn("bash", ["-c", command])` with
  **no `cwd:` option**; the bash child inherits the parent's
  `process.cwd()`.
- `packages/coding/src/execute.ts:17,19,25` — `resolve(args.path)` (Node
  `path.resolve`) resolves relative paths against `process.cwd()` by default.

So `RunOptions.workingDir` was *structurally advisory* — a field carried
through the JSONL `session:start.workingDir` payload but with no causal
link to where bash actually spawned or where `read`/`write`/`edit`
actually wrote. The CLI papered over the gap with `process.chdir` at
`packages/cli/src/main.ts:61` so the two values stayed coincident; the
NQ-7 assertion was a CI-checked cross-check that any non-CLI caller (an
extension host, a future MCP frontend, programmatic embedding) would
either remember the same chdir or fail loudly.

[CONTEXT-MAP.md R1](CONTEXT-MAP.md) names this the **`workingDir`
invariant** — three coincident sites + an explicit retirement target:
"The destination shape per ADR-014 Refactor 2 is a `ToolContext`
aggregate passed as a parameter to each tool — eliminating the
structural binding."

This PR is that destination shape landing.

<task>
Plumb the `workingDir` value object to each tool through a
`ToolContext` aggregate. `runBash` and `executeTool` take a third
argument `ctx: ToolContext`; the core agent loop constructs the context
once from `options.workingDir` and passes it to every `executeTool`
call. The NQ-7 holding-pattern assertion in `packages/core/src/loop.ts`
is deleted in the same PR, along with its negative integration smoke
and its CI step. A positive type-smoke that asserts ctx threading
replaces them. `CONTEXT-MAP.md` R1 moves from "destination shape" to
"landed shape" inline in the same PR.
</task>

<grounding_rules>

This spec is bound to the following source locations. Line numbers reflect
HEAD as of branch `issue-14-toolcontext-aggregate` (latest commit
`791f034`).

**Refactor surface (touch):**

- `packages/coding/src/bash.ts` — `runBash(command: string): Promise<string>`
  at line 8. Adds `ctx: ToolContext` parameter and `cwd: ctx.workingDir`
  to `spawn(...)` at line 10.
- `packages/coding/src/execute.ts` — `executeTool(name, args)` at line 11.
  Adds `ctx: ToolContext` parameter. Three `resolve(args.path as string)`
  call sites at lines 17 (`read`), 19 (`write`), 25 (`edit`) change to
  `resolve(ctx.workingDir, args.path as string)`. The `runBash` call at
  line 15 changes to pass `ctx` through.
- `packages/coding/src/index.ts` — gains
  `export type { ToolContext } from "./context";` (type-only; no runtime
  artifact, no surface-smoke change).
- `packages/coding/src/context.ts` — **NEW**. Defines and exports
  `interface ToolContext { workingDir: string }`.
- `packages/core/src/loop.ts` — `RunOptions.executeTool` declaration at
  line 48 widens its signature (structural typing; core does not import
  `ToolContext`). The NQ-7 holding-pattern assertion block at lines 70–89
  is **deleted** (the comment block AND the `if`-throw). The header
  comment at lines 17–21 drops the "One transitional exception" paragraph.
  Inside `run()`, before the `for (const tc of toolCalls)` loop at line 144,
  a `const toolContext = { workingDir: options.workingDir };` is
  constructed once and passed as the third argument to
  `options.executeTool(...)` at line 149.
- `packages/core/type-smoke/loop-end-to-end.ts` — the five
  `executeTool: async (...) => ...` stubs (lines 26, 71, 128, 178, 209)
  update their parameter lists to accept (and ignore) the new third
  `ctx` argument. `workingDir: process.cwd()` stays on each call site.

**Surface (delete):**

- `packages/core/type-smoke/loop-workdir-assertion.ts` — the negative
  integration smoke whose sole job is asserting the NQ-7 throw fires.
  Removed entirely.

**Surface (new):**

- `packages/core/type-smoke/loop-toolcontext.ts` — **NEW**. Positive
  type-smoke proving `ctx.workingDir` reaches `executeTool` via parameter,
  not via `process.cwd()`.

**Surface (CI):**

- `.github/workflows/ci.yml` — line 49–50 (`Smoke test — workingDir/cwd
  divergence asserts (issue #14 transitional)`) **deleted**. A new step
  running `bun packages/core/type-smoke/loop-toolcontext.ts` is added.
  The `Deliverable-tracking check` step at lines 63–79 has its `grep -l`
  glob widened from `specs/sub-phase-*.md specs/harness-*.md` to also
  include `specs/issue-*.md`.

**Surface (docs):**

- `CONTEXT-MAP.md` — R1 entry (line ~74–86) undergoes **three** concrete
  edits, not one. Operative directives:

  > **Item 3 of R1 must flip** from "implicitly consumed via structural
  > binding" (the footgun-state framing) to "explicitly received via
  > `ToolContext` parameter" (the landed-state framing). Three coincident
  > sites become three explicit-receipt sites.

  > **Additionally, R1 gains a one-sentence note:** "Structural typing
  > (`ctx: { workingDir: string }`) is how the `core ↛ coding` boundary
  > is preserved without forcing a `coding → core` import edge — core
  > uses the duck-typed shape, coding owns the concrete `ToolContext`
  > definition (NQ-C)."

  Concretely, the three edits the CODE-phase agent applies to R1:
  (a) Item 3 flips. The two sub-bullets that cited `spawn(...)` without
      `cwd:` and `resolve(args.path)` defaulting to `process.cwd()`
      are removed (no longer true) and replaced with sub-bullets
      citing the post-PR call sites:
      `packages/coding/src/bash.ts` — `spawn("bash", ["-c", command], { cwd: ctx.workingDir })`;
      `packages/coding/src/execute.ts` — `resolve(ctx.workingDir, args.path as string)`
      at the `read` / `write` / `edit` arms.
  (b) The final-paragraph "destination shape … eliminating the
      structural binding" phrase becomes past-tense "landed shape —
      eliminated the structural binding."
  (c) The NQ-7 assertion-citation sentence is **removed** (assertion
      deleted, not deprecated). The one-sentence structural-typing
      note (quoted above, verbatim) is added in its place.

  Per [ADR-014 §52](adrs/ADR-014-domain-driven-design-adoption.md),
  inline-during-decision discipline; this update happens in the same
  PR. The resolution ID `R1` is reused — no new tag, no `R18`.

**Untouched (load-bearing constraints — do not modify):**

- `packages/coding/src/tools.ts` — the four wire schemas. Byte-equivalent.
  The `bash` description string ("Run a shell command in the working
  directory…") was already correct and stays.
- `packages/cli/src/main.ts` — the existing `process.chdir` at line 61
  stays; the `executeTool: executeTool` assignment at line 119 already
  passes the function reference through unchanged. The CLI requires no
  edits unless tsc surfaces a structural-typing mismatch at the
  `RunOptions` construction site (NQ-D, below). If a minimal edit is
  required to keep tsc green, this file is added to Deliverables at
  CODE time.
- `packages/cli/type-smoke/run-options-missing-wd.ts` — keep as-is. Its
  job (assert `RunOptions.workingDir` remains required at the type level)
  is unchanged.
- `packages/cli/type-smoke/tsconfig-negative.json` — keep as-is.
- The CI surface-smoke for `@mirepoix/coding` at ci.yml lines 41–43
  checks runtime exports equal `["DEFAULT_SYSTEM_PROMPT","PACKAGE_NAME","executeTool","tools"]`.
  `export type { ToolContext }` has no runtime presence — **the smoke
  stays byte-equivalent**. Do not "fix" it.
- The CI surface-smoke for `@mirepoix/core` at lines 45–47 checks
  `["Bus","PACKAGE_NAME","Session","createSessionLogger","run","schemaVersion"]`.
  No runtime change. **The smoke stays byte-equivalent.**

</grounding_rules>

<structured_output_contract>

The resulting code surface after this PR lands:

```ts
// packages/coding/src/context.ts (NEW)
/**
 * ToolContext — the aggregate carried into every tool invocation.
 *
 * Per ADR-014 Refactor 2 / MS-3 and CONTEXT-MAP.md R1. The workingDir
 * value object is the default resolution base for relative paths in
 * read/write/edit and the spawn cwd for bash. Replaces the structural
 * binding to process.cwd() that the NQ-7 holding-pattern assertion
 * cross-checked.
 *
 * Not a security boundary (ADR-002): tools still accept any path or
 * command; workingDir is a default, not a sandbox.
 */
export interface ToolContext {
  /** Absolute working-directory path. The CLI's resolved --cwd, or
   *  the operator's process.cwd() at invocation time. */
  workingDir: string;
}
```

```ts
// packages/coding/src/index.ts (delta)
export { tools } from "./tools";
export { executeTool } from "./execute";
export { DEFAULT_SYSTEM_PROMPT } from "./prompts";
export const PACKAGE_NAME = "@mirepoix/coding" as const;
export type { ToolContext } from "./context";   // <-- ADDED (type-only)
```

```ts
// packages/coding/src/bash.ts (new signature)
import { spawn } from "node:child_process";
import type { ToolContext } from "./context";

export async function runBash(command: string, ctx: ToolContext): Promise<string> {
  return new Promise((resolveBash) => {
    const proc = spawn("bash", ["-c", command], { cwd: ctx.workingDir });
    // … unchanged stdout/stderr/close shape
  });
}
```

```ts
// packages/coding/src/execute.ts (new signature)
import type { ToolContext } from "./context";

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  // bash:  await runBash(args.command as string, ctx)
  // read:  readFileSync(resolve(ctx.workingDir, args.path as string), "utf-8")
  // write: const path = resolve(ctx.workingDir, args.path as string);
  // edit:  const path = resolve(ctx.workingDir, args.path as string);
  // try/catch shape unchanged; "unknown tool" arm unchanged.
}
```

```ts
// packages/core/src/loop.ts (RunOptions.executeTool widened — structural typing)
export interface RunOptions {
  // … unchanged fields
  executeTool: (
    name: string,
    args: Record<string, unknown>,
    ctx: { workingDir: string },   // <-- structural, NOT imported from coding
  ) => Promise<string>;
  // … unchanged fields
  workingDir: string;
  // …
}

// inside run(), before the toolCalls loop:
const toolContext = { workingDir: options.workingDir };
// inside the toolCalls loop:
result = await options.executeTool(tc.function.name, args, toolContext);
```

The NQ-7 assertion block at the top of `run()` is **deleted**, not
commented out. The header comment block's "One transitional exception"
paragraph is removed.

The `MirepoixEvent` schema is **unchanged**. `session:start.workingDir`
still carries the value; `tool:start.args` still carries the raw args
object. ToolContext is an in-process aggregate; it does not appear on the
JSONL wire.

</structured_output_contract>

<verification_loop>

Each deliverable has an executable verification step. CODE-phase agent
runs these in sequence; SECURITY/REVIEW phase agents re-run them to
confirm landing.

1. **Type-check all four packages** — `bunx tsc --noEmit` against each
   `packages/<pkg>/tsconfig.json`. Must exit 0 for ai, coding, core, cli.
   The CLI's check is the load-bearing one for structural-typing
   compatibility: if `@mirepoix/coding`'s `executeTool` and core's
   `RunOptions.executeTool` are not structurally compatible, the CLI's
   `RunOptions` construction at `packages/cli/src/main.ts:114-122` will
   surface a tsc error.

2. **Negative type-smoke (still binding)** —
   `cd packages/cli && bunx tsc --noEmit -p type-smoke/tsconfig-negative.json`
   must continue to **fail** (with a leading `!` in CI). The file's
   job — assert tsc rejects a `RunOptions` literal missing `workingDir` —
   is unchanged by this refactor.

3. **Biome lint + format** — `bunx biome ci .` exits 0. New files
   (`packages/coding/src/context.ts`, `packages/core/type-smoke/loop-toolcontext.ts`)
   conform to the existing Biome config; no new rules.

4. **`@mirepoix/coding` runtime-surface smoke (unchanged expected output)** —
   `bun -e 'import * as coding from "./packages/coding/src/index.ts";
   const keys = Object.keys(coding).sort();
   const expected = ["DEFAULT_SYSTEM_PROMPT","PACKAGE_NAME","executeTool","tools"];
   if (JSON.stringify(keys) !== JSON.stringify(expected)) process.exit(1);'`
   exits 0. `export type { ToolContext }` has no runtime artifact, so the
   sorted-keys array is byte-equivalent to today.

5. **`@mirepoix/core` runtime-surface smoke (unchanged expected output)** —
   `bun -e 'import * as core from "./packages/core/src/index.ts";
   const keys = Object.keys(core).sort();
   const expected = ["Bus","PACKAGE_NAME","Session","createSessionLogger","run","schemaVersion"];
   if (JSON.stringify(keys) !== JSON.stringify(expected)) process.exit(1);'`
   exits 0.

6. **Positive end-to-end smoke (existing, updated)** —
   `bun packages/core/type-smoke/loop-end-to-end.ts` prints
   `loop-end-to-end OK` and exits 0. All five `executeTool` stubs accept
   the new third parameter (signature widened); the event sequences and
   message-tape lengths are unchanged.

7. **NEW positive smoke — ToolContext threading** —
   `bun packages/core/type-smoke/loop-toolcontext.ts` prints
   `loop-toolcontext OK` and exits 0. Asserts:
   (a) the stub `executeTool` receives a `ctx` argument with
       `ctx.workingDir === <test-supplied path>`, where the path differs
       from `process.cwd()` (proving the value flowed through the
       parameter, not through process state);
   (b) optionally — exercises the real `@mirepoix/coding` `executeTool`
       from a fresh `mkdtemp` directory and asserts (b1) a `bash` call
       with `command: "pwd"` returns the temp directory's path (proving
       `spawn` uses `cwd: ctx.workingDir`), and (b2) a `read` call with
       a relative path resolves against the temp directory, not against
       `process.cwd()`. The real-executeTool path is strongly recommended;
       the stub-only path is mandatory (see OQ-4).

8. **NEGATIVE smoke deleted, not skipped** —
   `packages/core/type-smoke/loop-workdir-assertion.ts` is gone from
   the worktree; CI's old step at ci.yml line 49–50 is gone from the
   workflow file. `git log --diff-filter=D --name-only` shows the
   deletion in this PR's diff.

9. **Deliverable-tracking check passes against this spec** —
   `bash scripts/check-deliverables.sh specs/issue-14-toolcontext.md`
   exits 0. The widening of the CI grep glob to include `specs/issue-*.md`
   is what makes the existing CI step pick up this spec on subsequent
   PRs (this PR's own deliverable check is the explicit script
   invocation, not the broadened glob — chicken-and-egg avoidance).

10. **No `process.cwd()` regression in core** —
    `grep -rn 'process\.cwd()' packages/core/src/` returns zero matches
    (continues to hold; the NQ-7 deletion removes the last call, which
    was for the cross-check only).

11. **No `process.cwd()` introduction in coding** —
    `grep -rn 'process\.cwd()' packages/coding/src/` returns zero matches.
    The new `ctx.workingDir` plumbing replaces all structural reliance on
    `process.cwd()`; tools must not consult process state directly.

12. **CONTEXT-MAP.md R1 updated** — three concrete edits per OQ-5:
    (a) **Item 3 flipped** — `grep -n 'Implicitly consumed' CONTEXT-MAP.md`
        returns zero matches; `grep -n 'Explicitly received' CONTEXT-MAP.md`
        returns at least one match inside the R1 section. Sub-bullets
        cite `cwd: ctx.workingDir` and `resolve(ctx.workingDir, …)`,
        not the pre-PR `process.cwd()` defaults.
    (b) `grep -n 'destination shape' CONTEXT-MAP.md` returns zero
        matches (replaced by past-tense / landed-state language such
        as "landed shape" / "eliminated the structural binding").
    (c) `grep -n 'NQ-7' CONTEXT-MAP.md` returns zero matches inside
        the R1 entry (the assertion citation is removed);
        `grep -n 'Structural typing' CONTEXT-MAP.md` returns at least
        one match inside R1 — the verbatim one-sentence note
        documenting how `core ↛ coding` is preserved via the
        duck-typed shape per NQ-C.
    Manual review confirms R1 reads coherently as a landed glossary
    entry; the resolution ID `R1` is reused, not renumbered.

13. **CLAUDE.md "NQ-7 concession" section** — flagged as a follow-up
    cleanup, NOT in this PR. The section names this refactor as the
    retirement trigger; once this PR lands, a follow-up PR removes the
    section. Not gating this PR's merge; documented in this spec's
    `## Non-goals` for clarity.

</verification_loop>

<default_follow_through_policy>

When implementing this refactor, the CODE-phase agent will surface
plausibly-unresolved questions. The orchestrator's posture for each:

1. **If the agent surfaces a "where should ToolContext live?" question
   mid-implementation** — that is OQ-1, resolved below. Direct it to
   `packages/coding/src/context.ts`. Do not entertain a `core/types.ts`
   alternative — it introduces a `core → coding` import that this PR
   explicitly does not adopt (NQ-C).

2. **If the agent surfaces a "should workingDir be a branded type?"
   question** — that is OQ-2, resolved below as NO. The field stays
   `string`. Branding is premature elaboration.

3. **If the agent surfaces a "should the new smoke be stub-only or
   real-executeTool?" question** — that is OQ-4, resolved as "stub
   mandatory, real-executeTool strongly recommended." If
   real-executeTool requires cross-platform path-handling shims
   (platform-specific behavior, flaky assertions, symlink resolution
   quirks), the agent SHALL: (a) surface the shim cost to the
   operator in the PR description or session notes, (b) default to
   shipping stub-only + filing a follow-up issue for the
   real-executeTool path, (c) NOT block the PR on this resolution.
   The stub assertion alone is sufficient acceptance for this PR;
   the real-executeTool path is a separate, deferrable improvement.
   "Escalate" here means **ship-with-follow-up**, not
   pause-pending-operator. See OQ-4's "Action sequence" for the full
   three-step protocol.

4. **If the agent finds the CLI requires non-trivial edits** —
   `packages/cli/src/main.ts` is allowed to be modified, but only
   minimally and only if tsc surfaces a structural-typing mismatch at
   the `RunOptions` construction site (line 114–122). The first line of
   action is to *re-read* the structural-typing claim in this spec
   (`core ↛ coding`, `RunOptions.executeTool: (n, a, ctx: {workingDir: string}) => Promise<string>`,
   coding's `executeTool: (n, a, ctx: ToolContext) => Promise<string>`)
   and confirm via tsc that the two are structurally compatible. They
   should be. If they are not, the agent escalates with the exact tsc
   error before adding code to bridge them.

5. **If the agent surfaces a "should we touch CONTEXT-MAP.md R1?"
   question** — that is OQ-5, resolved YES. Update R1 inline in this
   PR per ADR-014 §52.

6. **If the agent finds the `Deliverable-tracking check` step's grep
   glob does not currently match `specs/issue-*.md`** — that is OQ-6,
   resolved YES (widen the glob). The line to widen is ci.yml:70.

7. **If the agent surfaces ANY OTHER OQ during implementation** —
   escalate to the operator. The architect has not pre-resolved it.
   Do not invent a resolution; do not silently choose one path over
   another for a load-bearing decision. The pattern is: surface, ask,
   wait for resolution, write the resolution into the PR body alongside
   the spec resolutions (per the spec-resolution convention).

</default_follow_through_policy>

<action_safety>

The CODE-phase agent MUST NOT:

1. **Relax [ADR-002](adrs/ADR-002-tool-surface-and-security-posture.md)**.
   ToolContext is NOT a security boundary. Do not add a cwd guard, a path
   allowlist, a `realpath` check, a "is `args.path` inside `ctx.workingDir`?"
   assertion, or any flavor of sandboxing. Tools accept any path/command;
   `workingDir` is the resolution base only. The four base tools remain
   four base tools, with no behavioral guards beyond what they have today.
   Per CLAUDE.md "Hard 'don't's": "Adding `bash` allowlists, cwd guards,
   or path filters (contradicts ADR-002)."

2. **Violate the dependency direction** in either direction.
   `core ↛ coding` (the load-bearing edge per
   [ADR-001](adrs/ADR-001-minimal-core-and-package-boundaries.md)) is
   preserved by using structural typing in `RunOptions.executeTool`. Do
   not add `import type { ToolContext } from "@mirepoix/coding"` to
   `packages/core/src/loop.ts`. Symmetric: do not add
   `@mirepoix/core` as a `@mirepoix/coding` dependency (neither runtime
   nor type-only). The coding package's `package.json` has zero
   dependencies today; that stays.

3. **Modify the four-tool wire schemas** at `packages/coding/src/tools.ts`.
   The OpenAI function-call definitions for `bash`, `read`, `write`,
   `edit` are byte-equivalent before and after this PR. The `bash`
   description string ("Run a shell command in the working directory.")
   is correct as-is — do not rephrase it. Only `bash.ts` and `execute.ts`
   implementation files change. Per NQ-F.

4. **Add a runtime export for `ToolContext`**. The export at
   `packages/coding/src/index.ts` is `export type { ToolContext } …` —
   the `type` keyword is load-bearing. A runtime export (`export { … }`)
   would change the coding-package surface-smoke expected-keys array,
   and the smoke would fail at ci.yml:43. Use `export type { … }`.

5. **Comment out the NQ-7 assertion or its negative smoke**. Both are
   **deleted**. The negative smoke file (`loop-workdir-assertion.ts`)
   is removed from the worktree; the CI step (`ci.yml:49-50`) is removed
   from the workflow file. Per NQ-E. The semantics are: this refactor
   IS the retirement trigger; "commented out" leaves load-bearing dead
   code that future readers will second-guess.

6. **Use any third-party dependency for path handling**. Stay on Node's
   `path.resolve` + `path.dirname`. The diff is small enough that
   inventing helpers ("hallucinated `./utils`" per CLAUDE.md's sub-phase
   B caveat) is the larger risk; do not create files that are not in
   the Deliverables list below.

7. **Skip the `## PR body` section** when handing off to GIT phase. The
   PR body shape specified in `## PR body` below is the resolved
   contract per the spec-resolution convention (CLAUDE.md / commit
   `1a83a67`). Copy it verbatim into the merge commit.

8. **Dispatch Codex during SPEC or PLAN phases**. Per CLAUDE.md hard-
   don'ts, Codex enters at CODE (retry-exhaust) and REVIEW (default-on)
   only. This spec is a SPEC-phase artifact; Codex is not consulted on
   its authorship.

</action_safety>

## Deliverables

Files this PR commits to the repository tree:

- `specs/issue-14-toolcontext.md`
- `packages/coding/src/context.ts`
- `packages/coding/src/index.ts`
- `packages/coding/src/bash.ts`
- `packages/coding/src/execute.ts`
- `packages/core/src/loop.ts`
- `packages/core/type-smoke/loop-end-to-end.ts`
- `packages/core/type-smoke/loop-toolcontext.ts`
- `.github/workflows/ci.yml`
- `CONTEXT-MAP.md`

Files this PR removes from the repository tree are listed under the
**`## Files deleted`** H2 below, not under `## Deliverables` —
`scripts/check-deliverables.sh` parses every `- \`path\`` bullet between
the `## Deliverables` heading and the next `## ` heading and runs
`git ls-files --error-unmatch` on each; deleted files don't satisfy
that check. Listing deletions under a separate H2 keeps them outside
the parser's window. See `specs/sub-phase-d1-spike-retirement.md` for
the same pattern.

If the CODE-phase agent finds that `packages/cli/src/main.ts` requires
a minimal edit to keep `bunx tsc --noEmit -p packages/cli/tsconfig.json`
green (this should not happen given structural typing — see
`<default_follow_through_policy>` item 4), that file is added to
Deliverables at CODE time and noted in the PR body.

## Files deleted

Files this PR removes from the repository tree. Listed under their own
H2 so `scripts/check-deliverables.sh` — which only parses bullets
between `## Deliverables` and the next `## ` heading — does not
attempt to verify their git-tracking. The deletion appears in the PR
diff via `git rm`.

- `packages/core/type-smoke/loop-workdir-assertion.ts` — the negative
  integration smoke for the NQ-7 holding-pattern assertion. The
  assertion is gone; the smoke goes with it. See
  `specs/sub-phase-d1-spike-retirement.md` for the deletion-prose
  pattern this follows.

## Open Questions (OQs)

Resolved inline per the spec-resolution convention. The architect's
resolutions are load-bearing for the CODE-phase agent; surfacing a new
resolution mid-implementation requires escalation.

- **OQ-1 (Where does `ToolContext` live?)** → **Resolved:
  `packages/coding/src/context.ts`**, with `export type { ToolContext }`
  re-exported from `packages/coding/src/index.ts`. Core uses **structural
  typing** in `RunOptions.executeTool`'s third-parameter type, so the
  dependency direction `core ↛ coding` is preserved without a new
  package edge.
  *Rejected alternative:* defining `ToolContext` in `@mirepoix/core` and
  importing into `@mirepoix/coding`. Reason: introduces a `coding → core`
  edge that does not exist today (`packages/coding/package.json` has
  zero dependencies). A one-field interface does not justify a new
  package edge when structural typing is sufficient.

- **OQ-2 (Should `workingDir` be a branded type?)** → **Resolved: NO.**
  Stays `string`. A branded type (`type AbsolutePath = string & { __brand: "AbsolutePath" }`)
  would be premature elaboration: the discipline is enforced by the
  CLI's `process.chdir(target)` + the `resolve()` call producing an
  absolute path, not at the type system. If a future refactor adds
  branded paths, that is its own ADR conversation.

- **OQ-3 (Filename for the new positive smoke?)** → **Resolved:
  `packages/core/type-smoke/loop-toolcontext.ts`**. Matches the
  `loop-*` prefix convention of the four existing core type-smokes
  (`loop-end-to-end.ts`, `loop-workdir-assertion.ts` — to be deleted,
  plus the bus and log smokes).

- **OQ-4 (Does the new smoke exercise the real `executeTool` or stub
  only?)** → **Resolved: stub mandatory, real-executeTool strongly
  recommended.** The stub assertion proves the loop threads `ctx` from
  `options.workingDir` to `executeTool`'s third parameter. The
  real-executeTool path (cross-package: imports `executeTool` from
  `@mirepoix/coding`, creates a temp dir via `fs.mkdtempSync`, drives
  bash with `pwd` and read with a relative path) proves the tool
  implementations actually consume `ctx.workingDir` — closing the
  full structural-binding loop.

  **Action sequence if real-executeTool requires cross-platform
  path-handling shims** (e.g., macOS `/var` vs `/private/var` symlink
  resolution, Windows path-separator handling, or any other
  platform-specific shim work). The CODE-phase agent SHALL:

  (a) **Surface the shim cost to the operator** in the PR description
      or session notes — name the specific shim work that would be
      required and the assertion it would prove.
  (b) **Default to shipping stub-only + filing a follow-up issue** for
      the real-executeTool path. The follow-up issue title: "Real-
      executeTool smoke for ToolContext (Issue #14 follow-up)." Body
      captures the shim-cost observation and what the deferred
      assertion would prove.
  (c) **NOT block the PR** on this resolution. The PR ships with the
      stub-only smoke as the binding deliverable.

  The stub assertion alone is sufficient acceptance for this PR; the
  real-executeTool path is a separate, deferrable improvement.
  "Escalate" in this context means **ship-with-follow-up**, not
  pause-pending-operator nor block-PR. The agent does not invent
  cross-platform shims and does not gate the PR on a flaky assertion.

- **OQ-5 (Update `CONTEXT-MAP.md` R1 inline in this PR?)** →
  **Resolved: YES** with three concrete edits (full directives in
  `<grounding_rules>` Surface (docs) above):
  (a) **Item 3 of R1 flips** — "implicitly consumed via structural
      binding" (footgun-state framing) becomes "explicitly received
      via `ToolContext` parameter" (landed-state framing). Three
      coincident sites become three explicit-receipt sites; the two
      sub-bullets citing `spawn(...)` without `cwd:` and
      `resolve(args.path)` defaulting to `process.cwd()` are replaced
      with sub-bullets citing the post-PR call sites.
  (b) The final-paragraph "destination shape" phrase becomes past-tense
      "landed shape" / "eliminated the structural binding."
  (c) The NQ-7 assertion-citation sentence is removed. R1 gains the
      verbatim one-sentence note: "Structural typing
      (`ctx: { workingDir: string }`) is how the `core ↛ coding`
      boundary is preserved without forcing a `coding → core` import
      edge — core uses the duck-typed shape, coding owns the concrete
      `ToolContext` definition (NQ-C)."
  Per [ADR-014 §52](adrs/ADR-014-domain-driven-design-adoption.md)
  inline-during-decision discipline. The resolution ID `R1` is reused;
  no new tag.

- **OQ-6 (Widen the CI deliverable-tracking glob to include
  `specs/issue-*.md`?)** → **Resolved: YES.** Without it, the
  `Deliverable-tracking check` step at ci.yml lines 63–79 won't pick
  up this spec (the glob today is `specs/sub-phase-*.md specs/harness-*.md`).
  Widening to `specs/sub-phase-*.md specs/harness-*.md specs/issue-*.md`
  is a one-line edit and aligns the convention with the new spec
  naming family (issue-driven specs that aren't sub-phases).

## Negative Questions (NQs)

Locked decisions in negative-question form. The CODE-phase agent treats
each as a binding "do not" that requires a superseding ADR or
architect-issued spec amendment to relax.

- **NQ-A (ToolContext is NOT a security boundary).** Tools STILL accept
  any path/command per [ADR-002](adrs/ADR-002-tool-surface-and-security-posture.md).
  No allowlists, no cwd guards, no `realpath` containment checks, no
  permission dialogs. `ctx.workingDir` is a default resolution base, not
  a sandbox. If the model says `args.path: "/etc/passwd"`, the tool
  reads `/etc/passwd` — same as today. The refactor's posture is
  structural-correctness, not security.

- **NQ-B (ToolContext does NOT replace `RunOptions.workingDir`).**
  `RunOptions` still carries `workingDir: string` as a required field;
  the type-level negative smoke at
  `packages/cli/type-smoke/run-options-missing-wd.ts` continues to fail
  tsc and continues to be the success signal. ToolContext is constructed
  *from* `options.workingDir` once inside `run()`, before the toolCalls
  loop. After this PR, divergence between `process.cwd()` and
  `ctx.workingDir` is *structurally allowed* (no assertion enforces
  coincidence) — the CLI's `process.chdir` stays for the cosmetic
  bootstrap line and the operator's mental model, but tools no longer
  consult `process.cwd()` for value-derivation. The CLI's chdir is now
  vestigial-but-harmless; removing it is out of scope for this PR.

- **NQ-C (Core does NOT import `ToolContext` from coding).** The
  dependency direction is preserved via structural typing:
  `RunOptions.executeTool: (name, args, ctx: { workingDir: string }) => Promise<string>`.
  TypeScript's structural compatibility makes `(name, args, ctx: ToolContext) => Promise<string>`
  assignable, so the CLI's `executeTool: executeTool` assignment at
  `packages/cli/src/main.ts:119` compiles without further edits. The
  reverse — adding `@mirepoix/core` as a dependency of `@mirepoix/coding`
  to share the type — is also rejected. A one-field interface does not
  justify a new package edge.

- **NQ-D (`runBash` and `executeTool` signature changes are BREAKING
  for any external consumer, and no compat shim is added).** Per
  [ADR-001](adrs/ADR-001-minimal-core-and-package-boundaries.md)'s pre-1.0
  posture, packages are not stability surfaces yet. There are no
  external consumers today: `runBash` is intentionally not re-exported
  from `@mirepoix/coding`'s `index.ts` (see the file header at
  `packages/coding/src/bash.ts:1-5`); `executeTool` is consumed only by
  `@mirepoix/cli`'s `main.ts`. No deprecation period, no overload, no
  default-parameter trick (`ctx?: ToolContext`). The signature change
  is the break.

- **NQ-E (The NQ-7 holding-pattern assertion and its negative smoke are
  DELETED, not commented out).** The `if (options.workingDir !== process.cwd()) throw …`
  block at `packages/core/src/loop.ts:84-89`, the surrounding
  documentation comment at lines 70–83, the header-comment "One
  transitional exception" paragraph at lines 17–21, the negative smoke
  file at `packages/core/type-smoke/loop-workdir-assertion.ts`, and the
  CI step at `.github/workflows/ci.yml:49-50` — all five surfaces go
  to zero matches via deletion. No `// TODO: remove when …` artifacts;
  no skipped-but-present CI step. The refactor IS the trigger; leaving
  scaffolding behind misrepresents the landed state.

- **NQ-F (The four-tool wire schemas in `tools.ts` are UNCHANGED).**
  The OpenAI function-call definitions for `bash`, `read`, `write`,
  `edit` at `packages/coding/src/tools.ts:6-65` stay byte-equivalent.
  ToolContext is an *implementation-side* aggregate; it does not appear
  in the function-call schemas the model sees, and it does not appear
  on the JSONL wire. The model still receives `{ name: "bash", arguments: { command: "…" } }`
  and `{ name: "read", arguments: { path: "…" } }` exactly as before.

- **NQ-G (The `bash` tool description string is correct and unchanged).**
  `tools.ts:11-12` says "Run a shell command in the working directory.
  Returns stdout, stderr, and exit code." — this was *already* the
  correct semantic: the working directory of the harness (i.e., the
  value the harness has bound to `workingDir`). Pre-refactor that was
  `process.cwd()`; post-refactor that is `ctx.workingDir`. The
  description's referent shifts from process state to ToolContext state
  but the user-visible meaning is identical. **Do not modify this
  string.**

- **NQ-H (The JSONL wire is unchanged).** `MirepoixEvent` arms,
  `session:start.workingDir`, `tool:start.args`, `tool:end.resultPreview`,
  schemaVersion — all unchanged. The smoke-acceptance schema at
  `specs/smoke-test-acceptance.md` continues to bind without
  modification. Per ADR-005's reconstructability invariant: a session
  log produced before this PR replays semantically the same as a log
  produced after, modulo no behavioral change visible from outside the
  loop.

- **NQ-I (No new third-party dependencies).** Pure Node + Bun built-ins:
  `node:child_process` (`spawn`), `node:fs` (`readFileSync`, etc.),
  `node:path` (`resolve`, `dirname`). No new packages added to any
  `package.json`. `bun.lock` is **not** modified by this PR (no
  workspace dependency changes either — neither `core` nor `coding`
  takes a new dep on the other).

- **NQ-J (No retroactive ADR superseding).** This PR does not supersede
  any ADR. ADR-014 §40 named `ToolContext` as the future shape; this
  PR delivers that shape. ADR-002's tool-surface posture is unchanged
  (NQ-A above). ADR-001's package boundaries are unchanged (NQ-C
  above). [CONTEXT-MAP.md R1](CONTEXT-MAP.md) is *updated*, not
  superseded — the resolution ID is reused.

## Success criteria

After this PR merges:

1. `packages/coding/src/context.ts` exists and exports
   `interface ToolContext { workingDir: string }`.
2. `packages/coding/src/index.ts` exports the type via
   `export type { ToolContext } from "./context";`. The
   `@mirepoix/coding` runtime-surface CI smoke (ci.yml:41-43)
   continues to print `coding surface OK`.
3. `packages/coding/src/bash.ts` exports
   `async function runBash(command: string, ctx: ToolContext): Promise<string>`,
   passes `{ cwd: ctx.workingDir }` to `spawn(...)`, and consumes the
   `ToolContext` type via type-only import.
4. `packages/coding/src/execute.ts` exports
   `async function executeTool(name, args, ctx: ToolContext): Promise<string>`.
   All three relative-path resolutions (`read`, `write`, `edit`) use
   `resolve(ctx.workingDir, args.path as string)`. The `bash` branch
   passes `ctx` through to `runBash`.
5. `packages/core/src/loop.ts`:
   (a) `RunOptions.executeTool` type signature is
       `(name: string, args: Record<string, unknown>, ctx: { workingDir: string }) => Promise<string>`;
   (b) the NQ-7 assertion block is gone (the `if`-throw at lines 84–89
       AND the documentation comment at lines 70–83);
   (c) the header comment block (lines 17–21) drops the "One transitional
       exception" paragraph;
   (d) before the `for (const tc of toolCalls)` loop, a `toolContext`
       constant is built from `options.workingDir`;
   (e) inside the loop, `options.executeTool(...)` is invoked with the
       third `toolContext` argument.
6. `packages/core/type-smoke/loop-end-to-end.ts` continues to print
   `loop-end-to-end OK` and exit 0. All five `executeTool` stubs accept
   (and ignore) the new third `ctx` parameter via destructuring or `_ctx`
   naming. `workingDir: process.cwd()` stays on every RunOptions site.
7. `packages/core/type-smoke/loop-workdir-assertion.ts` is deleted from
   the worktree.
8. `packages/core/type-smoke/loop-toolcontext.ts` exists, prints
   `loop-toolcontext OK`, and exits 0 when run via `bun`. The smoke's
   stub-based assertion proves `ctx.workingDir` flows from
   `options.workingDir` through to the third parameter; the optional
   real-executeTool assertion (if landed) proves the tool implementations
   consume `ctx.workingDir` for spawn cwd and path resolution.
9. `.github/workflows/ci.yml`:
   (a) the step at lines 49–50 (`Smoke test — workingDir/cwd divergence
       asserts (issue #14 transitional)`) is deleted;
   (b) a new step running `bun packages/core/type-smoke/loop-toolcontext.ts`
       is added (positioning: after the existing surface smokes, before
       the rehydration acceptance smoke, mirroring the deleted step's
       location);
   (c) the `Deliverable-tracking check` step's `grep -l` glob at line 70
       is widened from `specs/sub-phase-*.md specs/harness-*.md` to
       `specs/sub-phase-*.md specs/harness-*.md specs/issue-*.md`;
   (d) SHA-pinned actions and `permissions: contents: read` are preserved.
10. `CONTEXT-MAP.md` R1 entry reads as a landed-state glossary entry:
    (a) **Item 3 has flipped** — "implicitly consumed via structural
    binding" is replaced by "explicitly received via `ToolContext`
    parameter," with sub-bullets citing post-PR call sites
    (`cwd: ctx.workingDir`, `resolve(ctx.workingDir, …)`);
    (b) the "destination shape" language is past-tense ("landed shape"
    or equivalent);
    (c) the NQ-7 assertion citation sentence is removed and a verbatim
    one-sentence note on structural typing is added ("Structural typing
    (`ctx: { workingDir: string }`) is how the `core ↛ coding` boundary
    is preserved without forcing a `coding → core` import edge — core
    uses the duck-typed shape, coding owns the concrete `ToolContext`
    definition (NQ-C).");
    (d) the resolution ID `R1` is reused, not renumbered.
11. `bunx tsc --noEmit` exits 0 against each of the four `packages/<pkg>/tsconfig.json`.
12. `bunx biome ci .` exits 0.
13. `grep -rn 'process\.cwd()' packages/core/src/` returns zero matches.
14. `grep -rn 'process\.cwd()' packages/coding/src/` returns zero matches.
15. `bash scripts/check-deliverables.sh specs/issue-14-toolcontext.md`
    exits 0 (the spec self-validates against its own Deliverables list).
16. The negative type-smoke at
    `packages/cli/type-smoke/run-options-missing-wd.ts` continues to
    fail tsc under `tsconfig-negative.json` (the CI invocation with
    leading `!` continues to succeed).
17. CI is green on the PR. Specifically: all 14 steps in the current
    workflow (with the one deletion + one addition + one glob-widening)
    pass.
18. The PR body (`## PR body` section below) is copied verbatim into
    the merge commit.

## Non-goals

- **Retiring the CLAUDE.md "NQ-7 concession" section.** That section
  cites this refactor as the retirement trigger; once this PR merges,
  a follow-up PR removes the section text. Doing it in this PR conflates
  two concerns (code refactor + docs cleanup) and risks merge friction.
- **Removing `process.chdir(target)` from
  `packages/cli/src/main.ts:61`.** The chdir stays for the bootstrap
  `[mirepoix] session …` log line and the operator's mental model. After
  this PR, the chdir is vestigial-but-harmless from the tool-routing
  perspective. Removing it is a separate small PR with its own
  reasoning (the operator-visible `pwd` after a CLI run changes if the
  chdir goes away).
- **Refactor 1 (`Message` and `Tool` types, MS-1 / MS-2).** Out of
  scope; that is a separate sub-phase / issue and a larger surface.
- **MS-4 (Session as Aggregate Root).** Out of scope; that is a
  separate sub-phase.
- **Touching `packages/cli/src/main.ts` beyond a minimal type-fix.**
  See `<default_follow_through_policy>` item 4.
- **Introducing `ToolRegistry`** ([ADR-014 §40](adrs/ADR-014-domain-driven-design-adoption.md)
  names ToolContext + ToolRegistry together). ToolRegistry is the
  follow-up to this PR; this PR delivers ToolContext only. The split
  keeps the refactor surface small.
- **Adding a `Distribution` / fifth context** (CONTEXT-MAP.md R17 watch
  list). Triggered by Phase Four bundler shipping, not by this PR.
- **Promoting `workingDir` to a branded type.** See OQ-2.
- **Cross-platform path normalization** for the optional real-executeTool
  smoke assertion. See OQ-4.
- **Codex dispatch during this spec's authoring.** Per CLAUDE.md hard-
  don'ts, Codex enters at CODE (retry-exhaust) and REVIEW (default-on)
  only; SPEC is architect/orchestrator territory.

## Key references

- [GitHub Issue #14](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/14)
  — the precipitating issue.
- [ADR-014](adrs/ADR-014-domain-driven-design-adoption.md) §40 — names
  ToolContext as Refactor 2 / MS-3.
- [ADR-014](adrs/ADR-014-domain-driven-design-adoption.md) §52 — inline
  CONTEXT-MAP.md update discipline.
- [ADR-001](adrs/ADR-001-minimal-core-and-package-boundaries.md) — four
  packages, `<5kloc` core budget, `core ↛ coding` (load-bearing).
- [ADR-002](adrs/ADR-002-tool-surface-and-security-posture.md) — four
  base tools, bash unrestricted, no allowlists, no cwd guards. ToolContext
  does not change this posture.
- [ADR-005](adrs/ADR-005-context-ownership-and-observability.md) — JSONL
  reconstructability invariant. Unchanged by this refactor.
- [CONTEXT-MAP.md R1](CONTEXT-MAP.md) — the `workingDir` invariant
  glossary entry; updated in this PR.
- [CLAUDE.md](CLAUDE.md) — NQ-7 concession section (the
  holding-pattern's documented retirement criterion is exactly this
  refactor landing); deliverables convention; hard-don'ts; XML-block
  output convention for architect notes.
- Commit `781c653` — introduced the NQ-7 holding-pattern assertion +
  the negative integration smoke. This PR retires both.
- Commit `1a83a67` — spec-resolution convention (specs as pre-OQ
  snapshots; PR body as durable resolution record). This spec follows
  that convention.
- `packages/coding/src/{tools,bash,execute,index}.ts` — current
  implementation; the refactor surface.
- `packages/core/src/loop.ts:48,70-89,144-169` — the type signature
  widening, the assertion deletion, and the toolContext construction
  + dispatch sites.
- `packages/cli/src/main.ts:61,114-122` — the (untouched) chdir and the
  (untouched) RunOptions assembly.
- `packages/core/type-smoke/{loop-end-to-end,loop-workdir-assertion}.ts`
  — update (the first) and delete (the second).
- `packages/cli/type-smoke/run-options-missing-wd.ts` — unchanged;
  type-level negative smoke continues to bind.
- `.github/workflows/ci.yml:41-47,49-50,63-79` — surface-smokes (no
  change), the deleted step, the broadened glob.
- `specs/sub-phase-d.md` — predecessor spec; reference for shape and
  length.
- `specs/sub-phase-d1-spike-retirement.md` — reference for the
  deletion-prose pattern (deletions mentioned in prose, not listed in
  `## Deliverables`).
- `specs/harness-deliverable-tracking.md` — the Deliverables H2
  convention this spec satisfies.

## PR body

The text below is the resolved contract per the spec-resolution
convention (CLAUDE.md / commit `1a83a67`). The GIT-phase agent copies
it verbatim into the merge commit body.

```markdown
Closes #14

ADR-014 Refactor 2 (MS-3) — first concrete refactor under the DDD
adoption ADR. `ToolContext` aggregate carries the `workingDir` value
object to each tool at invocation time, replacing the structural
binding to `process.cwd()`.

Retires the NQ-7 holding-pattern assertion in `packages/core/src/loop.ts`
(introduced in commit 781c653). That assertion's retirement criterion
is exactly this refactor landing — the cross-check is gone because the
structural divergence it guarded against is now impossible: tools
receive `ctx.workingDir` directly and do not consult `process.cwd()`.

Updates CONTEXT-MAP.md R1 (the `workingDir` invariant glossary entry)
to past-tense, per ADR-014 §52 inline-during-decision discipline.

This PR body is the resolved contract per the spec-resolution
convention (CLAUDE.md / commit 1a83a67); the disk spec at
`specs/issue-14-toolcontext.md` is the pre-OQ snapshot.
```
