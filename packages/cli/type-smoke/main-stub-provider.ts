// End-to-end CLI type-smoke (FR-013-2).
//
// Drives the same `Session` / `run` / `createSessionLogger` wiring `main()`
// uses, but with a stub provider (no real Ollama) and without touching
// `process.chdir` / `process.env`. Asserts the resulting JSONL trace has the
// expected event sequence and that error payloads round-trip non-empty
// (NQ-13 acceptance via the renderer's `tool:error` path).
//
// We deliberately assemble `Session`+`run`+`createSessionLogger` directly
// rather than invoking `main()`. `main()`'s argv→env→chdir→mkdirSync chain
// is well-trodden by spike-equivalence; this smoke exercises the bus →
// renderer → logger contract that D adds.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { tools } from "@mirepoix/coding";
import { type AssistantMessage, Session, createSessionLogger, run } from "@mirepoix/core";

import { attachStdoutRenderer } from "../src/render";

const dir = mkdtempSync(join(tmpdir(), "mirepoix-cli-smoke-"));
const logPath = join(dir, "session.jsonl");

const session = new Session({ id: "smoke-1", systemPrompt: "test prompt" });

const disposeLog = createSessionLogger(session.bus, logPath);

// Capture stdout from the renderer so the test does not pollute the smoke
// output and so we can assert the renderer produced the expected lines.
const captured: string[] = [];
const origLog = console.log;
console.log = (...parts: unknown[]): void => {
  captured.push(parts.map((p) => String(p)).join(" "));
};

const renderDisposers = attachStdoutRenderer(session.bus);

let call = 0;
const stubProvider = async (): Promise<AssistantMessage> => {
  if (call++ === 0) {
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "c0",
          function: { name: "bash", arguments: JSON.stringify({ command: "echo ok" }) },
        },
      ],
    };
  }
  return { role: "assistant", content: "all done", tool_calls: undefined };
};

let toolErrorSeen = false;
session.bus.on("tool:error", () => {
  toolErrorSeen = true;
});

// Force one tool to throw so the tool:error path runs and we can validate
// the NQ-13 round-trip below.
const executeTool = async (name: string, _args: Record<string, unknown>): Promise<string> => {
  if (name === "bash") {
    throw new Error("smoke-induced");
  }
  return "unreached";
};

await run({
  session,
  userPrompt: "hello",
  providerConfig: { url: "http://stub", model: "stub-model" },
  tools,
  executeTool,
  workingDir: dir,
  systemPromptFile: null,
  provider: stubProvider,
});

for (const d of renderDisposers) d();
disposeLog();
console.log = origLog;

// 1. Renderer produced the expected lines (FR-009 acceptance shape).
const renderedJoined = captured.join("\n");
if (!renderedJoined.includes("[tool:bash]")) {
  console.error("renderer missing tool:start line:\n", renderedJoined);
  process.exit(1);
}
if (!renderedJoined.includes("[error] smoke-induced")) {
  console.error("renderer missing [error] line:\n", renderedJoined);
  process.exit(1);
}
if (!renderedJoined.includes("[mirepoix] all done")) {
  console.error("renderer missing final assistant content:\n", renderedJoined);
  process.exit(1);
}

// 2. JSONL log shape.
const lines = readFileSync(logPath, "utf-8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));
if (lines.length < 6) {
  console.error("expected several JSONL lines, got", lines.length);
  process.exit(1);
}

// Header.
if (lines[0].event !== "session:log-init" || lines[0].schemaVersion !== "1") {
  console.error("header line bad:", lines[0]);
  process.exit(1);
}

// One session:start with all required FR-005 payload fields.
const startLines = lines.filter((l) => l.event === "session:start");
if (startLines.length !== 1) {
  console.error("expected exactly one session:start, got", startLines.length);
  process.exit(1);
}
const startPayload = startLines[0].payload;
for (const field of ["id", "systemPrompt", "model", "url", "workingDir"]) {
  if (typeof startPayload[field] !== "string" || startPayload[field].length === 0) {
    console.error(`session:start missing or empty ${field}:`, startPayload);
    process.exit(1);
  }
}
if (startPayload.systemPromptFile !== null) {
  console.error("session:start.systemPromptFile should be null (default prompt):", startPayload);
  process.exit(1);
}

// At least one tool round-trip (tool:start + matching tool:error in this run).
const toolStarts = lines.filter((l) => l.event === "tool:start");
const toolErrors = lines.filter((l) => l.event === "tool:error");
if (toolStarts.length < 1 || toolErrors.length < 1) {
  console.error("expected tool:start + tool:error", {
    toolStarts: toolStarts.length,
    toolErrors: toolErrors.length,
  });
  process.exit(1);
}
if (toolStarts[0].payload.callId !== toolErrors[0].payload.callId) {
  console.error("callId mismatch", toolStarts[0].payload, toolErrors[0].payload);
  process.exit(1);
}

// 3. NQ-13 acceptance: tool:error.payload.error round-trips with name/message/stack.
const errPayload = toolErrors[0].payload.error;
if (
  typeof errPayload !== "object" ||
  errPayload === null ||
  errPayload.message !== "smoke-induced" ||
  typeof errPayload.stack !== "string" ||
  errPayload.stack.length === 0 ||
  errPayload.name !== "Error"
) {
  console.error("tool:error payload not Error-shaped:", errPayload);
  process.exit(1);
}

// 4. Exactly one session:end with reason model_done.
const endLines = lines.filter((l) => l.event === "session:end");
if (endLines.length !== 1) {
  console.error("expected one session:end, got", endLines.length);
  process.exit(1);
}
if (endLines[0].payload.reason !== "model_done") {
  console.error("session:end reason wrong:", endLines[0].payload);
  process.exit(1);
}

if (!toolErrorSeen) {
  console.error("tool:error bus subscription not triggered");
  process.exit(1);
}

// Emit the log path for the smoke-script self-test (see FR-018 acceptance).
writeFileSync(join(dir, "logpath.txt"), logPath);

console.log("main-stub-provider OK");
console.log(`smoke-log: ${logPath}`);
