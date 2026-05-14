// Negative type-smoke (FR-013-3). This file MUST FAIL `tsc --noEmit` because
// `RunOptions.workingDir` and `RunOptions.systemPromptFile` are required
// (NQ-7 closed in D / FR-003; OQ-4 / FR-005). The CI runs this under
// `tsconfig-negative.json` with a leading `!`, so the tsc failure is the
// success path.

import { Session, run } from "@mirepoix/core";

const session = new Session({ id: "neg", systemPrompt: "" });

// Definitely-typed failure: omit both required fields. `tsc --noEmit` MUST
// flag this and exit non-zero. No `@ts-expect-error` suppression here — the
// uncaught error IS the success signal.
await run({
  session,
  userPrompt: "x",
  providerConfig: { url: "u", model: "m" },
  tools: [],
  executeTool: async () => "",
  provider: async () => ({ role: "assistant", content: "y", tool_calls: undefined }),
});
