// Session — value object that owns the conversation buffer and the bus.
//
// The Session constructor does no I/O. The log writer is wired separately
// via `createSessionLogger(session.bus, filePath)` (FR-007). The agent loop
// (loop.ts) mutates `messages` and `turn`; that mutation is the spike's
// shape and is preserved deliberately (NFR-002).
//
// Provenance: the spike implicitly carries a "session" in module-scoped
// state — `SESSION_ID`, `SYSTEM_PROMPT`, the `messages` array, and the loop
// counter. This module reifies that state.

import { Bus } from "./bus";
import type { MirepoixEvent } from "./events";

/** Constructor options for `Session`. */
export interface SessionOptions {
  id: string;
  systemPrompt: string;
  /** Forwarded to `Bus` (default 50ms per ADR-004). */
  slowHandlerMs?: number;
}

export class Session {
  readonly id: string;
  readonly systemPrompt: string;
  readonly bus: Bus<MirepoixEvent>;
  readonly messages: Array<Record<string, unknown>>;
  turn: number;

  constructor(options: SessionOptions) {
    this.id = options.id;
    this.systemPrompt = options.systemPrompt;
    this.bus = new Bus<MirepoixEvent>({ slowHandlerMs: options.slowHandlerMs });
    this.messages = [{ role: "system", content: options.systemPrompt }];
    this.turn = 0;
  }
}
