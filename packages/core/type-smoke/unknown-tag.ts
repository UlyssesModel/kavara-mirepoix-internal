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
