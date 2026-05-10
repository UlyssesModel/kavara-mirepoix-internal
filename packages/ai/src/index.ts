// @mirepoix/ai — Phase One scaffold.
// Implementation lands in subsequent sub-phases by extracting from
// phase-zero-spike/mirepoix-spike.ts via self-modification (ADR-003).

/** Identity sentinel; value is "@mirepoix/ai". */
export const PACKAGE_NAME = "@mirepoix/ai" as const;

/**
 * callProvider — POST to an OpenAI-compatible /chat/completions endpoint and
 * return choices[0].message. Throws on non-2xx. See provider.ts (spike lines 297-330).
 *
 * normalizeAssistantMessage — resolve the two tool-call wire shapes (tool_calls
 * array vs. JSON-in-content) into a uniform { content, toolCalls, rehydrated }
 * triple. See provider.ts (spike lines 336-350).
 */
export { callProvider, normalizeAssistantMessage } from "./provider";
export type { ProviderConfig, AssistantMessage } from "./provider";

/**
 * tryParseToolCallsFromContent — strip fences, extract JSON objects, filter to
 * { name, arguments } shape. See rehydrate.ts (spike lines 219-238).
 *
 * extractJsonObjects — brace-matching state machine; handles nested objects that
 * a regex cannot. See rehydrate.ts (spike lines 179-217).
 */
export { extractJsonObjects, tryParseToolCallsFromContent } from "./rehydrate";
