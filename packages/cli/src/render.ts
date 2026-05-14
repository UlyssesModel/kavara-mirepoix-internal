// Stdout renderer for @mirepoix/cli (FR-009 / NQ-D-10).
//
// Subscribes to `tool:start`, `tool:end`, `tool:error`, and `provider:response`.
// Mirrors the spike's stdout format (lines 360, 364, 366, 376). The set of
// subscriptions deliberately omits `message:assistant` (NQ-D-10): the
// rehydrated line and the final-content line are emitted via
// `provider:response` instead, which carries the `rehydrated` flag directly
// and avoids cross-event state in the renderer.

import type { Bus, Disposer, MirepoixEvent } from "@mirepoix/core";

export function attachStdoutRenderer(bus: Bus<MirepoixEvent>): Disposer[] {
  const disposers: Disposer[] = [];

  disposers.push(
    bus.on("tool:start", (payload) => {
      const argsPreview = JSON.stringify(payload.args).slice(0, 200);
      console.log(`\n[tool:${payload.name}] ${argsPreview}`);
    }),
  );

  disposers.push(
    bus.on("tool:end", (payload) => {
      // NQ-D-7: the underlying preview is capped at 200 chars in core; render
      // it as-is, append "..." when the full result is longer than what we
      // received. The JSONL carries `resultLength` for full truncation extent.
      const truncated = payload.resultLength > payload.resultPreview.length ? "..." : "";
      console.log(`[result] ${payload.resultPreview}${truncated}`);
    }),
  );

  disposers.push(
    bus.on("tool:error", (payload) => {
      const message =
        payload.error instanceof Error ? payload.error.message : String(payload.error);
      console.log(`[error] ${message}`);
    }),
  );

  disposers.push(
    bus.on("provider:response", (payload) => {
      // Rehydrated tool-calls header (spike line 360).
      if (payload.rehydrated && payload.rehydratedToolCalls?.length) {
        console.log(
          `[mirepoix] rehydrated ${payload.rehydratedToolCalls.length} tool call(s) from content`,
        );
      }
      // Final assistant content when no tool calls (spike line 376). The
      // `message:assistant` bus event also carries this content, but we
      // subscribe to `provider:response` exclusively (NQ-D-10) so that the
      // rehydrated and no-toolcalls cases share one subscription point.
      const msg = payload.message;
      const toolCalls = msg.tool_calls;
      if (
        (!toolCalls || toolCalls.length === 0) &&
        typeof msg.content === "string" &&
        msg.content.length > 0
      ) {
        console.log(`\n[mirepoix] ${msg.content}`);
      }
    }),
  );

  return disposers;
}
