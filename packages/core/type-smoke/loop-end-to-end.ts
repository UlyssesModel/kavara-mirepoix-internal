// Agent loop end-to-end smoke (FR-008).
//
// Drives `run` with a stub provider (NQ-8 seam). Asserts one-shot (no tool
// call) and tool round-trip event sequences match the contract.

// `AssistantMessage` lives in @mirepoix/ai (declared dep of @mirepoix/core).
// Core re-exports `ProviderFn`/`RunOptions` whose `provider` returns this
// type, but the type itself is not part of core's public surface.
import type { AssistantMessage } from "@mirepoix/ai";
import { Session, run } from "../src/index";

async function oneShot(): Promise<void> {
  const session = new Session({ id: "t1", systemPrompt: "sp" });
  const events: string[] = [];
  for (const tag of [
    "session:start",
    "message:user",
    "provider:request",
    "provider:response",
    "message:assistant",
    "session:end",
  ] as const) {
    session.bus.on(tag, () => {
      events.push(tag);
    });
  }
  await run({
    session,
    userPrompt: "hi",
    providerConfig: { url: "http://stub", model: "stub" },
    tools: [],
    executeTool: async (_name, _args, _ctx) => "",
    workingDir: process.cwd(),
    systemPromptFile: null,
    provider: async (): Promise<AssistantMessage> => ({
      role: "assistant",
      content: "hello back",
      tool_calls: undefined,
    }),
  });
  const expected = [
    "session:start",
    "message:user",
    "provider:request",
    "provider:response",
    "message:assistant",
    "session:end",
  ];
  if (JSON.stringify(events) !== JSON.stringify(expected)) {
    console.error("oneshot event order", events);
    process.exit(1);
  }
}

async function toolRoundTrip(): Promise<void> {
  const session = new Session({ id: "t2", systemPrompt: "sp" });
  const events: string[] = [];
  for (const tag of [
    "session:start",
    "message:user",
    "provider:request",
    "provider:response",
    "message:assistant",
    "tool:start",
    "tool:end",
    "tool:error",
    "session:end",
  ] as const) {
    session.bus.on(tag, () => {
      events.push(tag);
    });
  }
  let call = 0;
  await run({
    session,
    userPrompt: "do it",
    providerConfig: { url: "http://stub", model: "stub" },
    tools: [],
    executeTool: async (name, args, _ctx) => `tool ${name} ran with ${JSON.stringify(args)}`,
    workingDir: process.cwd(),
    systemPromptFile: null,
    provider: async (): Promise<AssistantMessage> => {
      if (call++ === 0) {
        return {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c0",
              function: { name: "bash", arguments: JSON.stringify({ command: "ls" }) },
            },
          ],
        };
      }
      return { role: "assistant", content: "done", tool_calls: undefined };
    },
  });
  const expected = [
    "session:start",
    "message:user",
    "provider:request",
    "provider:response",
    "message:assistant",
    "tool:start",
    "tool:end",
    "provider:request",
    "provider:response",
    "message:assistant",
    "session:end",
  ];
  if (JSON.stringify(events) !== JSON.stringify(expected)) {
    console.error("tool-round-trip event order", events);
    process.exit(1);
  }
  // Final messages should be: system, user, assistant(tool_calls), tool, assistant, total 5.
  if (session.messages.length !== 5) {
    console.error("message tape length", session.messages.length, session.messages);
    process.exit(1);
  }
}

async function toolThrowContinues(): Promise<void> {
  // NQ-9: executeTool throws; loop emits tool:error and continues with a
  // synthesized "error: ..." tool message.
  const session = new Session({ id: "t3", systemPrompt: "sp" });
  const events: string[] = [];
  for (const tag of ["tool:start", "tool:end", "tool:error", "session:end"] as const) {
    session.bus.on(tag, () => {
      events.push(tag);
    });
  }
  let call = 0;
  await run({
    session,
    userPrompt: "do it",
    providerConfig: { url: "http://stub", model: "stub" },
    tools: [],
    executeTool: async (_name, _args, _ctx) => {
      throw new Error("kaboom");
    },
    workingDir: process.cwd(),
    systemPromptFile: null,
    provider: async (): Promise<AssistantMessage> => {
      if (call++ === 0) {
        return {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c0",
              function: { name: "bash", arguments: JSON.stringify({ command: "x" }) },
            },
          ],
        };
      }
      return { role: "assistant", content: "ok", tool_calls: undefined };
    },
  });
  const expected = ["tool:start", "tool:error", "session:end"];
  if (JSON.stringify(events) !== JSON.stringify(expected)) {
    console.error("tool-throw event order", events);
    process.exit(1);
  }
  // The tool message pushed after the throw should be "error: kaboom".
  const toolMsg = session.messages.find((m) => m.role === "tool") as
    | Record<string, unknown>
    | undefined;
  if (!toolMsg || toolMsg.content !== "error: kaboom") {
    console.error("synthesized tool message", toolMsg);
    process.exit(1);
  }
}

async function providerErrorRethrows(): Promise<void> {
  // The loop emits `provider:error` and rethrows so the CLI can present it.
  const session = new Session({ id: "t4", systemPrompt: "sp" });
  let errorSeen = false;
  session.bus.on("provider:error", () => {
    errorSeen = true;
  });
  let threw = false;
  try {
    await run({
      session,
      userPrompt: "fail",
      providerConfig: { url: "http://stub", model: "stub" },
      tools: [],
      executeTool: async (_name, _args, _ctx) => "",
      workingDir: process.cwd(),
      systemPromptFile: null,
      provider: async () => {
        throw new Error("provider down");
      },
    });
  } catch (e) {
    threw = true;
    if (!(e instanceof Error) || e.message !== "provider down") {
      console.error("rethrow message wrong", e);
      process.exit(1);
    }
  }
  if (!threw || !errorSeen) {
    console.error("provider:error path broken", { threw, errorSeen });
    process.exit(1);
  }
}

async function maxTurns(): Promise<void> {
  const session = new Session({ id: "t5", systemPrompt: "sp" });
  let endReason = "";
  session.bus.on("session:end", (p) => {
    endReason = p.reason;
  });
  await run({
    session,
    userPrompt: "spin",
    providerConfig: { url: "http://stub", model: "stub" },
    tools: [],
    executeTool: async (_name, _args, _ctx) => "result",
    workingDir: process.cwd(),
    systemPromptFile: null,
    maxTurns: 2,
    provider: async (): Promise<AssistantMessage> => ({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "c",
          function: { name: "bash", arguments: JSON.stringify({ command: "true" }) },
        },
      ],
    }),
  });
  if (endReason !== "max_turns") {
    console.error("max_turns end reason wrong", endReason);
    process.exit(1);
  }
}

await oneShot();
await toolRoundTrip();
await toolThrowContinues();
await providerErrorRethrows();
await maxTurns();

console.log("loop-end-to-end OK");
