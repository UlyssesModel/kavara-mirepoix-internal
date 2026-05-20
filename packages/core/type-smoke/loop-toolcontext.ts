// Positive type-smoke for ADR-014 Refactor 2 / MS-3 (Issue #14).
//
// Asserts the agent loop threads `ctx.workingDir` from `options.workingDir`
// through to `executeTool`'s third parameter — proving the value flows via
// the parameter, NOT via `process.cwd()` or any other process-state path.
//
// Two assertions:
//
//   (a) MANDATORY — stub `executeTool`. The smoke supplies a `workingDir`
//       that is provably different from `process.cwd()` and asserts the
//       stub observes `ctx.workingDir === <that path>`. This is the
//       structural-correctness proof.
//
//   (b) STRONGLY RECOMMENDED (OQ-4) — real `@mirepoix/coding` executeTool.
//       From a fresh `mkdtempSync` directory, drives the bash and read
//       tool arms and asserts the implementations actually consume
//       `ctx.workingDir` for spawn cwd / path resolution.
//
// Cross-platform care: macOS resolves `os.tmpdir()` to `/var/folders/...`
// but `pwd` and `fs.realpathSync` see `/private/var/folders/...` — the
// smoke canonicalizes via `realpathSync` so both sides compare apples to
// apples on darwin and linux.

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Relative import across packages — consistent with the other core type-smokes
// using `../src/index`. The `@mirepoix/coding` package is NOT a declared
// dependency of `@mirepoix/core` per ADR-001 / NQ-C; this test-only reach
// across packages does not introduce a runtime package edge (no change to
// `packages/core/package.json`). The structural-typing claim under test is
// that coding's exported `executeTool` (typed as
// `(name, args, ctx: ToolContext) => Promise<string>`) is assignable to
// core's `RunOptions.executeTool` (typed as
// `(name, args, ctx: { workingDir: string }) => Promise<string>`).
import type { AssistantMessage } from "@mirepoix/ai";
import { executeTool } from "../../coding/src/index";
import { Session, run } from "../src/index";

const STUB_DIVERGED_PATH = "/__intentionally_diverged_from_cwd__";

async function ctxThreadsThroughStub(): Promise<void> {
  // The supplied workingDir is provably not process.cwd(); the stub
  // executeTool asserts it observes the same value via ctx.workingDir.
  if (process.cwd() === STUB_DIVERGED_PATH) {
    console.error("test invariant broken: process.cwd() matches sentinel path");
    process.exit(1);
  }

  const session = new Session({ id: "ctx-stub", systemPrompt: "sp" });
  let observedCtxWorkingDir: string | null = null;

  let call = 0;
  await run({
    session,
    userPrompt: "drive a tool call",
    providerConfig: { url: "http://stub", model: "stub" },
    tools: [],
    executeTool: async (_name, _args, ctx) => {
      observedCtxWorkingDir = ctx.workingDir;
      return "ok";
    },
    workingDir: STUB_DIVERGED_PATH,
    systemPromptFile: null,
    provider: async (): Promise<AssistantMessage> => {
      if (call++ === 0) {
        return {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c0",
              function: { name: "bash", arguments: JSON.stringify({ command: "true" }) },
            },
          ],
        };
      }
      return { role: "assistant", content: "done", tool_calls: undefined };
    },
  });

  if (observedCtxWorkingDir !== STUB_DIVERGED_PATH) {
    console.error(
      "stub did not observe ctx.workingDir === options.workingDir:",
      observedCtxWorkingDir,
    );
    process.exit(1);
  }

  if (observedCtxWorkingDir === process.cwd()) {
    console.error(
      "ctx.workingDir matches process.cwd() — divergence proof failed:",
      observedCtxWorkingDir,
    );
    process.exit(1);
  }
}

