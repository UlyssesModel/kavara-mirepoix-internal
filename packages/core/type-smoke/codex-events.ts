// Positive type-smoke for the seven codex:* arms (FR-4 / sub-phase
// codex-events). Mirrors the mkdtemp + readFileSync + per-line JSON.parse
// pattern from log-roundtrip.ts.
//
// Verifies:
//   (a) each of the 7 new arms emits + round-trips through createSessionLogger,
//   (b) each payload's required fields survive the JSONL serialization,
//   (c) NQ-13 Error round-trip for `codex:rescue-end.error` and
//       `codex:unavailable.error` — error.name / .message / .stack land as
//       non-empty strings, never `{}`.
//
// Retry 1 update: the smoke now exercises the post-review payload shapes —
// full `prompt` / `response` bodies (CONCERN-2), split `sourceVerdict` /
// `gateVerdict` on verdict (CONCERN-1), expanded `outcome` enum on
// rescue-end (CONCERN-3), `command` on operator-direct dispatch
// (MISSING-4), `retryAfterMs` / `attempt` / `maxAttempts` on unavailable
// (MISSING-5), and `tokensIn` / `tokensOut` / `costUsd` / `cacheHit` on
// response (MISSING-6).
//
// On success: prints `codex-events OK` and exits 0. On failure: prints the
// offending line and exits non-zero.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Bus, createSessionLogger, schemaVersion } from "../src/index";

const dir = mkdtempSync(join(tmpdir(), "mp-core-codex-"));
const path = join(dir, "s.jsonl");

const bus = new Bus();
const dispose = createSessionLogger(bus, path);

// 1. codex:dispatch — operator-direct (phase: null) carries `command`.
bus.emit("codex:dispatch", {
  dispatchId: "dispatch-1",
  phase: null,
  reason: "operator-direct /codex:adversarial-review",
  command: "adversarial-review",
});

// 2. codex:request — FULL prompt body per CONCERN-2.
const longPrompt = "x".repeat(800);
bus.emit("codex:request", {
  dispatchId: "dispatch-1",
  model: "gpt-5-codex",
  prompt: longPrompt,
});

// 3. codex:response — FULL response body + usage telemetry (MISSING-6).
const longResponse = "y".repeat(600);
bus.emit("codex:response", {
  dispatchId: "dispatch-1",
  response: longResponse,
  durationMs: 4250,
  tokensIn: 1024,
  tokensOut: 512,
  costUsd: 0.0123,
  cacheHit: false,
});

// 4. codex:verdict — split sourceVerdict / gateVerdict (CONCERN-1).
bus.emit("codex:verdict", {
  dispatchId: "dispatch-1",
  sourceVerdict: "needs-attention",
  gateVerdict: "block",
  body: "Finding: unbounded log size on codex:verdict.body — recommend follow-up sanitize pass.",
});

// 5. codex:rescue-start — full prompt, filesAllowlist captured.
bus.emit("codex:rescue-start", {
  dispatchId: "dispatch-2",
  prompt: "Accumulated feedback from 3 failed Claude CODE attempts: …",
  filesAllowlist: ["packages/core/src/events.ts", "packages/core/src/log.ts"],
});

// 6. codex:rescue-end — Error path (NQ-13 round-trip) + new outcome enum.
const rescueError = new Error("rescue subagent crashed mid-emit");
bus.emit("codex:rescue-end", {
  dispatchId: "dispatch-2",
  outcome: "rescue-error",
  touchedFiles: [],
  durationMs: 12_500,
  error: rescueError,
});

// 7. codex:unavailable — non-error reason (mirepoix-secure venue default).
bus.emit("codex:unavailable", {
  reason: "mirepoix-secure-default",
  details: "Venue policy ADR-013 §4 + commitment 5: deny-all-egress precludes Codex auth.",
});

// 8. codex:unavailable — Error path (NQ-13) + retry/rate-limit shape
//     (MISSING-5).
const unavailableError = new Error("ECONNRESET reaching api.openai.com");
bus.emit("codex:unavailable", {
  reason: "rate-limit",
  details: "Codex returned HTTP 429; honoring Retry-After.",
  error: unavailableError,
  retryAfterMs: 30_000,
  attempt: 2,
  maxAttempts: 5,
});

dispose();

const raw = readFileSync(path, "utf-8").trim();
const lines = raw.split("\n").map((l) => JSON.parse(l));

// Expected: 1 header + 8 emits = 9 lines.
if (lines.length !== 9) {
  console.error("line count", lines.length, raw);
  process.exit(1);
}

if (lines[0].schemaVersion !== schemaVersion || lines[0].event !== "session:log-init") {
  console.error("header bad", lines[0]);
  process.exit(1);
}

// 1. codex:dispatch — operator-direct + command.
{
  const ln = lines[1];
  if (ln.event !== "codex:dispatch") {
    console.error("ev1 tag", ln);
    process.exit(1);
  }
  if (
    ln.payload.dispatchId !== "dispatch-1" ||
    ln.payload.phase !== null ||
    typeof ln.payload.reason !== "string" ||
    ln.payload.command !== "adversarial-review"
  ) {
    console.error("ev1 payload", ln);
    process.exit(1);
  }
}

