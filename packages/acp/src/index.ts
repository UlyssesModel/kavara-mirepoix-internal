#!/usr/bin/env bun
// @mirepoix/acp — ACP (Agent Client Protocol) server for Mirepoix.
//
// Exposes the Mirepoix agent loop over ACP via stdio JSON-RPC so any
// ACP-compatible client (Zed, JetBrains, future TUI) can drive it. Per
// the methodology-pluggable distribution thesis: core + coding + ai is
// the moat; this package is one of many distribution surfaces.
//
// Boundary: like @mirepoix/cli, this package localizes `process.env`,
// `process.stdin`/`stdout`, and `console.*`. core / coding / ai read no
// environment state.

import { Readable, Writable } from "node:stream";
import { homedir } from "node:os";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type AuthenticateRequest,
  type AuthenticateResponse,
  type CancelNotification,
  type ContentBlock,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";
import { DEFAULT_SYSTEM_PROMPT, executeTool, tools } from "@mirepoix/coding";
import { Session, run, type RunOptions, createSessionLogger } from "@mirepoix/core";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_MODEL = "qwen3-coder:30b";
const DEFAULT_SESSION_DIR = `${homedir()}/.local/share/mirepoix/sessions`;

interface SessionState {
  mirepoixSession: Session;
  cwd: string;
  abortController: AbortController | null;
  disposeLog: () => void;
  systemPromptFilePath: string | null;
}

class MirepoixAgent implements Agent {
  private readonly connection: AgentSideConnection;
  private readonly sessions = new Map<string, SessionState>();
  private readonly ollamaUrl: string;
  private readonly model: string;
  private readonly sessionDir: string;

  constructor(connection: AgentSideConnection) {
    this.connection = connection;
    this.ollamaUrl = process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
    this.model = process.env.MIREPOIX_MODEL ?? DEFAULT_MODEL;
    this.sessionDir = process.env.MIREPOIX_SESSION_DIR ?? DEFAULT_SESSION_DIR;
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
      },
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Load system prompt (file when --system-prompt-file; else DEFAULT_SYSTEM_PROMPT).
    let systemPrompt = DEFAULT_SYSTEM_PROMPT;
    let systemPromptFilePath: string | null = null;
    if (process.env.MIREPOIX_SYSTEM_PROMPT_FILE) {
      try {
        const promptPath = resolve(process.env.MIREPOIX_SYSTEM_PROMPT_FILE);
        systemPrompt = readFileSync(promptPath, "utf-8");
        systemPromptFilePath = promptPath;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Cannot read MIREPOIX_SYSTEM_PROMPT_FILE: ${message}`);
      }
    }

    const mirepoixSession = new Session({
      id: sessionId,
      systemPrompt,
    });

    let cwd = params.cwd ?? process.cwd();
    const macPrefix = "/Users/jekavara/code/kavara/";
    const linuxPrefix = "/home/jekavara/workspaces/";
    if (cwd.startsWith(macPrefix)) {
      cwd = linuxPrefix + cwd.slice(macPrefix.length);
    }

    // Create session log file
    const sessionLogPath = `${this.sessionDir}/${sessionId}.jsonl`;
    mkdirSync(this.sessionDir, { recursive: true });
    const disposeLog = createSessionLogger(mirepoixSession.bus, sessionLogPath);

    this.sessions.set(sessionId, {
      mirepoixSession,
      cwd,
      abortController: null,
      disposeLog,
      systemPromptFilePath,
    });

    process.stderr.write(`[mirepoix-acp] session ${sessionId} model ${this.model}\n`);

    return { sessionId };
  }

  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
    return {};
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const state = this.sessions.get(params.sessionId);
    if (!state) {
      throw new Error(`Session ${params.sessionId} not found`);
    }

    state.abortController?.abort();
    state.abortController = new AbortController();

    const disposers = this.subscribeBus(state, params.sessionId);

    try {
      const userText = extractTextFromContentBlocks(params.prompt);
      const runOptions: RunOptions = {
        session: state.mirepoixSession,
        userPrompt: userText,
        providerConfig: { url: this.ollamaUrl, model: this.model },
        tools,
        executeTool,
        workingDir: state.cwd,
        systemPromptFile: state.systemPromptFilePath,
      };
      await run(runOptions);

      if (state.abortController.signal.aborted) {
        return { stopReason: "cancelled" };
      }
      return { stopReason: "end_turn" };
    } finally {
      for (const d of disposers) d();
      state.abortController = null;
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    const state = this.sessions.get(params.sessionId);
    state?.abortController?.abort();
    state?.disposeLog();
    this.sessions.delete(params.sessionId);
  }

  private subscribeBus(state: SessionState, acpSessionId: string): Array<() => void> {
    const bus = state.mirepoixSession.bus;
    const conn = this.connection;
    const send = (update: SessionUpdate): void => {
      conn.sessionUpdate({ sessionId: acpSessionId, update }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[mirepoix-acp] sessionUpdate failed: ${message}\n`);
      });
    };

    const disposers: Array<() => void> = [];

    disposers.push(
      bus.on("provider:response", (payload) => {
        const content = payload.message.content;
        if (content != null && content !== "") {
          send({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: content },
          });
        }
      }),
    );

    disposers.push(
      bus.on("tool:start", (payload) => {
        send({
          sessionUpdate: "tool_call",
          toolCallId: payload.callId,
          title: payload.name,
          kind: "execute",
          status: "in_progress",
          rawInput: payload.args,
        });
      }),
    );

    disposers.push(
      bus.on("tool:end", (payload) => {
        send({
          sessionUpdate: "tool_call_update",
          toolCallId: payload.callId,
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: payload.resultPreview } }],
        });
      }),
    );

    disposers.push(
      bus.on("tool:error", (payload) => {
        send({
          sessionUpdate: "tool_call_update",
          toolCallId: payload.callId,
          status: "failed",
          content: [{ type: "content", content: { type: "text", text: payload.error.message } }],
        });
      }),
    );

    return disposers;
  }
}

function extractTextFromContentBlocks(prompt: ContentBlock[]): string {
  const out: string[] = [];
  for (const block of prompt) {
    if (block.type === "text") {
      out.push(block.text);
    }
  }
  return out.join("\n");
}

// === Wire stdio JSON-RPC ===
const inputStream = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
const outputStream = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
const stream = ndJsonStream(outputStream, inputStream);
new AgentSideConnection((conn) => new MirepoixAgent(conn), stream);
