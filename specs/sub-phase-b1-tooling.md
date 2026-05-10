# Sub-phase B.1: Type-checking, lint, and CI tooling

## Status

Phase: One. Sub-phase: B.1 (tooling pause between B and C). Bootstrap mode:
Claude Code via on-loop on Mac.

## Context

Sub-phase B (PR #1, merged) extracted `@mirepoix/{ai,coding}` from the Phase
Zero spike. The testing agent in that pipeline flagged a tooling gap: `tsc
--noEmit` fails on both packages because `@types/node` is not installed and
`fetch`'s DOM-side types are not in the TypeScript `lib`. Sub-phase B's
FR-005 deliberately forbade root-config touches, so the build agent took
"Path B" — defer the tsc gap to a follow-up.

This sub-phase is that follow-up. It also lands the smallest amount of CI/
lint scaffolding the project needs to keep regressions from creeping in as
sub-phases C, D, and E land. We do not boil the ocean: no Makefile, no
pre-commit hooks, no test framework, no CI matrix. One workflow, one linter,
one type-checker.

## Goal

Make `tsc --noEmit` pass for both extracted packages, install Biome as the
single lint+format tool, and add one GitHub Actions workflow that runs the
existing smoke tests on every PR. Keep the diff small and obvious.

## Concrete work

### 1. Type-checking unblock

- Add `@types/node` (latest v22) to root `package.json` `devDependencies`.
- Adjust root `tsconfig.json` so that `tsc --noEmit -p packages/ai/tsconfig.json`
  and `tsc --noEmit -p packages/coding/tsconfig.json` pass with the existing
  source. Minimal change required: `@types/node` v22 ships
  `globalThis.fetch`/`Response`/`Headers` declarations, so adding it as a
  dep should be sufficient with `"types": ["node"]` in compilerOptions or
  no change at all (auto-inclusion). Add `"DOM"` to `lib` only if necessary
  to compile.
- Decision rule: prefer the smallest delta to root `tsconfig.json` that
  makes both packages typecheck. Document the chosen path in build.md.
- Do NOT add `tsc` as a direct dep — invoke via `bun x tsc` (Bun fetches
  `typescript` on demand) or add `typescript` to root devDeps (preferred
  for reproducibility). Pick one; document the choice.

### 2. Biome (lint + format)

- Add `@biomejs/biome` (latest stable) to root `devDependencies`.
- Add `biome.json` at the repo root with:
  - `extends`: Biome's recommended ruleset (`"recommended": true` under
    `linter`).
  - Line width 100 (matches the in-repo style in the spike and ADRs).
  - Indent: 2 spaces.
  - Apply to `**/*.{ts,js,json}` only; ignore `phase-zero-spike/` (frozen),
    `node_modules/`, `dist/`, `.on-loop/`, `.claude/`, `**/*.md`.
- If Biome's recommended rules flag the existing code, fix the violations
  with `biome lint --apply` (auto-fix). If a rule is not auto-fixable and
  the violation is style-only, disable that rule project-wide rather than
  rewriting code. Document any disabled rule in `biome.json` with a
  comment-style key (Biome supports JSON5-ish `//` keys via `$schema`'s
  permissiveness — verify; if not, leave a note in build.md).
- Forbidden: re-formatting `phase-zero-spike/mirepoix-spike.ts`. The spike
  is frozen until sub-phase D. Biome must ignore that file.

### 3. CI workflow

- Add `.github/workflows/ci.yml` with one job, single OS (`ubuntu-latest`),
  single Bun version (latest via `oven-sh/setup-bun@v2` with no version
  pin, OR pin to `latest` — choose the stabler option).
