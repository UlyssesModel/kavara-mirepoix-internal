// @mirepoix/understand — programmatic ACP client.
//
// Thin wrapper around spawning `@mirepoix/acp` as a child process and driving
// it over stdio JSON-RPC. Modeled on `packages/tui/src/index.ts` (the canonical
// reference client) with UI concerns stripped — this is purely the wire layer,
// suitable for embedding inside other Mirepoix packages.
//
// Wire protocol: ACP (protocolVersion 1) over newline-delimited JSON-RPC 2.0.
// Method sequence: initialize → session/new → session/prompt (1..N).
// Streaming notifications (`session/update`) carry `agent_message_chunk`
// (final-message text) and `tool_call` / `tool_call_update` events.
//
// Provider config is server-startup: @mirepoix/acp reads `OLLAMA_URL` and
// `MIREPOIX_MODEL` from its process env once at construction, then bakes them
// into every session it spawns (per packages/acp/src/index.ts:46-52). This
// client passes them at spawn time. To use a different model on a per-call
// basis, spawn a fresh AcpClient (cheap — Bun startup is ~ms).
//
// Lifecycle invariant: every constructed AcpClient must be shutdown() or its
// child process will outlive the caller. Use a try/finally.

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Default acp entry — packages/acp/src/index.ts relative to this file. */
const DEFAULT_ACP_ENTRY = resolve(__dirname, "../../../acp/src/index.ts");

/** Default JSON-RPC call timeout. Generous — LLM prompts can run 60s+. */
const DEFAULT_TIMEOUT_MS = 240_000;

export interface AcpClientOptions {
  /** Path to the @mirepoix/acp entry script. Default: workspace-relative. */
  acpEntry?: string;
  /** Override OLLAMA_URL env (defaults to acp server's `http://127.0.0.1:11434/v1`). */
  ollamaUrl?: string;
  /**
   * Override MIREPOIX_MODEL env. REQUIRED if local Ollama doesn't have the
   * acp server's default (`qwen2.5-coder:32b-instruct`) loaded. Set to
   * `qwen3-coder:30b` on kavara-builder.
   */
  model?: string;
  /** Per-call timeout in ms. */
  timeoutMs?: number;
  /** stderr handler — defaults to silent. The tui prints with color; here we usually want quiet. */
  onStderr?: (chunk: string) => void;
}

/** A single prompt's result: collected agent text + stop reason + tool-call log. */
export interface PromptResult {
  /** Concatenation of every `agent_message_chunk` emitted during this prompt. */
  text: string;
  /** `"end_turn"` on normal completion, `"cancelled"` if aborted. */
  stopReason: string;
  /** Tool calls observed during this prompt (id, title, terminal status). */
  toolCalls: Array<{
    id: string;
    title: string;
    status: "in_progress" | "completed" | "failed" | string;
    summary?: string;
  }>;
}

interface PendingCall {
  resolve: (msg: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Programmatic ACP client. Spawns @mirepoix/acp as a child process and exposes
 * a typed RPC surface over it.
 */
export class AcpClient {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly timeoutMs: number;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();

  /** Per-session collected text and tool-call log. Cleared at session/new. */
  private currentSessionId: string | null = null;
  private currentText = "";
  private currentToolCalls: PromptResult["toolCalls"] = [];

  private initialized = false;
  private shuttingDown = false;
  private exitCode: number | null = null;

  constructor(opts: AcpClientOptions = {}) {
    const entry = opts.acpEntry ?? DEFAULT_ACP_ENTRY;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (opts.ollamaUrl) env.OLLAMA_URL = opts.ollamaUrl;
    if (opts.model) env.MIREPOIX_MODEL = opts.model;

    this.proc = spawn("bun", [entry], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    this.proc.stdout.setEncoding("utf-8");

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => this.handleLine(line));

    const stderrHandler = opts.onStderr;
    if (stderrHandler) {
      this.proc.stderr.on("data", (chunk: Buffer) => stderrHandler(chunk.toString()));
    } else {
      // Drain to prevent stderr buffer fill. Default: silent.
      this.proc.stderr.on("data", () => {});
    }

    this.proc.on("exit", (code) => {
      this.exitCode = code ?? 0;
      // Reject any in-flight RPCs so callers don't hang on a dead subprocess.
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`@mirepoix/acp exited (code=${this.exitCode}) with calls in flight`));
      }
      this.pending.clear();
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Non-JSON line on stdout is a protocol violation; surface via stderr
      // (but never crash — the acp server might log debug there).
      process.stderr.write(`[acp-client] non-json line: ${trimmed.slice(0, 200)}\n`);
      return;
    }
    if (typeof msg.id === "number" && ("result" in msg || "error" in msg)) {
      const handler = this.pending.get(msg.id);
      if (!handler) return;
      this.pending.delete(msg.id);
      clearTimeout(handler.timer);
      if (msg.error) {
        handler.reject(new Error(`acp rpc error: ${JSON.stringify(msg.error)}`));
      } else {
        handler.resolve(msg.result);
      }
      return;
    }
    if (typeof msg.method === "string") {
      this.handleNotification(msg);
    }
  }

