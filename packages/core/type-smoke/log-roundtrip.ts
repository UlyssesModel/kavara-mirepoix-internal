// JSONL log round-trip smoke (FR-007 / ADR-005).
//
// Creates a temp file, wires the logger, emits a few events, reads the file
// back, asserts header + per-event lines parse and carry the right tags.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Bus, createSessionLogger, schemaVersion } from "../src/index";

const dir = mkdtempSync(join(tmpdir(), "mp-core-log-"));
const path = join(dir, "s.jsonl");

const bus = new Bus();
const dispose = createSessionLogger(bus, path);

bus.emit("session:start", {
  id: "x",
  systemPrompt: "p",
  model: "m",
  url: "http://stub",
  workingDir: "/tmp",
});
bus.emit("message:user", { content: "hello" });
bus.emit("session:end", { reason: "model_done", turns: 1 });

dispose();

const raw = readFileSync(path, "utf-8").trim();
const lines = raw.split("\n").map((l) => JSON.parse(l));

if (lines.length !== 4) {
  console.error("line count", lines.length, raw);
  process.exit(1);
}
if (lines[0].schemaVersion !== schemaVersion || lines[0].event !== "session:log-init") {
  console.error("header bad", lines[0]);
  process.exit(1);
}
if (lines[1].event !== "session:start") {
  console.error("ev1", lines[1]);
  process.exit(1);
}
if (lines[2].event !== "message:user" || lines[2].payload.content !== "hello") {
  console.error("ev2", lines[2]);
  process.exit(1);
}
if (lines[3].event !== "session:end" || lines[3].payload.reason !== "model_done") {
  console.error("ev3", lines[3]);
  process.exit(1);
}

// After dispose, emits should no longer write to the file.
bus.emit("message:user", { content: "post-dispose" });
const after = readFileSync(path, "utf-8").trim().split("\n").length;
if (after !== 4) {
  console.error("disposer leak: wrote after dispose", after);
  process.exit(1);
}

console.log("log-roundtrip OK");