async function ctxFlowsToRealExecuteTool(): Promise<void> {
  // OQ-4 strongly-recommended assertion: real @mirepoix/coding executeTool
  // consumes ctx.workingDir for spawn cwd (bash) and resolve base (read).
  //
  // Strategy: mkdtemp a fresh directory; drive run() with that as
  // workingDir; assert (b1) `bash pwd` returns the temp dir, and
  // (b2) a relative `read` path resolves against the temp dir.

  const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "mirepoix-toolctx-")));
  const sentinelFile = "hello.txt";
  const sentinelContent = "from-toolcontext-smoke";
  writeFileSync(join(tempDir, sentinelFile), sentinelContent);

  if (tempDir === process.cwd()) {
    console.error("test invariant broken: mkdtemp returned process.cwd()");
    process.exit(1);
  }

  const session = new Session({ id: "ctx-real", systemPrompt: "sp" });

  type ToolEnd = { name: string; resultPreview: string; resultLength: number };
  const toolEnds: ToolEnd[] = [];
  session.bus.on("tool:end", (p) => {
    toolEnds.push({
      name: p.name,
      resultPreview: p.resultPreview,
      resultLength: p.resultLength,
    });
  });

  let call = 0;
  await run({
    session,
    userPrompt: "drive bash and read against ctx.workingDir",
    providerConfig: { url: "http://stub", model: "stub" },
    tools: [],
    // Pass the real @mirepoix/coding executeTool — this is the function
    // whose ctx.workingDir consumption we're proving.
    executeTool,
    workingDir: tempDir,
    systemPromptFile: null,
    provider: async (): Promise<AssistantMessage> => {
      if (call++ === 0) {
        return {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c-bash",
              function: { name: "bash", arguments: JSON.stringify({ command: "pwd" }) },
            },
            {
              id: "c-read",
              function: { name: "read", arguments: JSON.stringify({ path: sentinelFile }) },
            },
          ],
        };
      }
      return { role: "assistant", content: "done", tool_calls: undefined };
    },
  });

  if (toolEnds.length !== 2) {
    console.error("expected exactly 2 tool:end events, got:", toolEnds.length, toolEnds);
    process.exit(1);
  }

  // (b1) bash `pwd` must return tempDir — proves spawn used cwd: ctx.workingDir.
  const bashEnd = toolEnds.find((t) => t.name === "bash");
  if (!bashEnd) {
    console.error("no bash tool:end event observed");
    process.exit(1);
  }
  if (!bashEnd.resultPreview.includes(tempDir)) {
    console.error(
      "bash pwd did not report ctx.workingDir; expected tempDir:",
      tempDir,
      "got resultPreview:",
      bashEnd.resultPreview,
    );
    process.exit(1);
  }
  // Sharper assertion: bash result must NOT include the parent process.cwd()
  // when the two diverge. (mkdtemp under /tmp is necessarily disjoint from
  // any reasonable test runner cwd.) Codifies NQ-7 (the eliminated
  // structural binding) as an enforceable runtime check, not just
  // documentation — a silent regression to process.cwd() binding would
  // manifest as resultPreview containing the cwd marker.
  const cwdMarker = `stdout:\n${process.cwd()}\n`;
  if (bashEnd.resultPreview.includes(cwdMarker)) {
    console.error(
      "loop-toolcontext: bash spawn resolved against process.cwd() instead of ctx.workingDir — NQ-7 regression",
    );
    process.exit(1);
  }

  // (b2) read of a relative path returns the sentinel content — proves
  // resolve() used ctx.workingDir as the base, not process.cwd().
  const readEnd = toolEnds.find((t) => t.name === "read");
  if (!readEnd) {
    console.error("no read tool:end event observed");
    process.exit(1);
  }
  if (readEnd.resultPreview !== sentinelContent) {
    console.error(
      "read of relative path did not resolve against ctx.workingDir; expected:",
      sentinelContent,
      "got:",
      readEnd.resultPreview,
    );
    process.exit(1);
  }
}

async function bashSpawnErrorDoesNotHang(): Promise<void> {
  // Codex adversarial-review [P2] regression guard. After the NQ-7
  // assertion deletion, runBash becomes reachable with an invalid
  // ctx.workingDir (cwd does not exist). Node's spawn fires 'error'
  // (NOT 'close') in that case. Without an 'error' handler on the
  // child process, the promise never resolves → executeTool hangs
  // forever → agent loop stalls on first bash tool call.
  //
  // This arm asserts:
  //   (a) executeTool resolves within a short timeout (proves
  //       runBash's 'error' listener fires and resolves the promise);
  //   (b) the resolved string starts with "error:" (NQ-9 invariant:
  //       executeTool always returns a string, never throws).
  const TIMEOUT_MS = 5000;
  const SENTINEL_BAD_CWD = "/__does_not_exist_mirepoix_toolctx_smoke__";

  const ctx = { workingDir: SENTINEL_BAD_CWD };
  const exec = executeTool("bash", { command: "true" }, ctx);

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<"TIMEOUT">((resolve) => {
    timeoutHandle = setTimeout(() => resolve("TIMEOUT"), TIMEOUT_MS);
  });

  const result = await Promise.race([exec, timeout]);
  // Clear the pending timer so it does not pin the event loop after the
  // spawn-error path resolves (which it does in << 1ms on success).
  if (timeoutHandle !== null) {
    clearTimeout(timeoutHandle);
  }

  if (result === "TIMEOUT") {
    console.error(
      "loop-toolcontext: executeTool('bash', …, { workingDir: <non-existent> }) hung for",
      TIMEOUT_MS,
      "ms — Codex [P2] regression: runBash missing 'error' handler",
    );
    process.exit(1);
  }

  if (typeof result !== "string" || !result.startsWith("error:")) {
    console.error(
      "loop-toolcontext: expected executeTool to return string starting with 'error:' for bad cwd; got:",
      result,
    );
    process.exit(1);
  }
}

await ctxThreadsThroughStub();
await ctxFlowsToRealExecuteTool();
await bashSpawnErrorDoesNotHang();

console.log("loop-toolcontext OK");
