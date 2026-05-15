// createSessionLogger — JSONL session-log writer per ADR-005.
//
// One file per session. Single writer. `appendFileSync` per event, no
// buffering, no locking (OQ-5). The first call writes a synthetic
// `session:log-init` header line containing the `schemaVersion`; that tag
// is NOT a member of MirepoixEvent (NQ-1) so consumers do not have to
// handle a "header" arm.
//
// The exhaustive tag array is `as const satisfies ReadonlyArray<EventTag>`
// so tsc rejects this file if a new event arm lands in `events.ts` without
// being added here (NQ-2).
//
// NQ-13 closed in sub-phase D: `errorAwareReplacer` is applied to every
// `JSON.stringify` call so `Error` payloads round-trip as
// `{ name, message, stack, ...ownEnumerableProps }` instead of `{}`.

import { appendFileSync } from "node:fs";

import type { Bus } from "./bus";
import type { Disposer } from "./bus";
import { type EventTag, type MirepoixEvent, schemaVersion } from "./events";

/**
 * JSON.stringify replacer that serializes `Error` instances faithfully.
 * Closes NQ-13 from sub-phase C: error-bearing payloads (`bus:error`,
 * `provider:error`, `tool:error`) now round-trip with `name`, `message`,
 * `stack`, and any own enumerable props instead of the default `{}`.
 */
function errorAwareReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value as unknown as Record<string, unknown>),
    };
  }
  return value;
}

const ALL_TAGS = [
  "session:start",
  "session:end",
  "session:compact",
  "message:user",
  "message:assistant",
  "provider:request",
  "provider:response",
  "provider:error",
  "tool:start",
  "tool:end",
  "tool:error",
  "bus:error",
  "bus:slow-handler",
  "codex:dispatch",
  "codex:request",
  "codex:response",
  "codex:rescue-end",
  "codex:rescue-start",
  "codex:unavailable",
  "codex:verdict",
] as const satisfies ReadonlyArray<EventTag>;

// Type-level exhaustiveness check: if MirepoixEvent gains a new tag that is
// not in ALL_TAGS, this assignment fails because the conditional resolves
// to `never`. Forces a tsc error before the runtime drops the new tag.
type _AllTagsCovered = EventTag extends (typeof ALL_TAGS)[number] ? true : never;
const _exhaustive: _AllTagsCovered = true;
void _exhaustive;

function appendLine(filePath: string, obj: Record<string, unknown>): void {
  appendFileSync(filePath, `${JSON.stringify(obj, errorAwareReplacer)}\n`, {
    encoding: "utf-8",
  });
}

export function createSessionLogger(bus: Bus<MirepoixEvent>, filePath: string): Disposer {
  appendLine(filePath, {
    schemaVersion,
    ts: new Date().toISOString(),
    event: "session:log-init",
    payload: {},
  });

  const disposers: Disposer[] = [];
  for (const tag of ALL_TAGS) {
    const dispose = bus.on(tag, (payload) => {
      appendLine(filePath, {
        ts: new Date().toISOString(),
        event: tag,
        payload,
      });
    });
    disposers.push(dispose);
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}
