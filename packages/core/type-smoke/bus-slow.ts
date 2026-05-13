// Slow-handler smoke (FR-004 / OQ-4).
//
// A handler that exceeds the threshold (default 50ms) triggers a
// `bus:slow-handler` emission. Tests both `emit` (sync) and `emitAsync`
// (async).

import { Bus } from "../src/index";

function busyWaitMs(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // spin
  }
}

const syncBus = new Bus();
const syncSlow: Array<{ tag: string; durationMs: number }> = [];
syncBus.on("bus:slow-handler", (p) => {
  syncSlow.push({ tag: p.tag, durationMs: p.durationMs });
});
syncBus.on("message:user", () => {
  busyWaitMs(70);
});
syncBus.emit("message:user", { content: "hello" });

if (syncSlow.length !== 1 || syncSlow[0].tag !== "message:user" || syncSlow[0].durationMs < 50) {
  console.error("sync slow-handler missed", syncSlow);
  process.exit(1);
}

const asyncBus = new Bus();
const asyncSlow: Array<{ tag: string; durationMs: number }> = [];
asyncBus.on("bus:slow-handler", (p) => {
  asyncSlow.push({ tag: p.tag, durationMs: p.durationMs });
});
asyncBus.on("message:user", async () => {
  await new Promise<void>((res) => setTimeout(res, 70));
});
await asyncBus.emitAsync("message:user", { content: "hello" });

if (asyncSlow.length !== 1 || asyncSlow[0].tag !== "message:user" || asyncSlow[0].durationMs < 50) {
  console.error("async slow-handler missed", asyncSlow);
  process.exit(1);
}

// A slow `bus:slow-handler` handler must NOT recurse infinitely (meta
// recursion suppression).
const recBus = new Bus({ slowHandlerMs: 5 });
let recCount = 0;
recBus.on("bus:slow-handler", () => {
  recCount++;
  busyWaitMs(15);
});
recBus.on("message:user", () => {
  busyWaitMs(15);
});
recBus.emit("message:user", { content: "hi" });
// The handler should fire once for the original slow message:user. It must
// NOT fire again from its own slow-handler emission.
if (recCount !== 1) {
  console.error("meta slow-handler recursed", { recCount });
  process.exit(1);
}

console.log("bus-slow OK");
