#!/usr/bin/env bash
# smoke-accept.sh — JSONL session-log acceptance check (sub-phase D / FR-018).
#
# Pass: exit 0. Fail: exit 1 with `SMOKE FAIL: <why>` to stderr. See
# `specs/smoke-test-acceptance.md` for the binding schema; this script is the
# executable form of that document's pass criteria.
#
# Dependencies: bash, jq, grep.
#
# Field names are camelCase (OQ-1 / NQ-D-1). The forbidden snake_case tokens
# are listed in `FORBIDDEN_SNAKE` below and would indicate a regression.

set -eu

LOG="${1:?usage: smoke-accept.sh <jsonl-path>}"

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. File exists and is non-empty.
[ -s "$LOG" ] || fail "log empty or missing: $LOG"

# 2. Every line is valid JSON.
LINE_NO=0
while IFS= read -r line; do
  LINE_NO=$((LINE_NO + 1))
  [ -z "$line" ] && fail "blank line at $LINE_NO"
  echo "$line" | jq -e . >/dev/null 2>&1 || fail "invalid JSON at line $LINE_NO"
done < "$LOG"

# 3. First line is the synthetic header with schemaVersion "1".
HEAD=$(head -n1 "$LOG")
SCHEMA=$(printf '%s' "$HEAD" | jq -r '.schemaVersion // empty')
HEAD_EVT=$(printf '%s' "$HEAD" | jq -r '.event // empty')
[ "$SCHEMA" = "1" ] || fail "schemaVersion not \"1\" on first line (got: ${SCHEMA:-<missing>})"
[ "$HEAD_EVT" = "session:log-init" ] || fail "first line event is not session:log-init (got: ${HEAD_EVT:-<missing>})"

# 4. Exactly one session:start with all required payload fields.
START_LINE=$(grep '"event":"session:start"' "$LOG" || true)
START_COUNT=$(printf '%s\n' "$START_LINE" | grep -c '"event":"session:start"' || true)
[ "$START_COUNT" = "1" ] || fail "expected exactly one session:start (got: $START_COUNT)"

ID=$(printf '%s' "$START_LINE" | jq -r '.payload.id // empty')
SP=$(printf '%s' "$START_LINE" | jq -r '.payload.systemPrompt // empty')
MODEL=$(printf '%s' "$START_LINE" | jq -r '.payload.model // empty')
URL=$(printf '%s' "$START_LINE" | jq -r '.payload.url // empty')
WD=$(printf '%s' "$START_LINE" | jq -r '.payload.workingDir // empty')
[ -n "$ID" ] || fail "session:start.payload.id missing or empty"
[ -n "$SP" ] || fail "session:start.payload.systemPrompt missing or empty"
[ -n "$MODEL" ] || fail "session:start.payload.model missing or empty"
[ -n "$URL" ] || fail "session:start.payload.url missing or empty"
[ -n "$WD" ] || fail "session:start.payload.workingDir missing or empty"

# systemPromptFile MUST be present as a string or null (key must exist).
SPF_PRESENT=$(printf '%s' "$START_LINE" | jq 'has("payload") and (.payload | has("systemPromptFile"))')
[ "$SPF_PRESENT" = "true" ] || fail "session:start.payload.systemPromptFile key missing"
SPF_TYPE=$(printf '%s' "$START_LINE" | jq -r '.payload.systemPromptFile | type')
[ "$SPF_TYPE" = "string" ] || [ "$SPF_TYPE" = "null" ] || fail "session:start.payload.systemPromptFile must be string or null (got: $SPF_TYPE)"

# 5. Exactly one session:end with valid reason and numeric turns.
END_LINE=$(grep '"event":"session:end"' "$LOG" || true)
END_COUNT=$(printf '%s\n' "$END_LINE" | grep -c '"event":"session:end"' || true)
[ "$END_COUNT" = "1" ] || fail "expected exactly one session:end (got: $END_COUNT)"

REASON=$(printf '%s' "$END_LINE" | jq -r '.payload.reason // empty')
TURNS=$(printf '%s' "$END_LINE" | jq -r '.payload.turns // empty')
case "$REASON" in
  model_done|max_turns) ;;
  *) fail "session:end.payload.reason must be model_done or max_turns (got: ${REASON:-<missing>})" ;;
esac
case "$TURNS" in
  ''|*[!0-9]*) fail "session:end.payload.turns must be a non-negative integer (got: ${TURNS:-<missing>})" ;;
esac

# 6. At least one provider:request and one provider:response.
REQ_COUNT=$(grep -c '"event":"provider:request"' "$LOG" || true)
RESP_COUNT=$(grep -c '"event":"provider:response"' "$LOG" || true)
[ "$REQ_COUNT" -ge 1 ] || fail "expected >=1 provider:request lines (got: $REQ_COUNT)"
[ "$RESP_COUNT" -ge 1 ] || fail "expected >=1 provider:response lines (got: $RESP_COUNT)"

# 7. Tool round-trip integrity. For every tool:start callId, a matching
# tool:end or tool:error must exist.
START_IDS=$(jq -r 'select(.event=="tool:start") | .payload.callId' "$LOG" | sort -u)
END_IDS=$(jq -r 'select(.event=="tool:end" or .event=="tool:error") | .payload.callId' "$LOG" | sort -u)
if [ -n "$START_IDS" ]; then
  for cid in $START_IDS; do
    printf '%s\n' "$END_IDS" | grep -Fxq "$cid" || fail "tool:start callId $cid has no matching tool:end or tool:error"
  done
fi

# 8. NQ-13 / FR-004 — error round-trip non-empty.
ERR_OK=$(jq -r 'select(.event=="tool:error" or .event=="provider:error" or .event=="bus:error") | .payload.error.message // ""' "$LOG")
if [ -n "$ERR_OK" ]; then
  while IFS= read -r m; do
    [ -n "$m" ] || fail "error payload has empty .error.message"
  done <<EOF
$ERR_OK
EOF
fi

# 9. No snake_case keys (OQ-1 / NQ-D-1).
FORBIDDEN_SNAKE='messages_count\|working_dir\|system_prompt_file\|result_preview\|ollama_url\|session_id'
if grep -E "\"($FORBIDDEN_SNAKE)\"" "$LOG" >/dev/null; then
  HIT=$(grep -oE "\"($FORBIDDEN_SNAKE)\"" "$LOG" | sort -u | tr '\n' ',' | sed 's/,$//')
  fail "snake_case payload keys found (regression vs OQ-1 / NQ-D-1): $HIT"
fi

echo "SMOKE PASS"
exit 0
