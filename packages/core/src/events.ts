// MirepoixEvent — the discriminated union of all events the kernel emits.
// The union is the authority for the event vocabulary; the JSONL logger
// (log.ts) and the agent loop (loop.ts) treat the tag-arm set as exhaustive.
//
// schemaVersion lives here (not in log.ts) per NQ-3: the union is the
// authority, the logger is a consumer.
//
// Provenance: spike `phase-zero-spike/mirepoix-spike.ts` lines 86-99, 241,
// 271, 275, 297, 312, 331, 348, 377 — every `log(...)` call site in the
// spike maps to an arm here (with NQ-4 normalizing snake_case keys to
// camelCase and NQ-11 subsuming `provider:tool_calls_from_content` into
// `provider:response.rehydrated`).

import type { AssistantMessage } from "@mirepoix/ai";

/** JSONL log schema version. ADR-005. */
export const schemaVersion = "1" as const;

/**
 * Base shape for events on the bus. Extensions can widen the bus's `E`
 * parameter with their own discriminated arms following this shape. The
 * detailed extension typing API is deferred (Phase Two / ADR-003).
 */
export interface BaseEvent {
  readonly tag: string;
  readonly payload: unknown;
}

/** The kernel's event vocabulary. ADR-004 + ADR-005. */
export type MirepoixEvent =
  | {
      tag: "session:start";
      payload: {
        id: string;
        systemPrompt: string;
        /**
         * Provenance for the system prompt. `null` when the default
         * in-package prompt (`@mirepoix/coding/src/prompts/coding.md`) was
         * loaded; absolute path string when the operator supplied
         * `--system-prompt-file=PATH`. Sub-phase D / FR-005 / OQ-4.
         */
        systemPromptFile: string | null;
        model: string;
        url: string;
        workingDir: string;
      };
    }
  | {
      tag: "session:end";
      payload: { reason: "model_done" | "max_turns"; turns: number };
    }
  | {
      tag: "session:compact";
      payload: {
        before: ReadonlyArray<Record<string, unknown>>;
        after: ReadonlyArray<Record<string, unknown>>;
        strategy: string;
      };
    }
  | { tag: "message:user"; payload: { content: string } }
  | {
      tag: "message:assistant";
      payload: {
        role: "assistant";
        content: string | null;
        tool_calls?: ReadonlyArray<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
    }
  | { tag: "provider:request"; payload: { turn: number; messagesCount: number } }
  | {
      tag: "provider:response";
      payload: {
        turn: number;
        message: AssistantMessage;
        rehydrated: boolean;
        rehydratedToolCalls?: ReadonlyArray<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
    }
  | { tag: "provider:error"; payload: { turn: number; error: Error } }
  | {
      tag: "tool:start";
      payload: { name: string; args: Record<string, unknown>; callId: string };
    }
  | {
      tag: "tool:end";
      payload: { name: string; callId: string; resultPreview: string; resultLength: number };
    }
  | { tag: "tool:error"; payload: { name: string; callId: string; error: Error } }
  | { tag: "bus:error"; payload: { tag: string; error: Error; handler?: string } }
  | { tag: "bus:slow-handler"; payload: { tag: string; durationMs: number; handler?: string } };

/** Convenience alias for the set of kernel event tags. */
export type EventTag = MirepoixEvent["tag"];

/** Extract the payload type for a given event tag. */
export type PayloadOf<T extends EventTag, E extends BaseEvent = MirepoixEvent> = Extract<
  E,
  { tag: T }
>["payload"];
