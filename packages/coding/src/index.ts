// @mirepoix/coding — Phase One scaffold.
// Implementation lands in subsequent sub-phases by extracting from
// phase-zero-spike/mirepoix-spike.ts via self-modification (ADR-003).

/** Identity sentinel; value is "@mirepoix/coding". */
export const PACKAGE_NAME = "@mirepoix/coding" as const;

/**
 * tools — four OpenAI function-call definitions (bash, read, write, edit)
 * per ADR-002. Pass verbatim to callProvider from @mirepoix/ai.
 * See tools.ts (spike lines 101-160).
 */
export { tools } from "./tools";

/**
 * executeTool — dispatch by name to bash/read/write/edit; always returns a
 * string (never throws). runBash is intentionally not re-exported; go through
 * executeTool("bash", { command }). See execute.ts (spike lines 240-278).
 */
export { executeTool } from "./execute";

/**
 * DEFAULT_SYSTEM_PROMPT — the in-package default system prompt, loaded once
 * at module load from `./prompts/coding.md`. Per ADR-005. Operators override
 * via `mirepoix --system-prompt-file=PATH`. See prompts.ts (spike lines 48-59).
 */
export { DEFAULT_SYSTEM_PROMPT } from "./prompts";

/**
 * ToolContext — the aggregate carried into every tool invocation. Per
 * ADR-014 Refactor 2 / MS-3 and CONTEXT-MAP.md R1 (Issue #14). Type-only
 * export — no runtime artifact, so the package's runtime-surface key set
 * (DEFAULT_SYSTEM_PROMPT, PACKAGE_NAME, executeTool, tools) is unchanged.
 */
export type { ToolContext } from "./context";
