// Bus<E> — typed, in-process event bus per ADR-004.
//
// Surface: on / off / emit / emitAsync, with on() returning a disposer (OQ-2).
// Generic over the event union so that `bus.on("unknown-tag", h)` fails tsc
// (NFR-001 / FR-001). The payload type for a given tag is inferred via
// `Extract<E, { tag: T }>["payload"]`.
//
// Error containment (NFR-002 / FR-003): a thrown handler does not propagate
// to the caller of emit; it is surfaced as `bus:error`. Slow handlers are
// surfaced as `bus:slow-handler` once the configurable threshold is crossed
// (ADR-004 default 50ms).
//
// Recursion suppression: `bus:error` and `bus:slow-handler` emissions never
// re-enter the error/slow-handler instrumentation. Without this guard an
// extension's broken `bus:error` listener could infinite-loop.

import type { BaseEvent, MirepoixEvent } from "./events";

/** Optional construction parameters for `Bus`. */
export interface BusOptions {
  /** Threshold in ms above which a handler triggers `bus:slow-handler`. Default 50. */
  slowHandlerMs?: number;
}

/** Handler signature; may return a thenable for `emitAsync` to await. */
export type Handler<P> = (payload: P) => void | Promise<void>;

/** Disposer returned by `on()`; calling it removes the registered handler. */
export type Disposer = () => void;

const DEFAULT_SLOW_HANDLER_MS = 50;

const META_TAGS = new Set<string>(["bus:error", "bus:slow-handler"]);

type AnyHandler = Handler<unknown>;

export class Bus<E extends BaseEvent = MirepoixEvent> {
  private readonly listeners: Map<string, AnyHandler[]> = new Map();
  private readonly slowHandlerMs: number;

  constructor(options?: BusOptions) {
    this.slowHandlerMs = options?.slowHandlerMs ?? DEFAULT_SLOW_HANDLER_MS;
  }

  on<T extends E["tag"]>(tag: T, handler: Handler<Extract<E, { tag: T }>["payload"]>): Disposer {
    const list = this.listeners.get(tag) ?? [];
    list.push(handler as AnyHandler);
    this.listeners.set(tag, list);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.removeHandler(tag, handler as AnyHandler);
    };
  }

  off<T extends E["tag"]>(tag: T, handler: Handler<Extract<E, { tag: T }>["payload"]>): void {
    this.removeHandler(tag, handler as AnyHandler);
  }

  emit<T extends E["tag"]>(tag: T, payload: Extract<E, { tag: T }>["payload"]): void {
    const handlers = this.listeners.get(tag);
    if (!handlers || handlers.length === 0) return;
    const isMeta = META_TAGS.has(tag as string);
    // Snapshot to keep mutation during iteration (a handler that calls off())
    // from skipping subsequent handlers.
    const snapshot = handlers.slice();
    for (const handler of snapshot) {
      const t0 = performance.now();
      try {
        const ret = handler(payload as unknown);
        // If the handler accidentally returns a promise under `emit`, we do
        // not await it. The slow-handler measurement here captures sync wall
        // time only, matching ADR-004's sync emit contract.
        // Reference the return value to silence unused checks without I/O.
        void ret;
      } catch (err) {
        if (!isMeta) {
          this.emitMeta("bus:error", {
            tag: tag as string,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      } finally {
        const durationMs = performance.now() - t0;
        if (!isMeta && durationMs > this.slowHandlerMs) {
          this.emitMeta("bus:slow-handler", { tag: tag as string, durationMs });
        }
      }
    }
  }

  async emitAsync<T extends E["tag"]>(
    tag: T,
    payload: Extract<E, { tag: T }>["payload"],
  ): Promise<void> {
    const handlers = this.listeners.get(tag);
    if (!handlers || handlers.length === 0) return;
    const isMeta = META_TAGS.has(tag as string);
    const snapshot = handlers.slice();
    for (const handler of snapshot) {
      const t0 = performance.now();
      try {
        await handler(payload as unknown);
      } catch (err) {
        if (!isMeta) {
          this.emitMeta("bus:error", {
            tag: tag as string,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      } finally {
        const durationMs = performance.now() - t0;
        if (!isMeta && durationMs > this.slowHandlerMs) {
          this.emitMeta("bus:slow-handler", { tag: tag as string, durationMs });
        }
      }
    }
  }

  /**
   * Internal emit path for meta events (`bus:error`, `bus:slow-handler`).
   * Bypasses instrumentation entirely; a throwing meta handler is caught and
   * dropped on the floor so the bus cannot infinite-loop on itself.
   */
  private emitMeta(tag: "bus:error" | "bus:slow-handler", payload: Record<string, unknown>): void {
    const handlers = this.listeners.get(tag);
    if (!handlers || handlers.length === 0) return;
    const snapshot = handlers.slice();
    for (const handler of snapshot) {
      try {
        const ret = handler(payload as unknown);
        // Async meta handlers can return a thenable. We attach a swallowing
        // catch so a rejection does not become an unhandled promise rejection
        // and so it never re-enters `emit`. There is no recursion path.
        if (ret && typeof (ret as Promise<unknown>).then === "function") {
          (ret as Promise<unknown>).catch(() => {
            /* swallow — meta handler errors are dropped (NFR-002) */
          });
        }
      } catch {
        /* swallow — meta handler errors are dropped (NFR-002) */
      }
    }
  }

  private removeHandler(tag: string, handler: AnyHandler): void {
    const list = this.listeners.get(tag);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  }
}
