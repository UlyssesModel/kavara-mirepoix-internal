#!/usr/bin/env bash
# check-deliverables.sh — verify every path in a spec's ## Deliverables
# section is git-tracked. See specs/harness-deliverable-tracking.md.
#
# Style: matches scripts/smoke-accept.sh (set -euo pipefail, fail() helper).
# Dependencies: bash 3.2+, grep, git ls-files. No jq, python, node, awk.

set -euo pipefail

SPEC="${1:?usage: check-deliverables.sh <spec.md>}"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

# NQ-5 guard: refuse to run outside a git repository (git ls-files would emit a
# noisy fatal and every path would look MISSING — clearer to bail early).
git rev-parse --git-dir >/dev/null 2>&1 || fail "not a git repository"

[ -f "$SPEC" ] || fail "spec not found: $SPEC"

# Extract the ## Deliverables window: from the heading to the next ^## or EOF.
# Pure bash line walk — bash 3.2 compatible (no mapfile, no readarray).
#
# Code-fence aware: a line starting with ``` toggles FENCE state. We do not
# enter the section on a heading that appears inside a fenced code block (so
# illustrative `## Deliverables` examples inside spec prose don't trip the
# parser), and bullets inside a fence are not collected.
SECTION=""
IN=0
FOUND=0
FENCE=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    '```'*) FENCE=$((1 - FENCE)); ;;
  esac
  if [ "$FENCE" = "1" ]; then
    # Still collect raw text if we're inside the section so the window stays
    # contiguous, but skip heading-detection and bullet-detection (bullets are
    # re-extracted from SECTION below with the same fence-blindness — that's
    # acceptable because fenced bullets inside the section would still be
    # captured. To keep the v1 contract simple, we treat fences only as a
    # guard against false-positive HEADING detection.)
    if [ "$IN" = "1" ]; then
      SECTION="${SECTION}${line}"$'\n'
    fi
    continue
  fi
  if [ "$line" = "## Deliverables" ]; then
    IN=1
    FOUND=1
    continue
  fi
  if [ "$IN" = "1" ]; then
    case "$line" in
      "## "*) IN=0 ;;
      *) SECTION="${SECTION}${line}"$'\n' ;;
    esac
  fi
done < "$SPEC"

[ "$FOUND" = "1" ] || fail "no Deliverables section found"

# "None." sentinel: any line in the section beginning with "None." passes with
# zero path checks. Supports decision-only specs (NQ-3 permissive PASS for
# zero-bullets without sentinel is handled below by the empty-loop path).
if printf '%s' "$SECTION" | grep -q '^None\.'; then
  echo "deliverables: PASS (sentinel)"
  exit 0
fi

# Extract paths from bullets shaped like:  - `path/to/file`
# Only the backticked content is captured; trailing prose after the closing
# backtick is allowed (e.g. "- `foo.ts` (modified — added X)") and ignored.
PATHS=$(printf '%s' "$SECTION" | grep -oE '^- `[^`]+`' | sed 's/^- `//;s/`$//' || true)

MISSING_COUNT=0
N=0
while IFS= read -r p; do
  [ -z "$p" ] && continue
  N=$((N + 1))
  case "$p" in
    *'*'*|*'?'*|*'['*)
      fail "wildcards not allowed in deliverables: $p"
      ;;
  esac
  if ! git ls-files --error-unmatch -- "$p" >/dev/null 2>&1; then
    echo "MISSING: $p" >&2
    MISSING_COUNT=$((MISSING_COUNT + 1))
  fi
done <<EOF
$PATHS
EOF

if [ "$MISSING_COUNT" -gt 0 ]; then
  echo "FAIL: $MISSING_COUNT path(s) not tracked in git" >&2
  exit 1
fi

echo "deliverables: PASS ($N paths)"
exit 0
