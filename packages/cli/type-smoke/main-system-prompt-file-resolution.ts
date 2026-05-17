// Issue #16: --system-prompt-file relative paths must resolve against the
// invocation directory, not the --cwd target. This restores phase-zero-spike
// parity (the spike loaded the prompt BEFORE chdir; main() drifted to load it
// AFTER, silently changing the binding).
//
// Strategy: place a prompt fixture only in the invocation dir, point
// OLLAMA_URL at a refused loopback port so run() fails fast immediately
// after session:start is emitted, then inspect the JSONL log and assert
// session:start.payload.systemPromptFile resolved against the invocation
// dir — not against --cwd.

import { mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { main } from "../src/main";

const invocationDir = realpathSync(mkdtempSync(join(tmpdir(), "mirepoix-issue-16-invoke-")));
const cwdTarget = realpathSync(mkdtempSync(join(tmpdir(), "mirepoix-issue-16-cwd-")));
const sessionDir = realpathSync(mkdtempSync(join(tmpdir(), "mirepoix-issue-16-sessions-")));

writeFileSync(join(invocationDir, "prompt.txt"), "test-system-prompt-content");

const originalCwd = process.cwd();
process.chdir(invocationDir);

const originalOllamaUrl = process.env.OLLAMA_URL;
const originalSessionDir = process.env.MIREPOIX_SESSION_DIR;
process.env.OLLAMA_URL = "http://127.0.0.1:1";
process.env.MIREPOIX_SESSION_DIR = sessionDir;

// Silence main()'s stdout/stderr so the smoke output stays focused.
const origLog = console.log;
const origErr = console.error;
console.log = (): void => {};
console.error = (): void => {};

let exitCode: number;
try {
  exitCode = await main([`--cwd=${cwdTarget}`, "--system-prompt-file=./prompt.txt", "test"]);
} finally {
  console.log = origLog;
  console.error = origErr;
  process.chdir(originalCwd);
  if (originalOllamaUrl === undefined) delete process.env.OLLAMA_URL;
  else process.env.OLLAMA_URL = originalOllamaUrl;
  if (originalSessionDir === undefined) delete process.env.MIREPOIX_SESSION_DIR;
  else process.env.MIREPOIX_SESSION_DIR = originalSessionDir;
}

// With the fix: prompt loads from invocationDir, run() proceeds, provider call
// to 127.0.0.1:1 fails → exit 1, JSONL contains session:start.
// Without the fix: chdir to cwdTarget runs first, prompt-load fails with ENOENT
// at cwdTarget/prompt.txt → exit 1, no JSONL file emitted (mkdirSync runs
// after the failed read). The two next assertions disambiguate.

if (exitCode !== 1) {
  console.error(
    `expected exit code 1 (provider should fail to connect at 127.0.0.1:1), got ${exitCode}`,
  );
  process.exit(1);
}

const sessionFiles = readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
if (sessionFiles.length !== 1) {
  console.error(
    `expected exactly one JSONL session log (proves prompt-load succeeded before chdir), got: ${JSON.stringify(sessionFiles)}`,
  );
  process.exit(1);
}

const logPath = join(sessionDir, sessionFiles[0]);
const lines = readFileSync(logPath, "utf-8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

const startLines = lines.filter((l) => l.event === "session:start");
if (startLines.length !== 1) {
  console.error(`expected one session:start event, got ${startLines.length}`);
  process.exit(1);
}

const actualSystemPromptFile = startLines[0].payload.systemPromptFile;
const expectedPromptPath = resolve(invocationDir, "prompt.txt");
const buggyPromptPath = resolve(cwdTarget, "prompt.txt");

if (actualSystemPromptFile !== expectedPromptPath) {
  console.error("systemPromptFile did not resolve against the invocation directory:");
  console.error(`  expected (invocation): ${expectedPromptPath}`);
  console.error(`  actual:                ${actualSystemPromptFile}`);
  console.error(`  buggy (--cwd):         ${buggyPromptPath}`);
  process.exit(1);
}

if (actualSystemPromptFile === buggyPromptPath) {
  console.error(`systemPromptFile resolved against --cwd (bug present): ${actualSystemPromptFile}`);
  process.exit(1);
}

if (startLines[0].payload.systemPrompt !== "test-system-prompt-content") {
  console.error(
    `session:start.systemPrompt content mismatch — expected fixture content, got: ${JSON.stringify(startLines[0].payload.systemPrompt)}`,
  );
  process.exit(1);
}

console.log("main-system-prompt-file-resolution OK");
