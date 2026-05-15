// Negative type-smoke (NFR-001 / NQ-5).
//
// This file MUST FAIL `tsc --noEmit` because `bus.on("does-not-exist", ...)`
// passes a tag that is not in `MirepoixEvent["tag"]`. Verification runs
// `! bun x tsc --noEmit -p packages/core/type-smoke/tsconfig-negative.json`
// — the leading `!` inverts the exit, so this failure is the success path.

import { Bus } from "../src/index";

const bus = new Bus();

// @ts-expect-error — intentional: the tag is not a member of MirepoixEvent.
// We expect tsc to error here. `tsconfig-negative.json` does NOT enable
// `noUnusedLocals` etc., and the comment above is a no-op when the error
// is suppressed; we rely on the wrong-tag argument to fail compile.
bus.on("does-not-exist", () => {});

// Belt-and-suspenders: a definitely-typed wrong-tag call without the
// suppression directive, so the file still fails compile even if a future
// tsc version treats unused @ts-expect-error as the only error.
bus.on("session:start--invalid", () => {});

// Sub-phase codex-events / FR-5: malformed codex arm payloads must fail tsc.
// One negative case per arm-family. Retry 1 update: field names refreshed
// to match the post-review shapes — the cases must still FAIL tsc, so each
// omits a still-required field after the rename.

// codex:request — missing required `dispatchId`. tsc must reject.
// (`prompt` replaces `promptPreview` / `promptLength` per CONCERN-2.)
bus.emit("codex:request", {
  // dispatchId omitted on purpose.
  model: "gpt-5-codex",
  prompt: "x",
});

// codex:verdict — missing required `gateVerdict`. tsc must reject.
// (Per CONCERN-1, both `sourceVerdict` and `gateVerdict` are required;
// supplying only `sourceVerdict` exercises the still-required gate field.)
bus.emit("codex:verdict", {
  dispatchId: "d1",
  sourceVerdict: "needs-attention",
  // gateVerdict omitted on purpose.
  body: "body text",
});

// codex:rescue-end — missing required `outcome`. tsc must reject.
// (Per CONCERN-3, `outcome` is still required; the enum widened from
// `ok | error | timeout` to the five-state runbook set, but absence is
// still a compile-time error.)
bus.emit("codex:rescue-end", {
  dispatchId: "d2",
  // outcome omitted on purpose.
  touchedFiles: [],
  durationMs: 0,
});
