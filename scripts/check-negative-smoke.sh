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
#   scripts/check-negative-smoke.sh <tsconfig-negative.json> [<pattern>...]
#
# Patterns are regexes consumed by `grep -E`. Examples:
#   'unknown-tag\.ts.*TS2345'    file + TypeScript error code on the same line
#   'dispatchId'                  the specific field whose absence the smoke proves
#   'session:start--invalid'      the literal bad tag the smoke types against
#
# This convention is load-bearing — bare `! tsc` for negative smokes is
# forbidden per CLAUDE.md (Hard don'ts) following the Codex adversarial-review
# finding on PR #20 (2026-05-20).

set -uo pipefail

tsconfig="${1:-}"
if [[ -z "$tsconfig" ]]; then
  echo "Usage: $0 <tsconfig-negative.json> [<expected-diagnostic-pattern>...]" >&2
  exit 2
fi
shift

if [[ ! -f "$tsconfig" ]]; then
  echo "ERROR: tsconfig not found: $tsconfig" >&2
  exit 2
fi

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
