// CLI entry-point body (FR-008). The exported `main()` returns an exit code;
// the top-level invocation in `index.ts` translates it via `process.exit`.
//
// Stage order (binding):
//   1. Parse argv (--system-prompt-file, --cwd, positional → userPrompt)
//   2. Env reads (OLLAMA_URL, MIREPOIX_MODEL, MIREPOIX_SESSION_DIR)
//   3. Load system prompt (file when --system-prompt-file; else DEFAULT_SYSTEM_PROMPT).
//      Resolved BEFORE --cwd chdir so relative --system-prompt-file paths bind
//      to the invocation directory, matching phase-zero-spike behavior (issue #16).
//   4. Resolve --cwd and `process.chdir` (fail-fast on missing path; OQ-6, NQ-D-6)
//   5. Compute session id + log path; mkdirSync the session dir
//   6. new Session({ id, systemPrompt })
//   7. Wire JSONL logger via createSessionLogger
//   8. Wire stdout renderer (provider:response, tool:start/end/error per NQ-D-10)
//   9. Assemble RunOptions (workingDir, systemPromptFile threaded)
//  10. Print bootstrap line to stdout (matches spike line 293)
//  11. await run; on throw → print to stderr, dispose, return 1
//  12. On success → print session log path, dispose, return 0
//
// Boundary concerns (process.env, process.exit, process.chdir, console.*)
// are localized here per NFR-003 / FR-011.

import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { DEFAULT_SYSTEM_PROMPT, executeTool, tools } from "@mirepoix/coding";
import { type RunOptions, Session, createSessionLogger, run } from "@mirepoix/core";

import { parseArgv, USAGE } from "./argv";
import { attachStdoutRenderer } from "./render";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_MODEL = "qwen2.5-coder:32b-instruct";

/**
 * CLI entry point. Returns an exit code; the top-level invocation translates
 * it to `process.exit`. See FR-007 / FR-008.
 *
 * @param argv - optional argv array (default: `process.argv.slice(2)`).
 */
export async function main(argv?: string[]): Promise<number> {
  // 1. Parse argv.
  const args = argv ?? process.argv.slice(2);
  const parsed = parseArgv(args);
  if (parsed.userPrompt.length === 0) {
    console.error(USAGE);
    return 1;
  }

  // 2. Env reads (the only authorized `process.env` reads in the project).
  const OLLAMA_URL = process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
  const MIREPOIX_MODEL = process.env.MIREPOIX_MODEL ?? DEFAULT_MODEL;
  const sessionDirEnv =
    process.env.MIREPOIX_SESSION_DIR ?? `${homedir()}/.local/share/mirepoix/sessions`;

  // 3. Load system prompt (file path if supplied, otherwise the in-package
  // default). Resolved BEFORE --cwd chdir so relative paths bind to the
  // invocation directory, matching phase-zero-spike behavior (issue #16).
  // Provenance string is recorded verbatim from the flag for the
  // `session:start.systemPromptFile` field.
  let systemPrompt: string;
  let systemPromptFileForLog: string | null;
  if (parsed.systemPromptFile !== null) {
    const promptPath = resolve(parsed.systemPromptFile);
    try {
      systemPrompt = readFileSync(promptPath, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[mirepoix] error: cannot read --system-prompt-file: ${promptPath} (${message})`,
      );
      return 1;
    }
    systemPromptFileForLog = promptPath;
  } else {
    systemPrompt = DEFAULT_SYSTEM_PROMPT;
    systemPromptFileForLog = null;
  }

  // 4. Resolve --cwd and chdir (NQ-D-5: chdir BEFORE mkdirSync; NQ-D-6:
  // fail-fast on missing path, no auto-create).
  let resolvedCwd: string;
  if (parsed.workingDir !== null) {
    const target = resolve(parsed.workingDir);
    try {
      process.chdir(target);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mirepoix] error: --cwd path does not exist: ${target} (${message})`);
      return 1;
    }
    resolvedCwd = process.cwd();
  } else {
    resolvedCwd = process.cwd();
  }

  // 5. Session id + log path; mkdir the session dir (matches spike lines 45, 84).
  const sessionId = new Date().toISOString().replace(/[:.]/g, "-");
  const sessionLogPath = `${sessionDirEnv}/${sessionId}.jsonl`;
  mkdirSync(sessionDirEnv, { recursive: true });

  // 6. Build session.
  const session = new Session({ id: sessionId, systemPrompt });

  // 7. Wire JSONL logger.
  const disposeLog = createSessionLogger(session.bus, sessionLogPath);

  // 8. Wire stdout renderer (NQ-D-10 subscription set).
  const renderDisposers = attachStdoutRenderer(session.bus);

  const disposeAll = (): void => {
    disposeLog();
    for (const d of renderDisposers) d();
  };

  // 9. Assemble RunOptions.
  const runOptions: RunOptions = {
    session,
    userPrompt: parsed.userPrompt,
    providerConfig: { url: OLLAMA_URL, model: MIREPOIX_MODEL },
    tools,
    executeTool,
    workingDir: resolvedCwd,
    systemPromptFile: systemPromptFileForLog,
  };

  // 10. Bootstrap line to stdout (matches spike line 293; NQ-D-3).
  console.log(
    `[mirepoix] session ${sessionId} model ${MIREPOIX_MODEL}\n[user] ${parsed.userPrompt}`,
  );

  // 11. Run loop with error containment.
  try {
    await run(runOptions);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mirepoix] error: ${message}`);
    disposeAll();
    return 1;
  }

  // 12. Success: print session log location and clean up.
  console.log(`\n[mirepoix] session log: ${sessionLogPath}`);
  disposeAll();
  return 0;
}
