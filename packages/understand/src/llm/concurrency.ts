// @mirepoix/understand — minimal bounded-concurrency helper.
//
// Stand-alone (no `p-limit` workspace dep). The fan-out shape we need is
// simple: given items[], run up to `limit` invocations of fn() concurrently,
// resolving with results in input order. Errors from individual fn() calls
// are captured per-item — the helper itself does not reject — because Commit
// 5's per-batch failures are isolated (one bad batch must not abort the
// other 16).

/** Result of a single concurrent invocation. Either ok with value, or failed
 *  with an error string captured. */
export type SettledResult<R> = { ok: true; value: R } | { ok: false; error: Error };

/**
 * Run `fn(item)` for each item in `items`, with at most `limit` invocations
 * in flight at any time. Resolves with one SettledResult per input, in input
 * order. Never rejects — caller inspects per-item `ok` to find failures.
 *
 * Implementation: N "worker" coroutines all pulling from a shared cursor.
 * Order of starts is preserved; order of completions is not (faster items
 * finish first), but results land in the input-indexed slots so the returned
 * array IS input-ordered.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<SettledResult<R>[]> {
  if (limit < 1) throw new Error(`runWithConcurrency: limit must be >= 1 (got ${limit})`);
  const results: SettledResult<R>[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        const value = await fn(items[i], i);
        results[i] = { ok: true, value };
      } catch (err) {
        results[i] = {
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
