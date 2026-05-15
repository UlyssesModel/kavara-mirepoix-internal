# Harness deliverable tracking — the spec/diff drift guard

## Status

Resolves [GitHub Issue #7](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/7). Implementation-level only — no new architectural commitments; the four ADRs touched by Phase One sub-phases remain authoritative.

Standalone, not a Mirepoix sub-phase. The harness improvement teaches us to catch a class of bug recently surfaced by [hotfix PR #6](https://github.com/UlyssesModel/kavara-mirepoix-internal/pull/6) — where a sub-phase declared `scripts/smoke-accept.sh` and `specs/smoke-test-acceptance.md` as deliverables but the script's pass-string drifted from the spec's expected string, undetected until D.1 attempted the gate. Class: "this spec told us file X has property Y, but file X doesn't actually have property Y."

## Context

Sub-phase D's spec (and the hotfix that followed) demonstrated a recurring failure mode: deliverables are referenced by repo-relative path in the spec text, but **nothing in the on-loop pipeline verifies those paths resolve to git-tracked files at GIT phase time**. The on-loop pipeline's discipline (architect → coding → testing → security → docs+build → review → git) catches every other class of drift — surface mismatch, layering violations, snake_case regressions — but not "the script the spec promises doesn't exist at the promised location."

Issue #7 raised four design questions; this spec locks them.

## Goal

Land a small, lossless drift guard:

1. A documented convention: every spec includes a `## Deliverables` section listing the files (repo-relative paths) it commits to produce.
2. An executable check: `scripts/check-deliverables.sh <spec.md>` parses that section, runs `git ls-files --error-unmatch <each-path>`, exits 1 with a `MISSING: <path>` line if any deliverable isn't tracked, exits 0 otherwise.
3. A CI step that runs the check against the latest sub-phase spec on every PR to main.
4. CLAUDE.md update so the architect agent learns to populate the section.

Stretch: backfill `## Deliverables` on `specs/sub-phase-c.md` and `specs/sub-phase-d.md` as worked examples.

Out of scope (separate PR if pursued): modifying the on-loop plugin's GIT phase to call `check-deliverables.sh` before staging. CI catches drift at PR time; in-pipeline catching is stricter but a cross-repo change.

## Concrete work

### Concern 1 → Convention: `## Deliverables` section

Every spec at `specs/<name>.md` MUST include a `## Deliverables` H2 section. The section is a markdown bullet list, one file per line, each item a repo-relative path inside an inline-code span. Example:

```markdown
## Deliverables

Files this sub-phase commits to the repository tree:

- `specs/smoke-test-acceptance.md`
- `scripts/smoke-accept.sh`
- `packages/coding/src/prompts/coding.md`
```

Constraints on the section:

- The H2 heading is exactly `## Deliverables` (case-sensitive, no decorations).
- The bullets immediately follow (a one-paragraph preamble is allowed).
- Paths are relative to repo root, inside backticks.
- Wildcards/globs are NOT allowed. The check is a literal path lookup.
- Generated artifacts (`node_modules/`, `target/`, `dist/`) MUST NOT appear (they aren't tracked).
- If the spec is purely doc-and-decision (no file deliverables), the section reads:
  ```markdown
  ## Deliverables

  None. This spec produces no new tracked files; its outputs are decisions captured in the `## Open questions` resolutions for downstream specs to consume.
  ```

### Concern 2 → `scripts/check-deliverables.sh`

A new executable at `scripts/check-deliverables.sh`. Usage:

```
scripts/check-deliverables.sh <spec.md>
```

Behavior:

- Reads the spec file from argv.
- Parses the `## Deliverables` section: from the H2 heading to the next H2 or EOF.
- For each line matching `^- \`(.+)\`$`, captures the path.
- For each captured path: `git ls-files --error-unmatch -- "$path"`. If any path returns non-zero, prints `MISSING: <path>` to stderr.
- Exits 1 if any path is missing. Exits 0 if all are tracked. Exits 1 with `FAIL: no Deliverables section found` if the section is absent.
- The "None." sentinel form (Concern 1 above) is detected and exits 0 with no checks.
- Pure bash + grep + `git ls-files`. No jq, no Python, no external deps.

Style: matches `scripts/smoke-accept.sh` — `set -euo pipefail`, `fail()` helper that prints `FAIL: <reason>` to stderr.

### Concern 3 → CI workflow step

`.github/workflows/ci.yml` gains one new step at the end (before the now-removed spike-frozen guard's old position):

```yaml
- name: Deliverable-tracking check
  run: |
    LATEST_SPEC=$(ls -t specs/sub-phase-*.md specs/harness-*.md 2>/dev/null | grep -v 'sub-phase-d1-spike-retirement\|smoke-test-acceptance' | head -1)
    [ -n "$LATEST_SPEC" ] && bash scripts/check-deliverables.sh "$LATEST_SPEC"
```

Rationale: only the latest active spec gets checked. Old specs that never had a `## Deliverables` section are exempt (no retroactive enforcement; OQ-3 resolution). The `grep -v` excludes the spec that defines this check itself (so it can land before its `## Deliverables` is itself enforced — which would create a chicken-and-egg).

If `LATEST_SPEC` is empty (no spec files), the step is a no-op.

The check runs on every push to main + every pull_request to main, alongside the existing 13 CI steps. Total expected CI duration after this addition: still well under the 90s NFR-003 target.

### Concern 4 → CLAUDE.md update

Add a `## Deliverables convention` section to CLAUDE.md (or fold into Conventions). Text:

> Every spec at `specs/<name>.md` MUST include a `## Deliverables` H2 section listing the repo-relative paths it commits to producing. The `scripts/check-deliverables.sh` script (run by CI on every PR) verifies each declared path is `git ls-files`-tracked before merge. See [`specs/harness-deliverable-tracking.md`](specs/harness-deliverable-tracking.md). For specs that produce no tracked files (e.g., decision-only specs), declare `None.` with a sentence explaining what kind of output the spec produces instead.

Also add to "Hard 'don't's":

- Land a sub-phase spec without a `## Deliverables` section — CI will reject the PR.

### Concern 5 → Stretch: backfill on C and D

Edit `specs/sub-phase-c.md` and `specs/sub-phase-d.md` to add `## Deliverables` sections. Both are merged; backfill is purely retroactive documentation. The check's CI step `grep -v`s these out, so adding the sections doesn't change CI behavior, but it makes the specs accurate examples for future work.

Sub-phase B and B.1 specs are older and lower-value to backfill. Skip those unless trivial.

## OQ resolutions (locked)

- **OQ-1 (declaration shape)** → **Structured `## Deliverables` markdown section.** Rejected YAML frontmatter (adds a frontmatter dep; nothing else in the repo uses it). Rejected first-class on-loop manifest (cross-repo change; out of scope).

- **OQ-2 (check timing)** → **CI step on every PR.** Rejected end-of-TEST and start-of-GIT in the on-loop pipeline (require modifying the on-loop plugin; cross-repo). CI catches drift at PR time, which is the layer where it matters: drift slips past local commits if the operator force-merges; CI is the canonical gate.

- **OQ-3 (retroactive backfill)** → **Not required for old specs.** The check is opt-in by section presence: specs without `## Deliverables` are exempt. Stretch: backfill C and D as worked examples for future architects. Specs B and B.1 stay un-backfilled (older, less valuable to document at this point).

- **OQ-4 (failure mode)** → **Hard-fail.** Auto-`git add` defeats the purpose of the check (which is to surface that the agent forgot a deliverable). Hard-fail forces the architect/coding agent to declare or stage explicitly. `MISSING: <path>` to stderr + exit 1 is the contract.

## Deliverables

Files this PR commits to the repository tree:

- `specs/harness-deliverable-tracking.md`
- `scripts/check-deliverables.sh`
- `.github/workflows/ci.yml` (modified — adds one step)
- `CLAUDE.md` (modified — convention + hard-don't)
- `specs/sub-phase-c.md` (modified — backfill `## Deliverables`)
- `specs/sub-phase-d.md` (modified — backfill `## Deliverables`)

## Constraints

- **No on-loop plugin changes.** Cross-repo work; out of scope. CI catches drift at PR time.
- **No new third-party deps.** Pure bash. No jq, Python, Node.
- **No code changes under `packages/`.** This is purely tooling + spec + docs.
- **The script must be portable bash.** Works on macOS bash 3.2+ (default on dev Macs) and GNU bash on Linux CI runners.
- **Failure messages go to stderr.** Stdout is reserved for success diagnostics.
- **Section parsing is line-based grep**, not a real markdown parser. Keep the convention strict enough that grep suffices.

## Success criteria

1. `scripts/check-deliverables.sh specs/harness-deliverable-tracking.md` exits 0 — the spec self-validates.
2. `scripts/check-deliverables.sh specs/sub-phase-c.md` exits 0 (after backfill).
3. `scripts/check-deliverables.sh specs/sub-phase-d.md` exits 0 (after backfill).
4. `scripts/check-deliverables.sh` against a synthetic spec with a missing path exits 1 and prints `MISSING: <path>` to stderr.
5. `scripts/check-deliverables.sh` against a synthetic spec with no `## Deliverables` section exits 1 and prints `FAIL: no Deliverables section found`.
6. The CI workflow's new step runs to green on this PR.
7. CI duration stays under 90s total.
8. `bash -n scripts/check-deliverables.sh` (syntax check) exits 0.
9. CLAUDE.md has a `## Deliverables convention` section (or equivalent) and a Hard-don't entry.

## Non-goals

- Modifying the on-loop plugin's pipeline (catching drift earlier, before the GIT phase). Separate PR if pursued.
- Generalizing to non-spec files (e.g., a manifest at `.on-loop/sessions/<id>/manifest.yml`).
- Detecting deliverables that are tracked but **wrong** (this PR's class — drift between spec-promised content and actual content — remains a separate problem; see hotfix #6 for an instance).
- Pre-commit hook installation (operator concern).
- Retroactive backfill on specs B and B.1 (low value relative to noise).
- Renaming to a `tooling/` directory (`scripts/` is the existing convention).

## Open questions

None. The four from Issue #7 are resolved above. New ones surfaced during /on-loop's SPEC phase will be tracked there.

## Key references

- [GitHub Issue #7](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/7) — the precipitating bug
- [PR #6](https://github.com/UlyssesModel/kavara-mirepoix-internal/pull/6) — the hotfix whose post-mortem produced Issue #7
- `scripts/smoke-accept.sh` — style reference for `scripts/check-deliverables.sh`
- `.github/workflows/ci.yml` — current CI shape (13 steps after D.1; this PR adds a 14th)
- `CLAUDE.md` — current conventions / hard-don'ts shape
- `specs/sub-phase-d.md`, `specs/sub-phase-c.md` — backfill targets
