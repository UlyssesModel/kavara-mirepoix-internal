#!/usr/bin/env bun
// @mirepoix/tui — v0.0.1 single-session ACP viewer.
//
// Spawns `mirepoix-acp` as a subprocess, drives an interactive session over
// stdio JSON-RPC, and renders the streaming session/update notifications
// with color. The seed of the v0.2.0 manager view per
// feedback_build_mirepoix_ux_surface.
//
// Wire format: ACP (protocolVersion 1) over newline-delimited JSON.
// Not coupled to Mirepoix internals — speaks pure ACP. Any other ACP
// agent could be substituted by changing the spawn command.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, resolve } from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ACP_ENTRY = process.env.MIREPOIX_ACP_ENTRY ?? resolve(__dirname, "../../acp/src/index.ts");

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function c(color: keyof typeof COLORS, text: string): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

type PendingMap = Map<number, (msg: any) => void>;

class AcpClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending: PendingMap = new Map();
  private currentText = "";

  constructor() {
    this.proc = spawn("bun", [ACP_ENTRY], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    this.proc.stdout.setEncoding("utf-8");

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => this.handleLine(line));
    this.proc.stderr.on("data", (chunk) => {
      process.stderr.write(c("gray", `[agent stderr] ${chunk}`));
    });
    this.proc.on("exit", (code) => {
      console.log(c("gray", `\n[agent exited code=${code}]`));
      process.exit(code ?? 0);
    });
  }

  private handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stderr.write(c("red", `[NON-JSON] ${trimmed}\n`));
      return;
    }
    if (typeof msg.id === "number" && ("result" in msg || "error" in msg)) {
      const handler = this.pending.get(msg.id);
      if (handler) {
        this.pending.delete(msg.id);
        handler(msg);
      }
    } else if (typeof msg.method === "string") {
      this.handleNotification(msg);
    }
  }

  private handleNotification(msg: any) {
    if (msg.method !== "session/update") return;
    const update = msg.params?.update;
    if (!update) return;

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = update.content?.text ?? "";
        if (text) {
          process.stdout.write(c("green", text));
          this.currentText += text;
        }
        break;
      }
      case "tool_call": {
        process.stdout.write(
          `\n${c("cyan", `┌─ tool_call [${update.toolCallId}] ${c("bold", update.title)}`)}\n` +
            `${c("cyan", "│  ")}${c("dim", JSON.stringify(update.rawInput))}\n`,
        );
        break;
      }
      case "tool_call_update": {
        const status = update.status ?? "?";
        const colorMap: Record<string, keyof typeof COLORS> = {
          completed: "green",
          failed: "red",
          in_progress: "yellow",
        };
        const color = colorMap[status] ?? "gray";
        const summary = update.content?.[0]?.content?.text ?? `(status: ${status})`;
        process.stdout.write(`${c(color, `└─ ${status}: `)}${c("dim", summary.slice(0, 200))}\n`);
        break;
      }
      case "plan":
      case "current_mode_update":
      case "available_commands_update":
        process.stdout.write(
          c("magenta", `\n[${update.sessionUpdate}] ${JSON.stringify(update).slice(0, 200)}\n`),
        );
        break;
      default:
        process.stdout.write(
          c("gray", `\n[?] ${update.sessionUpdate}: ${JSON.stringify(update).slice(0, 200)}\n`),
        );
    }
  }

  call(method: string, params: unknown, timeoutMs = 180_000): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`Timeout calling ${method} (id=${id})`));
      }, timeoutMs);

      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) rejectCall(new Error(JSON.stringify(msg.error)));
        else resolveCall(msg.result);
      });

      const wire = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      this.proc.stdin.write(wire);
    });
  }

  notify(method: string, params: unknown) {
    const wire = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    this.proc.stdin.write(wire);
  }

  shutdown() {
    this.proc.stdin.end();
  }
}

async function main() {
  const promptArg = process.argv.slice(2).join(" ").trim();
  const userPrompt =
    promptArg ||
    "Write a one-line Python function `square(n)` that returns n*n. Save it to /tmp/mirepoix_tui_test.py.";

  console.log(c("bold", "@mirepoix/tui v0.0.1 — single-session ACP viewer"));
  console.log(c("dim", `agent: ${ACP_ENTRY}`));
  console.log(c("dim", `prompt: ${userPrompt}`));
  console.log();

  const client = new AcpClient();

  console.log(c("blue", ">>> initialize"));
  const init = await client.call("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
  });
  console.log(
    c(
      "dim",
      `    protocolVersion=${init.protocolVersion} ` +
        `capabilities=${JSON.stringify(init.agentCapabilities)}`,
    ),
  );

  console.log(c("blue", "\n>>> session/new"));
  const session = await client.call("session/new", {
    cwd: process.cwd(),
    mcpServers: [],
  });
  console.log(c("dim", `    sessionId=${session.sessionId}`));

  console.log(c("blue", `\n>>> session/prompt`));
  console.log(c("dim", `    "${userPrompt}"\n`));

  const start = Date.now();
  const result = await client.call("session/prompt", {
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: userPrompt }],
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(
    c("blue", `\n\n--- done in ${elapsed}s · stopReason=${c("bold", result.stopReason)}`),
  );
  client.shutdown();
}

main().catch((err: Error) => {
  console.error(c("red", `\nfatal: ${err.message}`));
  process.exit(1);
});