- Triggers: `push` to `main` and `pull_request` to `main`.
- Steps, in order:
  1. `actions/checkout@v4`
  2. `oven-sh/setup-bun@v2`
  3. `bun install --frozen-lockfile`
  4. `bun x biome ci .` (Biome's CI mode — no fixes, just check)
  5. `bun x tsc --noEmit -p packages/ai/tsconfig.json`
  6. `bun x tsc --noEmit -p packages/coding/tsconfig.json`
  7. Smoke test: `@mirepoix/ai` surface keys (FR-001 from sub-phase B)
  8. Smoke test: `@mirepoix/coding` surface keys (FR-002)
  9. Smoke test: rehydration acceptance fragment (FR-003)
  10. `git diff --exit-code phase-zero-spike/` (spike-frozen guard)
- The smoke commands should be inline `bun -e` one-liners or shell scripts
  in the workflow. Do not introduce a test framework.
- Job name: `ci`. Use a single job, no matrix.

### 4. Lockfile

- Run `bun install` locally to generate `bun.lockb` (binary lockfile).
- Commit `bun.lockb` to the repo. Do NOT commit `node_modules/`.
- Update `.gitignore` if needed to ensure `node_modules/` is ignored
  (already present per current `.gitignore`).

## Constraints

- **Spike frozen.** `phase-zero-spike/mirepoix-spike.ts` MUST NOT be
  modified or re-formatted. Verify with `git diff phase-zero-spike/`
  after the work — must be empty.
- **No changes to packages/{ai,coding}/src/**.* This is a tooling sub-phase;
  source code is sub-phase B's responsibility. The `tsc` errors must be
  fixed via tsconfig/types changes, not by editing the package source.
  Exception: if Biome's auto-fix touches whitespace-only formatting in
  package source, that's acceptable (and should be the only kind of
  source-touch).
- **No new ADRs.** This is implementation-level tooling; the architectural
  commitments are unchanged.
- **No test framework.** Smoke tests stay as `bun -e` one-liners (or `bun
  test` if Bun's built-in test runner becomes the better path — engineer
  decides; document choice).
- **No Makefile, no pre-commit hooks, no Renovate/Dependabot.** Out of
  scope; promote in a later sub-phase if needed.
- **Use Bun, not npm/pnpm/yarn.** The project shebang and runtime is Bun.
  CI uses `oven-sh/setup-bun`.
- **Single CI job.** No matrix, no parallel jobs. We can split later.

## Success criteria

After the work, all of the following must hold:

1. `bun install` from a fresh clone succeeds and produces `bun.lockb` in
   the repo root.
2. `bun x tsc --noEmit -p packages/ai/tsconfig.json` exits 0.
3. `bun x tsc --noEmit -p packages/coding/tsconfig.json` exits 0.
4. `bun x biome ci .` exits 0.
5. The three smoke tests from sub-phase B (FR-001 surface, FR-002 surface,
   FR-003 rehydration acceptance) pass under Bun directly with no resolver
   shim.
6. `.github/workflows/ci.yml` exists and is syntactically valid (verify
   with `gh workflow view ci` after push, or by parsing the YAML locally).
7. `git diff phase-zero-spike/` is empty.
8. `git status` after the work shows changes only in:
   - `package.json` (root)
   - `bun.lockb` (root, new)
   - `tsconfig.json` (root, possibly)
   - `biome.json` (root, new)
   - `.github/workflows/ci.yml` (new)
   - Any whitespace-only re-formatting in `packages/ai/` or
     `packages/coding/` from Biome auto-fix (should be minimal or none).
   - Any documentation updates in `packages/{ai,coding}/README.md` if the
     doc agent decides to mention the new lint/typecheck commands (within
     scope).

## Non-goals (leave for later sub-phases)

- Typed event bus / agent loop (sub-phase C, `@mirepoix/core`).
- CLI wiring (sub-phase D, `@mirepoix/cli`).
- Modifying or deleting the spike (sub-phase D).
- Test framework (Vitest, Jest, Bun test scaffold) — `bun -e` is enough
  for the existing surface.
- Coverage reporting.
- CI matrix across Node/Bun versions or OSes.
- Pre-commit hooks (husky, lefthook, etc.).
- Makefile.
- Renovate/Dependabot.
- bun audit / supply-chain scanning beyond the lockfile commit.
- ESLint, Prettier, dprint — Biome replaces all three.
- Branch protection / required reviews on main.
- Release tooling, changesets, npm publish.

## Open questions

- **OQ-1: `typescript` as a direct devDep, or invoke via `bun x tsc`?**
  Suggested: add `typescript` (latest 5.x) to root devDeps for
  reproducibility — `bun x tsc` works but the version isn't pinned in the
  lockfile. CI runs deterministically with a pinned version.

- **OQ-2: Biome version policy.**
  Suggested: pin to current latest stable major (`^2.0.0` or whatever's
  current). Biome ships breaking changes occasionally; a caret on the
  major is the right safety level for an internal tool.

- **OQ-3: Should the CI job also run a `git diff` containment check
  beyond just the spike?**
  Suggested: no. The spike-frozen check is the load-bearing one. Other
  containment is per-PR (the reviewer's job).

- **OQ-4: Does the CI workflow get a status badge in the root README?**
  Suggested: defer to the cross-cutting docs pass that the doc agent
  already flagged in sub-phase B as a TODO.

- **OQ-5: What's the right node_modules strategy in the worktree?**
  Sub-phase B's worktree at `.claude/worktrees/sub-phase-b/` doesn't have
  `node_modules`; nothing required it. This sub-phase will need
  `node_modules/` to run `bun x tsc` and `bun x biome` locally during
  development. `.gitignore` already excludes it; just run `bun install`
  in the new worktree.

## Key references

- `specs/sub-phase-b.md` — the sub-phase that flagged this gap (FR-005)
- `.on-loop/sessions/20260510_002707_sub-phase-b/agent-notes/build.md` —
  the build agent's diagnosis of the tsc gap (Path A vs. Path B)
- `.on-loop/sessions/20260510_002707_sub-phase-b/agent-notes/testing.md` —
  T5 finding (the failing tsc test)
- `adrs/ADR-001-minimal-core-and-package-boundaries.md` — packaging contract
- `package.json` (root) — current devDeps (none yet)
- `tsconfig.json` (root) — current TS config (`lib: ["ES2022"]`,
  `moduleResolution: "bundler"`)
