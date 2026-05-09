#!/usr/bin/env bun
// Mirepoix Phase Zero spike — single-file harness validating the Mirepoix-base
// architectural commitments end-to-end against scotty-gpu's local Ollama
// serving Qwen2.5-Coder-32B-Instruct.
//
// What it does:
//   - Talks to Ollama via its OpenAI-compatible /v1/chat/completions endpoint
//   - Exposes the four base tools from ADR-002: bash, read, write, edit
//   - Runs a tool-calling loop until the model stops requesting tools
//   - Persists every event to a JSONL session log per ADR-005
//
// What it doesn't do (deliberately, per ADR-001/002):
//   - No event bus (Phase One)
//   - No extension API (Phase Two)
//   - No skills loader (Phase One)
//   - No compaction (Phase Six)
//   - No router (cascade/task-class — ADR-008, Phase Four)
//   - No package decomposition (Phase One splits this into @mirepoix/{ai,core,coding,cli})
//
// Usage:
//   bun mirepoix-spike.ts "create a hello.txt file with the words 'hello mirepoix' inside"
//
// Configuration (env):
//   OLLAMA_URL              default http://127.0.0.1:11434/v1
//   MIREPOIX_MODEL          default qwen2.5-coder:32b-instruct
//   MIREPOIX_SESSION_DIR    default ~/.local/share/mirepoix/sessions
//
// Runtime: Bun (preferred) or Node 22+ with --experimental-typescript.

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434/v1";
const MODEL = process.env.MIREPOIX_MODEL ?? "qwen2.5-coder:32b-instruct";
const SESSION_DIR =
  process.env.MIREPOIX_SESSION_DIR ?? `${homedir()}/.local/share/mirepoix/sessions`;
const SESSION_ID = new Date().toISOString().replace(/[:.]/g, "-");
const SESSION_LOG = `${SESSION_DIR}/${SESSION_ID}.jsonl`;

const DEFAULT_SYSTEM_PROMPT = `You are a coding agent operating on a Linux VM.

You have four tools: bash, read, write, edit.

- bash: run a shell command in the working directory.
- read: read a file's contents.
- write: write a file (creates or overwrites).
- edit: replace old_string with new_string in a file. old_string must match exactly and uniquely.

Use the tools to accomplish the user's task. When the task is complete, respond with a short text summary.

Be direct. No preamble. No filler.`;

// Parse CLI flags: --system-prompt-file=PATH, --cwd=PATH, then positional prompt
const rawArgs = process.argv.slice(2);
let systemPromptFile: string | null = null;
let workingDir: string | null = null;
const positional: string[] = [];
for (const arg of rawArgs) {
  if (arg.startsWith("--system-prompt-file=")) {
    systemPromptFile = arg.slice("--system-prompt-file=".length);
  } else if (arg.startsWith("--cwd=")) {
    workingDir = arg.slice("--cwd=".length);
  } else {
    positional.push(arg);
  }
}

const SYSTEM_PROMPT = systemPromptFile
  ? readFileSync(resolve(systemPromptFile), "utf-8")
  : DEFAULT_SYSTEM_PROMPT;

if (workingDir) {
  process.chdir(resolve(workingDir));
}

mkdirSync(SESSION_DIR, { recursive: true });

function log(event: string, payload: unknown): void {
  appendFileSync(
    SESSION_LOG,
    JSON.stringify({ ts: new Date().toISOString(), event, payload }) + "\n",
  );
}

log("session:start", {
  model: MODEL,
  ollama_url: OLLAMA_URL,
  session_id: SESSION_ID,
  system_prompt_file: systemPromptFile,
  working_dir: workingDir ?? process.cwd(),
});

const tools = [
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Run a shell command in the working directory. Returns stdout, stderr, and exit code.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "Shell command to execute" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description: "Read a file from disk and return its contents.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "File path (absolute or relative)" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write",
      description:
        "Write content to a file path. Creates the file if it does not exist; overwrites if it does.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit",
      description:
        "Replace old_string with new_string in a file. old_string must match exactly and uniquely.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
];

async function runBash(command: string): Promise<string> {
  return new Promise((resolveBash) => {
    const proc = spawn("bash", ["-c", command]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      resolveBash(`stdout:\n${stdout}\nstderr:\n${stderr}\nexit: ${code}`);
    });
  });
}

// Some models (notably Qwen2.5-Coder via Ollama) emit tool calls as JSON
// objects inside the assistant `content` field rather than via the
// OpenAI-shaped `tool_calls` array. We detect that shape and rehydrate it
// into proper tool_calls so the rest of the loop is format-agnostic.
function extractJsonObjects(text: string): unknown[] {
  const results: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1);
        try {
          results.push(JSON.parse(candidate));
        } catch {
          // skip non-JSON
        }
        start = -1;
      }
    }
  }
  return results;
}

