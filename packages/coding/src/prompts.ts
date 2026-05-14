// DEFAULT_SYSTEM_PROMPT — the in-package default system prompt per ADR-005.
//
// Loaded once at module-load time from `./prompts/coding.md`. No filesystem
// paths cross the package boundary; the CLI imports the string. Provenance
// is `null` in `session:start.systemPromptFile` when this default is used
// (FR-005 / OQ-4).
//
// Extracted from `phase-zero-spike/mirepoix-spike.ts` lines 48-59. The spike
// is byte-frozen during sub-phase D; sub-phase D.1 retires both files.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The default Mirepoix coding-agent system prompt. Read once at module load
 * from `packages/coding/src/prompts/coding.md`. ADR-005.
 */
export const DEFAULT_SYSTEM_PROMPT: string = readFileSync(
  resolve(here, "prompts", "coding.md"),
  "utf-8",
);
