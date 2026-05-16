// run — agent tool-calling loop.
//
// Mirrors `phase-zero-spike/mirepoix-spike.ts` lines 288-379. The spike's
// log call sites become bus emits; the spike's stdout/exit calls move out
// to the CLI (sub-phase D owns stdout and exit).
//
// Layering: imports `@mirepoix/ai` for `callProvider` and
// `normalizeAssistantMessage`. Tools and `executeTool` are injected by the
// caller — `@mirepoix/core` does NOT import `@mirepoix/coding`. This is
// the load-bearing edge for ADR-001's package boundaries (NFR-005).
//
// The working directory and system-prompt-file provenance are required
// fields on `RunOptions` (NQ-7 closed in sub-phase D; OQ-4 / FR-005 adds
// the provenance). `core` reads no boundary state for value-derivation;
// the CLI passes both through explicitly.
//
// One transitional exception: `run()` reads `process.cwd()` ONCE at
// session:start to assert `options.workingDir === process.cwd()` —
// cross-check only, not value-derivation. See issue #14
// (ADR-014 Refactor 2: ToolContext plumbing). Removed when tools no
// longer bind to `process.cwd()` at spawn-time.

import {
  type AssistantMessage,
  callProvider,
  normalizeAssistantMessage,
  type ProviderConfig,
} from "@mirepoix/ai";

import type { Session } from "./session";

const DEFAULT_MAX_TURNS = 30;

/** Test seam (NQ-8). Defaults to `callProvider` from `@mirepoix/ai`. */
export type ProviderFn = (
  messages: Array<Record<string, unknown>>,
  tools: unknown[],
  config: ProviderConfig,
) => Promise<AssistantMessage>;

export interface RunOptions {
  session: Session;
  userPrompt: string;
  providerConfig: ProviderConfig;
  /** Opaque to core; passed through to the provider call. */
  tools: unknown[];
  /** Caller-supplied tool dispatcher. Contract: returns the result string. */
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Default 30 (matches spike). */
  maxTurns?: number;
  /** Test seam (NQ-8). The CLI in sub-phase D leaves this unset. */
  provider?: ProviderFn;
  /**
   * Working directory the caller intends the run to observe. Required
   * (NQ-7 closed in sub-phase D / FR-003). The CLI passes its
   * post-chdir working directory; `core` reads no boundary state.
   */
  workingDir: string;
  /**
   * System-prompt provenance for the `session:start` payload (FR-005 / OQ-4).
   * `null` when the default in-package prompt was loaded; absolute path
   * string when the operator supplied `--system-prompt-file=PATH`.
   */
  systemPromptFile: string | null;
}

const TOOL_RESULT_PREVIEW_CHARS = 200;

export async function run(options: RunOptions): Promise<void> {
  // Transitional NQ-7 concession (ADR-014 issue #14, ToolContext plumbing).
  //
  // Tools in `@mirepoix/coding` operate against `process.cwd()` (bash spawns
  // without an explicit cwd; read/write/edit resolve relative paths through
  // process state). The CLI keeps `options.workingDir` and `process.cwd()`
  // coincident by calling `process.chdir` before invoking `run()`. Any other
  // caller (an extension host, MCP frontend, programmatic embedding) that
  // forgets the chdir would silently log `workingDir=X` while tools operate
  // against `cwd=Y`.
  //
  // This assertion reads `process.cwd()` for cross-check ONLY, not for
  // value-derivation — the load-bearing field remains `options.workingDir`.
  // It gets removed when issue #14 lands `ToolContext` plumbing through
  // `executeTool` (tools no longer depend on `process.cwd()`).
  if (options.workingDir !== process.cwd()) {
    throw new Error(
      `workingDir/process.cwd() divergence — see ADR-014 issue #14. ` +
        `options.workingDir=${options.workingDir}; process.cwd()=${process.cwd()}`,
    );
  }

  const { session, providerConfig, tools, userPrompt } = options;
  const provider: ProviderFn = options.provider ?? callProvider;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const { bus, messages } = session;

  bus.emit("session:start", {
    id: session.id,
    systemPrompt: session.systemPrompt,
    systemPromptFile: options.systemPromptFile,
    model: providerConfig.model,
    url: providerConfig.url,
    workingDir: options.workingDir,
  });

  const userMessage = { role: "user", content: userPrompt };
  messages.push(userMessage);
  bus.emit("message:user", { content: userPrompt });

  for (let turn = 0; turn < maxTurns; turn++) {
    session.turn = turn;
    bus.emit("provider:request", { turn, messagesCount: messages.length });

    let msg: AssistantMessage;
    try {
      msg = await provider(messages, tools, providerConfig);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      bus.emit("provider:error", { turn, error });
      throw error;
    }

    const { content, toolCalls, rehydrated } = normalizeAssistantMessage(msg, turn);

    bus.emit("provider:response", {
      turn,
      message: msg,
      rehydrated,
      rehydratedToolCalls: rehydrated ? toolCalls : undefined,
    });

    const assistantMessage: Record<string, unknown> = {
      role: "assistant",
      content,
      ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
    messages.push(assistantMessage);
    bus.emit("message:assistant", {
      role: "assistant",
      content,
      ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });

    if (toolCalls && toolCalls.length > 0) {
      for (const tc of toolCalls) {
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        bus.emit("tool:start", { name: tc.function.name, args, callId: tc.id });
        let result: string;
        try {
          result = await options.executeTool(tc.function.name, args);
          bus.emit("tool:end", {
            name: tc.function.name,
            callId: tc.id,
            resultPreview: result.slice(0, TOOL_RESULT_PREVIEW_CHARS),
            resultLength: result.length,
          });
        } catch (err) {
          // NQ-9: executeTool's contract is to return error strings; the
          // throw arm exists because the loop accepts an injected dispatcher
          // whose contract we cannot enforce at compile time.
          const error = err instanceof Error ? err : new Error(String(err));
          result = `error: ${error.message}`;
          bus.emit("tool:error", {
            name: tc.function.name,
            callId: tc.id,
            error,
          });
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
      continue;
    }

    bus.emit("session:end", { reason: "model_done", turns: turn + 1 });
    return;
  }

  bus.emit("session:end", { reason: "max_turns", turns: maxTurns });
}
