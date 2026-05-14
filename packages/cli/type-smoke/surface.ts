// Positive type-smoke: assert the exported runtime surface of @mirepoix/cli
// matches the sorted FR-007 list exactly. Run with
// `bun packages/cli/type-smoke/surface.ts`.

import * as cli from "../src/index";

const keys = Object.keys(cli).sort();
const expected = ["PACKAGE_NAME", "main"];

if (JSON.stringify(keys) !== JSON.stringify(expected)) {
  console.error("cli surface mismatch:", keys);
  process.exit(1);
}

if (cli.PACKAGE_NAME !== "@mirepoix/cli") {
  console.error("PACKAGE_NAME mismatch:", cli.PACKAGE_NAME);
  process.exit(1);
}

if (typeof cli.main !== "function") {
  console.error("main not a function");
  process.exit(1);
}

console.log("cli surface OK");
