#!/usr/bin/env bun
// @mirepoix/cli — Mirepoix command-line entry. Wires `@mirepoix/coding` and
// `@mirepoix/core` per ADR-001 (`cli` is the integrator). Public surface,
// sorted on `Object.keys`:
//
//   ["PACKAGE_NAME", "main"]
//
// `main(argv?: string[]): Promise<number>` is the testable seam. The top-of-
// file shebang lets `bun install` materialize this file as the `mirepoix`
// bin entry. The top-level `if (import.meta.main)` block at the bottom
// translates `main`'s return value to a process exit code (NQ-D-9).
//
// Boundary concerns localized to this package per NFR-003 / FR-011:
// `process.env`, `process.argv`, `process.chdir`, `process.exit`, and
// `console.*` are forbidden outside `packages/cli/src/`. They are concentrated
// in `main.ts`, `argv.ts`, and `render.ts`.

/** Identity sentinel; value is "@mirepoix/cli". */
export const PACKAGE_NAME = "@mirepoix/cli" as const;

export { main } from "./main";

import { main } from "./main";

if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