  private handleNotification(msg: { method?: string; params?: unknown }): void {
    if (msg.method !== "session/update") return;
    const params = msg.params as
      | { sessionId?: string; update?: Record<string, unknown> }
      | undefined;
    const update = params?.update;
    if (!update || params?.sessionId !== this.currentSessionId) return;

    const kind = update.sessionUpdate as string;
    switch (kind) {
      case "agent_message_chunk": {
        const content = update.content as { type?: string; text?: string } | undefined;
        if (content?.type === "text" && typeof content.text === "string") {
          this.currentText += content.text;
        }
        break;
      }
      case "tool_call": {
        this.currentToolCalls.push({
          id: String(update.toolCallId ?? ""),
          title: String(update.title ?? ""),
          status: "in_progress",
        });
        break;
      }
      case "tool_call_update": {
        const id = String(update.toolCallId ?? "");
        const entry = this.currentToolCalls.find((t) => t.id === id);
        if (entry) {
          entry.status = String(update.status ?? entry.status);
          const content = update.content as Array<{ content?: { text?: string } }> | undefined;
          const text = content?.[0]?.content?.text;
          if (typeof text === "string") entry.summary = text;
        }
        break;
      }
      default:
        // Other update kinds (plan, current_mode_update, etc.) ignored for v0.
        break;
    }
  }

  private call<T>(method: string, params: unknown): Promise<T> {
    if (this.exitCode !== null) {
      return Promise.reject(new Error(`@mirepoix/acp already exited (code=${this.exitCode})`));
    }
    const id = this.nextId++;
    return new Promise<T>((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`Timeout calling acp ${method} (id=${id}, ${this.timeoutMs}ms)`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: (msg) => resolveCall(msg as T),
        reject: rejectCall,
        timer,
      });

      const wire = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
      this.proc.stdin.write(wire);
    });
  }

  /** Send the ACP `initialize` handshake. Must be called exactly once before newSession(). */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.call("initialize", { protocolVersion: 1, clientCapabilities: {} });
    this.initialized = true;
  }

  /** Open a new session. Returns the session id. */
  async newSession(cwd: string): Promise<string> {
    if (!this.initialized) {
      throw new Error("AcpClient.newSession called before initialize()");
    }
    const result = await this.call<{ sessionId: string }>("session/new", { cwd, mcpServers: [] });
    this.currentSessionId = result.sessionId;
    this.currentText = "";
    this.currentToolCalls = [];
    return result.sessionId;
  }

  /**
   * Send a single user prompt to an open session and collect the result.
   * Resolves when the agent's turn ends (`stopReason: "end_turn" | "cancelled"`).
   */
  async prompt(sessionId: string, text: string): Promise<PromptResult> {
    if (sessionId !== this.currentSessionId) {
      // Multi-session support is a Commit-5+ concern; v0 tracks one active
      // session at a time per client. Callers that need parallel sessions
      // should spawn one AcpClient per session.
      throw new Error(
        `AcpClient.prompt: sessionId mismatch (got ${sessionId}, current ${this.currentSessionId})`,
      );
    }
    // Reset buffers for this prompt.
    this.currentText = "";
    this.currentToolCalls = [];
    const result = await this.call<{ stopReason: string }>("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
    return {
      text: this.currentText,
      stopReason: result.stopReason,
      toolCalls: this.currentToolCalls.slice(),
    };
  }

  /**
   * Close stdin and await child-process exit, escalating to signals on
   * timeout. Non-throwing — any error during kill is logged via onStderr (or
   * swallowed) so callers can safely `await client.shutdown()` in a `finally`
   * without masking the original error.
   *
   * Lifecycle:
   *   1. Close stdin (graceful — the acp server treats stdin EOF as shutdown).
   *   2. Wait up to `stdinTimeoutMs` for natural exit.
   *   3. Send SIGTERM; wait up to `sigtermTimeoutMs` for exit.
   *   4. Send SIGKILL.
   *
   * Defaults are deliberately tight (5s + 2s = 7s total) because the only
   * thing that can stall a normal shutdown is an in-flight LLM HTTP call,
   * and orphaning that call by SIGTERMing the parent is the right tradeoff.
   * Commit-5 parallel fan-out makes this matter more — 17 stuck children
   * after a single hang would exhaust the system.
   */
  async shutdown(
    options: { stdinTimeoutMs?: number; sigtermTimeoutMs?: number } = {},
  ): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.exitCode !== null) return;

    const stdinTimeoutMs = options.stdinTimeoutMs ?? 5_000;
    const sigtermTimeoutMs = options.sigtermTimeoutMs ?? 2_000;

    try {
      this.proc.stdin.end();
    } catch {
      // already closed — fine
    }

    await waitForExit(this.proc, stdinTimeoutMs).catch(() => {});
    if (this.exitCode !== null) return;

    try {
      this.proc.kill("SIGTERM");
    } catch {
      // already exited between checks — fine
    }
    await waitForExit(this.proc, sigtermTimeoutMs).catch(() => {});
    if (this.exitCode !== null) return;

    try {
      this.proc.kill("SIGKILL");
    } catch {
      // already exited — fine
    }
    // Give the OS a brief moment to deliver SIGKILL before returning. If
    // exit still hasn't fired we don't await further — the child is detached
    // for cleanup by the OS, and we have nothing more to do.
    await waitForExit(this.proc, 1_000).catch(() => {});
  }
}

/** Resolve when the child process emits 'exit', or reject after timeoutMs. */
function waitForExit(proc: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolveExit, rejectExit) => {
    const onExit = () => {
      clearTimeout(timer);
      resolveExit();
    };
    const timer = setTimeout(() => {
      proc.off("exit", onExit);
      rejectExit(new Error(`waitForExit timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.once("exit", onExit);
  });
}