function tryParseToolCallsFromContent(
  content: string,
): Array<{ name: string; arguments: Record<string, unknown> }> {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const cleaned = content
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const objects = extractJsonObjects(cleaned);
  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;
    const o = obj as Record<string, unknown>;
    if (typeof o.name !== "string") continue;
    const args = (o.arguments ?? o.parameters ?? {}) as unknown;
    if (typeof args === "object" && args !== null) {
      calls.push({ name: o.name, arguments: args as Record<string, unknown> });
    }
  }
  return calls;
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  log("tool:start", { name, args });
  try {
    let result: string;
    if (name === "bash") {
      result = await runBash(args.command as string);
    } else if (name === "read") {
      result = readFileSync(resolve(args.path as string), "utf-8");
    } else if (name === "write") {
      const path = resolve(args.path as string);
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path, args.content as string);
      result = `wrote ${(args.content as string).length} bytes to ${args.path}`;
    } else if (name === "edit") {
      const path = resolve(args.path as string);
      const content = readFileSync(path, "utf-8");
      const oldStr = args.old_string as string;
      const newStr = args.new_string as string;
      const occurrences = content.split(oldStr).length - 1;
      if (occurrences === 0) {
        result = `error: old_string not found in ${args.path}`;
      } else if (occurrences > 1) {
        result = `error: old_string matches ${occurrences} times in ${args.path}, must be unique`;
      } else {
        writeFileSync(path, content.replace(oldStr, newStr));
        result = `edited ${args.path}`;
      }
    } else {
      result = `unknown tool: ${name}`;
    }
    log("tool:end", { name, result_preview: result.slice(0, 200) });
    return result;
  } catch (e) {
    const errMsg = `error: ${(e as Error).message}`;
    log("tool:error", { name, error: errMsg });
    return errMsg;
  }
}

const userPrompt = positional.join(" ");
if (!userPrompt) {
  console.error(
    "usage: bun mirepoix-spike.ts [--system-prompt-file=PATH] [--cwd=PATH] <prompt>",
  );
  process.exit(1);
}

const messages: Array<Record<string, unknown>> = [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: userPrompt },
];

console.log(`[mirepoix] session ${SESSION_ID} model ${MODEL}\n[user] ${userPrompt}`);

const MAX_TURNS = 30;
for (let turn = 0; turn < MAX_TURNS; turn++) {
  log("provider:request", { turn, messages_count: messages.length });
  const res = await fetch(`${OLLAMA_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    log("provider:error", { status: res.status, body: err });
    console.error(`provider error ${res.status}: ${err}`);
    process.exit(1);
  }

  const data = (await res.json()) as {
    choices: Array<{
      message: {
        role: string;
        content: string | null;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };

  const msg = data.choices[0].message;
  log("provider:response", { msg });

  // Normalize the assistant message. If the provider returned proper
  // tool_calls, use them. Otherwise, look for {name, arguments} JSON
  // objects embedded in `content` (Qwen-via-Ollama path) and rehydrate.
  let toolCalls = msg.tool_calls;
  let assistantContent = msg.content;
  let rehydrated = false;
  if ((!toolCalls || toolCalls.length === 0) && typeof msg.content === "string") {
    const parsed = tryParseToolCallsFromContent(msg.content);
    if (parsed.length > 0) {
      toolCalls = parsed.map((p, i) => ({
        id: `call_${turn}_${i}`,
        function: { name: p.name, arguments: JSON.stringify(p.arguments) },
      }));
      assistantContent = null;
      rehydrated = true;
      log("provider:tool_calls_from_content", { count: toolCalls.length });
    }
  }

  messages.push({
    role: "assistant",
    content: assistantContent,
    ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  });

  if (toolCalls && toolCalls.length > 0) {
    if (rehydrated) {
      console.log(`[mirepoix] rehydrated ${toolCalls.length} tool call(s) from content`);
    }
    for (const tc of toolCalls) {
      const args = JSON.parse(tc.function.arguments);
      console.log(`\n[tool:${tc.function.name}] ${JSON.stringify(args).slice(0, 200)}`);
      const result = await executeTool(tc.function.name, args);
      console.log(`[result] ${result.slice(0, 400)}${result.length > 400 ? "..." : ""}`);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
    continue;
  }

  console.log(`\n[mirepoix] ${msg.content ?? "(no content)"}`);
  log("session:end", { reason: "model_done", turns: turn + 1 });
  break;
}

console.log(`\n[mirepoix] session log: ${SESSION_LOG}`);
