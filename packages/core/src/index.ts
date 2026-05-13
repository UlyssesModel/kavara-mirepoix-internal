// @mirepoix/core — Mirepoix kernel.
//
// Public surface (FR-009; sorted on `Object.keys`):
//   Bus, PACKAGE_NAME, Session, createSessionLogger, run, schemaVersion
//
// Type-only re-exports do not affect `Object.keys`. See ADR-001 / ADR-004 /
// ADR-005 for the architecture.

/** Identity sentinel; value is "@mirepoix/core". */
export const PACKAGE_NAME = "@mirepoix/core" as const;

export { Bus } from "./bus";
export type { BusOptions, Disposer, Handler } from "./bus";

export { Session } from "./session";
export type { SessionOptions } from "./session";

export { run } from "./loop";
export type { ProviderFn, RunOptions } from "./loop";

export { createSessionLogger } from "./log";

export { schemaVersion } from "./events";
export type { BaseEvent, EventTag, MirepoixEvent, PayloadOf } from "./events";
