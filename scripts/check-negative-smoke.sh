#!/usr/bin/env bash
# check-negative-smoke.sh — run a negative type-smoke under tsc and assert it
# fails for the RIGHT reason.
#
# A bare `! bun x tsc -p ...` succeeds on ANY non-zero exit, so a smoke that
# stops compiling for an unrelated reason (renamed import, module-resolution
# break, syntax drift) silently masquerades as enforcing the intended
# type invariant. This runner asserts BOTH:
#   1. tsc exited non-zero (the smoke failed compile as designed), AND
#   2. every expected diagnostic pattern (file:TS-code, missing field name,
#      bad tag string, etc.) appears in tsc's actual output.
#
# If either check fails, the runner emits a diagnostic block and exits
# non-zero, which is what CI consumes.
#
# Usage:
#   scripts/check-negative-smoke.sh <tsconfig-negative.json> <pattern> [<pattern>...]
#
# Patterns are regexes consumed by `grep -E`. **At least one pattern is
# required** — calling the runner with only the tsconfig argument is
# explicitly rejected so a future CI author cannot recreate the bare
# `! tsc` false-positive mode by complying with "calls the runner" while
# skipping the diagnostic-anchoring step. Codex adversarial-review on
# PR #30 round 2 (2026-05-20) is the origin of this guard.
#
# Patterns SHOULD be diagnostic-anchored (per the Codex finding on PR
# #30 round 1, 2026-05-20):
#   'unknown-tag\.ts.*TS2345'              file + TS code on the same line
#   "Property 'dispatchId' is missing"     anchored to the specific case
#   'session:start--invalid'                literal bad-tag string the smoke types against
#
# Bare-word patterns (e.g., just `'dispatchId'`) are forbidden because they
# match anywhere in tsc's output, including unrelated expected-type
# renderings where the same name appears as a satisfied property —
# false-positive matching paths.
#
# This convention is load-bearing — bare `! tsc` for negative smokes is
# forbidden per CLAUDE.md (Hard don'ts) following the Codex adversarial-review
# finding on PR #20 (2026-05-20).

set -uo pipefail

tsconfig="${1:-}"
if [[ -z "$tsconfig" ]]; then
  echo "Usage: $0 <tsconfig-negative.json> <pattern> [<pattern>...]" >&2
  exit 2
fi
shift

if [[ ! -f "$tsconfig" ]]; then
  echo "ERROR: tsconfig not found: $tsconfig" >&2
  exit 2
fi

# Reject zero-pattern invocations. A tsconfig-only call would collapse
# the gate to the exit-code-only check (semantically identical to the
# forbidden bare `! tsc` form). Codex adversarial-review on PR #30 round
# 2 (2026-05-20) escalated this from "convention-only guard" to
# "runner-enforced minimum" — conventions decay; structural enforcement
# doesn't.
if [[ $# -eq 0 ]]; then
  echo "ERROR: at least one expected diagnostic pattern is required." >&2
  echo "       A tsconfig-only invocation would collapse to the bare exit-code check" >&2
  echo "       (semantically identical to the forbidden \`! bun x tsc -p ...\` form)." >&2
  echo "       See CLAUDE.md (## Conventions: 'Negative type-smokes must assert exit" >&2
  echo "       code AND diagnostic-anchored content')." >&2
  echo "Usage: $0 <tsconfig-negative.json> <pattern> [<pattern>...]" >&2
  exit 2
fi

# Reject patterns lacking a diagnostic anchor. Bare-word patterns
# (e.g., just `dispatchId`, `workingDir`, `outcome`) match anywhere in
# tsc's output, including unrelated expected-type renderings where the
# same name appears as a *satisfied* property — false-positive matching
# paths. Each pattern must contain at least one syntactic marker that
# constrains its match to a real diagnostic clause:
#
#   \.ts                              — file reference (file-anchored)
#   TS[0-9]+                          — TypeScript error code
#   Property '                        — start of "Property 'X' is missing"
#   missing the following properties  — multi-field missing clause
#   \([0-9]+,[0-9]+\)                 — line:col diagnostic location
#
# Codex adversarial-review on PR #30 round 3 (2026-05-20) escalated this
# from "convention-only guard" (CLAUDE.md Hard don't) to "runner-enforced
# minimum." Same decay class as the zero-pattern guard above: a future CI
# author who skips CLAUDE.md can recreate the bare-word false-positive
# mode unless the runner itself enforces.
ANCHOR_REGEX="(\.ts|TS[0-9]+|Property '|missing the following properties|\([0-9]+,[0-9]+\))"
for pattern in "$@"; do
  if ! grep -qE -- "$ANCHOR_REGEX" <<<"$pattern"; then
    echo "ERROR: pattern '$pattern' lacks a diagnostic anchor." >&2
    echo "       Bare-word patterns match anywhere in tsc output, including unrelated" >&2
    echo "       expected-type renderings where the same name appears as a *satisfied*" >&2
    echo "       property — false-positive matching paths." >&2
    echo "" >&2
    echo "       Each pattern must contain at least one of:" >&2
    echo "         \\.ts                              — file reference" >&2
    echo "         TS[0-9]+                          — TypeScript error code" >&2
    echo "         Property '                        — \"Property 'X' is missing\" clause start" >&2
    echo "         missing the following properties  — multi-field missing clause" >&2
    echo "         \\([0-9]+,[0-9]+\\)                 — line:col diagnostic location" >&2
    echo "" >&2
    echo "       Example fix: anchor the literal to its source file or diagnostic clause." >&2
    echo "         '$pattern'                       → bad-word; rejected" >&2
    echo "         'somefile\\.ts.*$pattern'        → file-anchored; accepted" >&2
    echo "         \"Property '$pattern' is missing\" → diagnostic-anchored; accepted" >&2
    echo "" >&2
    echo "       See CLAUDE.md (## Conventions: diagnostic-anchored content)." >&2
    echo "       Origin: Codex adversarial-review on PR #30 round 3 (2026-05-20)." >&2
    exit 2
  fi
done

# Capture tsc stdout+stderr and exit code without letting set -e trip.
output=$(bun x tsc --noEmit -p "$tsconfig" 2>&1) && tsc_exit=0 || tsc_exit=$?

if [[ "$tsc_exit" -eq 0 ]]; then
  echo "FAIL: $tsconfig" >&2
  echo "  tsc exited 0; negative smoke compiled cleanly when it must fail." >&2
  echo "----- tsc output (likely empty) -----" >&2
  echo "$output" >&2
  exit 1
fi

# Assert each expected diagnostic pattern is present in tsc output.
missing=()
for pattern in "$@"; do
  if ! grep -qE -- "$pattern" <<<"$output"; then
    missing+=("$pattern")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "FAIL: $tsconfig" >&2
  echo "  tsc failed (exit $tsc_exit) but the failure was for the wrong reason." >&2
  echo "  Missing expected diagnostic pattern(s):" >&2
  for p in "${missing[@]}"; do
    echo "    - $p" >&2
  done
  echo "----- actual tsc output -----" >&2
  echo "$output" >&2
  exit 1
fi

echo "PASS: $tsconfig — tsc exited $tsc_exit with all $# expected diagnostic patterns present."
