// Negative integration smoke for the transitional NQ-7 concession.
//
// `packages/core/src/loop.ts` asserts that `RunOptions.workingDir ===
// process.cwd()` at session:start and throws otherwise. This test
// constructs `RunOptions` with a workingDir that is provably not the
// current process.cwd(), awaits `run`, and asserts the throw.
//
// This is the negative counterpart to `loop-end-to-end.ts` (which now
// passes `workingDir: process.cwd()` at all five constructor sites so
// the positive smoke remains runnable).
//
// Removed when issue #14 lands ToolContext plumbing — at that point the
// assertion is gone, the divergence becomes structurally impossible
// (tools receive `ctx.workingDir` directly), and this file's purpose
// disappears with it.

import { type AssistantMessage, Session, run } from "../src/index";

const DIVERGED_PATH = "/__intentionally_diverged_for_assertion_test__";

async function divergenceThrows(): Promise<void> {
  if (process.cwd() === DIVERGED_PATH) {
    console.error("test invariant broken: process.cwd() matches sentinel path");
    process.exit(1);
  }

  const session = new Session({ id: "neg-wd", systemPrompt: "sp" });
  let threw = false;
  try {
    await run({
      session,
      userPrompt: "should not get past assertion",
      providerConfig: { url: "http://stub", model: "stub" },
      tools: [],
      executeTool: async () => "",
      workingDir: DIVERGED_PATH,
      systemPromptFile: null,
      provider: async (): Promise<AssistantMessage> => ({
        role: "assistant",
        content: "unreachable",
        tool_calls: undefined,
      }),
    });
  } catch (err) {
    threw = true;
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("issue #14")) {
      console.error("assertion message missing issue #14 marker:", message);
      process.exit(1);
    }
    if (!message.includes(DIVERGED_PATH)) {
      console.error("assertion message missing diverged path:", message);
      process.exit(1);
    }
  }

  if (!threw) {
    console.error("workingDir divergence did not throw");
    process.exit(1);
  }

  // The throw must occur BEFORE the loop pushes the user message and emits
  // session:start. Session's constructor seeds messages with the system
  // message, so the post-throw tape length is 1 (system only) — not 2
  // (system + user, which is what the loop produces on the happy path).
  if (session.messages.length !== 1) {
    console.error("loop progressed past assertion (tape length):", session.messages);
    process.exit(1);
  }
}

await divergenceThrows();

console.log("loop-workdir-assertion OK");
