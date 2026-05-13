// Bus error-containment smoke (FR-003 / NFR-002).
//
// A throwing handler does not crash the bus; subsequent handlers fire; a
// `bus:error` listener observes the throw. Async variant exercises
// `emitAsync` with a rejecting handler. Throwing `bus:error` handlers do
// not recurse.

import { Bus } from "../src/index";

const bus = new Bus();
let errs = 0;
let goods = 0;
let busErrorThrows = 0;

bus.on("bus:error", () => {
  errs++;
});

bus.on("bus:error", () => {
  busErrorThrows++;
  throw new Error("bus:error handler itself throws — must NOT recurse");
});

bus.on("message:user", () => {
  throw new Error("boom");
});
bus.on("message:user", () => {
  goods++;
});

bus.emit("message:user", { content: "hi" });

if (errs !== 1 || goods !== 1) {
  console.error("sync containment failed", { errs, goods });
  process.exit(1);
}

if (busErrorThrows !== 1) {
  console.error("bus:error handler should have fired exactly once", { busErrorThrows });
  process.exit(1);
}

// Async path.
let asyncErrs = 0;
let asyncGoods = 0;
const asyncBus = new Bus();
asyncBus.on("bus:error", () => {
  asyncErrs++;
});
asyncBus.on("message:user", async () => {
  throw new Error("async boom");
});
asyncBus.on("message:user", async () => {
  asyncGoods++;
});
await asyncBus.emitAsync("message:user", { content: "hi" });
if (asyncErrs !== 1 || asyncGoods !== 1) {
  console.error("async containment failed", { asyncErrs, asyncGoods });
  process.exit(1);
}

console.log("bus-error OK");