// 2. codex:request — full prompt body round-trip.
{
  const ln = lines[2];
  if (ln.event !== "codex:request") {
    console.error("ev2 tag", ln);
    process.exit(1);
  }
  if (
    ln.payload.dispatchId !== "dispatch-1" ||
    ln.payload.model !== "gpt-5-codex" ||
    typeof ln.payload.prompt !== "string" ||
    ln.payload.prompt.length !== 800
  ) {
    console.error("ev2 payload", ln);
    process.exit(1);
  }
}

// 3. codex:response — full response body + usage telemetry.
{
  const ln = lines[3];
  if (ln.event !== "codex:response") {
    console.error("ev3 tag", ln);
    process.exit(1);
  }
  if (
    ln.payload.dispatchId !== "dispatch-1" ||
    typeof ln.payload.response !== "string" ||
    ln.payload.response.length !== 600 ||
    ln.payload.durationMs !== 4250 ||
    ln.payload.tokensIn !== 1024 ||
    ln.payload.tokensOut !== 512 ||
    ln.payload.costUsd !== 0.0123 ||
    ln.payload.cacheHit !== false
  ) {
    console.error("ev3 payload", ln);
    process.exit(1);
  }
}

// 4. codex:verdict — split source / gate.
{
  const ln = lines[4];
  if (ln.event !== "codex:verdict") {
    console.error("ev4 tag", ln);
    process.exit(1);
  }
  if (
    ln.payload.dispatchId !== "dispatch-1" ||
    ln.payload.sourceVerdict !== "needs-attention" ||
    ln.payload.gateVerdict !== "block" ||
    typeof ln.payload.body !== "string" ||
    ln.payload.body.length === 0
  ) {
    console.error("ev4 payload", ln);
    process.exit(1);
  }
}

// 5. codex:rescue-start
{
  const ln = lines[5];
  if (ln.event !== "codex:rescue-start") {
    console.error("ev5 tag", ln);
    process.exit(1);
  }
  if (
    ln.payload.dispatchId !== "dispatch-2" ||
    typeof ln.payload.prompt !== "string" ||
    !Array.isArray(ln.payload.filesAllowlist) ||
    ln.payload.filesAllowlist.length !== 2
  ) {
    console.error("ev5 payload", ln);
    process.exit(1);
  }
}

// 6. codex:rescue-end — NQ-13 Error round-trip + expanded outcome enum.
{
  const ln = lines[6];
  if (ln.event !== "codex:rescue-end") {
    console.error("ev6 tag", ln);
    process.exit(1);
  }
  if (
    ln.payload.dispatchId !== "dispatch-2" ||
    ln.payload.outcome !== "rescue-error" ||
    !Array.isArray(ln.payload.touchedFiles) ||
    ln.payload.durationMs !== 12_500
  ) {
    console.error("ev6 payload", ln);
    process.exit(1);
  }
  const err = ln.payload.error;
  if (
    !err ||
    typeof err !== "object" ||
    typeof err.name !== "string" ||
    err.name.length === 0 ||
    typeof err.message !== "string" ||
    err.message !== "rescue subagent crashed mid-emit" ||
    typeof err.stack !== "string" ||
    err.stack.length === 0
  ) {
    console.error("ev6 NQ-13 Error round-trip failed", err);
    process.exit(1);
  }
}

// 7. codex:unavailable — non-error reason; retry fields absent.
{
  const ln = lines[7];
  if (ln.event !== "codex:unavailable") {
    console.error("ev7 tag", ln);
    process.exit(1);
  }
  if (ln.payload.reason !== "mirepoix-secure-default" || typeof ln.payload.details !== "string") {
    console.error("ev7 payload", ln);
    process.exit(1);
  }
  if (ln.payload.error !== undefined) {
    console.error("ev7 unexpected error field", ln);
    process.exit(1);
  }
  if (
    ln.payload.retryAfterMs !== undefined ||
    ln.payload.attempt !== undefined ||
    ln.payload.maxAttempts !== undefined
  ) {
    console.error("ev7 unexpected retry fields", ln);
    process.exit(1);
  }
}

// 8. codex:unavailable — rate-limit with retry shape + Error round-trip.
{
  const ln = lines[8];
  if (ln.event !== "codex:unavailable") {
    console.error("ev8 tag", ln);
    process.exit(1);
  }
  if (ln.payload.reason !== "rate-limit" || typeof ln.payload.details !== "string") {
    console.error("ev8 payload", ln);
    process.exit(1);
  }
  if (
    ln.payload.retryAfterMs !== 30_000 ||
    ln.payload.attempt !== 2 ||
    ln.payload.maxAttempts !== 5
  ) {
    console.error("ev8 retry fields", ln);
    process.exit(1);
  }
  const err = ln.payload.error;
  if (
    !err ||
    typeof err !== "object" ||
    typeof err.name !== "string" ||
    err.name.length === 0 ||
    typeof err.message !== "string" ||
    err.message !== "ECONNRESET reaching api.openai.com" ||
    typeof err.stack !== "string" ||
    err.stack.length === 0
  ) {
    console.error("ev8 NQ-13 Error round-trip failed", err);
    process.exit(1);
  }
}

console.log("codex-events OK");
