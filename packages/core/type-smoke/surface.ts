// Positive type-smoke: assert the exported runtime surface of @mirepoix/core
// matches the sorted FR-009 list exactly. Run with `bun packages/core/type-smoke/surface.ts`.

import * as core from "../src/index";

const keys = Object.keys(core).sort();
const expected = ["Bus", "PACKAGE_NAME", "Session", "createSessionLogger", "run", "schemaVersion"];

if (JSON.stringify(keys) !== JSON.stringify(expected)) {
  console.error("core surface mismatch:", keys);
  process.exit(1);
}

if (core.PACKAGE_NAME !== "@mirepoix/core") {
  console.error("PACKAGE_NAME mismatch:", core.PACKAGE_NAME);
  process.exit(1);
}

if (core.schemaVersion !== "1") {
  console.error("schemaVersion mismatch:", core.schemaVersion);
  process.exit(1);
}

console.log("core surface OK");
