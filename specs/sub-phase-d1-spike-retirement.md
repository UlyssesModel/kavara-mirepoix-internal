# Sub-phase D.1 — Retire the Phase Zero spike

## Status

Phase: One. Sub-phase: D.1.

**Gated on:** JSONL smoke pass on scotty-gpu against the `multihead_attention.py` fixture, validated by `scripts/smoke-accept.sh` per the schema at `specs/smoke-test-acceptance.md`. No other gate substitutes.

## Context

Phase One's architectural commitment is to split the Phase Zero spike (`phase-zero-spike/mirepoix-spike.ts`) into the four `@mirepoix/*` packages. Sub-phases A through D land the new structure; sub-phase D.1 retires the old one.

The retirement is **irreversible** by construction — `git revert` on a delete is technically possible, but operationally the spike is meant to be gone from the moment D.1 lands. Coupling that destructive act with non-destructive code work (in the same PR as D) was rejected during D's planning because it makes rollback ugly if the smoke fails post-merge. D.1 is therefore the discrete, single-commit, single-purpose PR that authorizes the transition.

## Goal

Delete `phase-zero-spike/` in one commit. Update the three docs that reference it. Mark Phase One complete.

## Acceptance gate (PR-prerequisite)

The D.1 PR description **must include**:

1. **Smoke run evidence** — the session-log filename from scotty-gpu (`~/.local/share/mirepoix/sessions/<id>.jsonl`) and the output of `scripts/smoke-accept.sh <log>` showing `smoke acceptance: PASS`.
2. **Build evidence** — the smoke produced `~/workspaces/target/multihead_attention/Cargo.toml` and at least one `.rs` file, and `bash` ran `cargo check` (whether it passed semantically or surfaced compile errors — what matters is that the bash tool fired and cargo ran).
3. **CLI parity statement** — the new CLI's JSONL trace for the smoke produced camelCase event payloads per NQ-4, and any `tool:error` payloads contain Error name/message/stack per NQ-13 (not `{}`).

If any of those are missing, the smoke has not authorized retirement. The PR cannot land.

## Scope

### Delete

- `phase-zero-spike/` (entire directory — `mirepoix-spike.ts`, `README.md`, anything else under it)

### Update

- `README.md` (root) — remove any reference to `phase-zero-spike/` from the "What this repository is" list and the "Status" table; mark Phase One D.1 complete in the sub-phase tracker
- `CLAUDE.md` (root) — remove the spike from the package-layout diagram in "What you are working on"; remove the "Do not modify `phase-zero-spike/`" line from "Conventions"; remove the spike-related entries from "Hard 'don't's"
- `IMPLEMENTATION-PLAN.md` — mark Phase One complete, note the transition to Phase Two readiness

### Out of scope

Anything else. No code changes to `packages/`, no ADR updates, no spec changes other than D.1 itself.

## Constraints

- **One commit, one PR.** Squash if necessary. The atomicity is the architectural point: retirement is irreversible, so the rollback unit is the whole act.
- **No code changes elsewhere.** Purely destructive (the spike directory) plus three small textual updates.
- **No commit-message editorialization.** Body should be a factual statement of what was deleted + the smoke-pass evidence reference. Not a celebration. (We celebrate offline; the commit log is technical.)
- **No tooling changes.** SHA-pinning, Biome rule changes, CI workflow updates all out of scope.

## Non-goals

- Anything in Phase Two
- Changes to ADRs (no ADR is superseded by retirement — ADR-001 and ADR-003 anticipated this transition)
- Performance benchmarking of the new CLI vs. the spike (the smoke acceptance is sufficient)
- Migrating session logs from spike runs to a new format (those logs are historical and stay as-is)

## Followups (next-session backlog, not blocking D.1)

- Decommission `~/mirepoix-spike.ts` on scotty-gpu (`rm ~/mirepoix-spike.ts` — operational cleanup, not architectural)
- Update `docs/MIREPOIX-SECURE-RUNBOOK.md` references from "the spike" to "the CLI" in Phase 6 (smoke test) and Phase 7 (cleanup) sections
- Begin sub-phase E — the actual self-modification mechanics: using the new CLI on scotty-gpu to drive its own subsequent development, per ADR-003's commitment. Spec the transition explicitly (SHA-pin + permissions hygiene was folded into D, so E focuses purely on the operational shift).

## Smoke-test invocation reference (for the PR description)

After D merges and CI is green, on scotty-gpu:

```sh
cd ~/workspaces
# 1. Run the new CLI against the fixture
mirepoix \
  --system-prompt-file=/home/john_edge_kavara_ai/workspaces/prompts/pytorch-to-rust-prompt.txt \
  --cwd=/home/john_edge_kavara_ai/workspaces \
  "Translate the MultiHeadAttention module from source/multihead_attention.py to a Rust crate at target/multihead_attention/ using candle."

# 2. Capture session log filename
SESSION_LOG=$(ls -t ~/.local/share/mirepoix/sessions/*.jsonl | head -1)
echo "session log: $SESSION_LOG"

# 3. Run the acceptance script
~/workspaces/kavara-mirepoix-internal/scripts/smoke-accept.sh "$SESSION_LOG"
```

The output of step 3 is what goes into the D.1 PR description.
