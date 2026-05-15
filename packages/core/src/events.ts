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
  | { tag: "bus:slow-handler"; payload: { tag: string; durationMs: number; handler?: string } }
  /**
   * Fires when the on-loop orchestrator dispatches a phase to the Codex
   * teammate. v1 trigger modes: REVIEW (default-on parallel dispatch
   * alongside Claude reviewer per ADR-013 §1) and CODE retry-exhaust
   * (`codex:codex-rescue` after three Claude attempts fail per ADR-013 §2).
   *
   * Audit invariant (ADR-005): every dispatch of a non-Claude teammate is
   * recorded with provenance — which phase triggered it, the human-readable
   * reason, and a monotonic `dispatchId` that pairs downstream
   * `codex:request`, `codex:response`, `codex:verdict`, and
   * `codex:rescue-*` events into a single causal chain. Without this arm
   * the JSONL cannot distinguish "Codex was dispatched but never returned"
   * from "Codex was never dispatched" — the CRITICAL gap ADR-013 flags.
   *
   * NQ-4: camelCase payload keys (`dispatchId`). NQ-13: no `Error` field.
   *
   * `phase: null` is the forward-compat branch for operator-direct
   * invocations outside the on-loop pipeline (OQ-2). v1 always passes a
   * concrete phase; v2 widens to include the null branch when operator-
   * direct invocations land. `dispatchId` is opaque per OQ-4 — v1 emits
   * session-relative monotonic strings; structuring is v2 territory.
   *
   * `command` carries the operator-direct slash-command identity when
   * dispatch originates outside the on-loop pipeline (RUNBOOK §0 lists the
   * full set: `/codex:review`, `/codex:adversarial-review`,
   * `/codex:rescue`, `/codex:status`, `/codex:result`, `/codex:cancel`).
   * Optional because orchestrator-driven dispatches (REVIEW phase, CODE
   * retry-exhaust) carry their identity in `phase` and have no slash-
   * command. Convention: when `phase` is `null` (operator-direct),
   * `command` SHOULD be set so the JSONL distinguishes which command the
   * operator invoked; when `phase` is concrete, `command` SHOULD be
   * absent. Forward-compat per MISSING-4 (retry 1 review).
   */
  | {
      tag: "codex:dispatch";
      payload: {
        dispatchId: string;
        phase: "review" | "code-retry-exhaust" | null;
        reason: string;
        command?: "review" | "adversarial-review" | "rescue" | "status" | "result" | "cancel";
      };
    }
  /**
   * Fires when the Codex CLI (or rescue subagent forwarder) makes an
   * outbound API call to the OpenAI Codex provider. Captures what the wire
   * actually saw — model and full prompt body — so audit reconstruction
   * can verify a dispatch produced a request without re-loading the
   * operator's Codex CLI logs.
   *
   * Audit invariant (ADR-005): "every byte of context… is logged,
   * attributable, and inspectable" — `codex:dispatch` records intent,
   * `codex:request` records the wire fact. Two arms because the two layers
   * can be skewed in time (dispatch fires synchronously in the
   * orchestrator; the request goes on the wire after the subagent boots
   * and may be retried internally).
   *
   * NQ-4: camelCase (`dispatchId`, `prompt`). NQ-13: no `Error` field.
   *
   * Sensitive-content policy (CONCERN-2 from retry 1 review): `prompt` is
   * the FULL outbound body — not a 200-char preview. ADR-005's
   * reconstructability invariant treats the JSONL as the source of truth
   * for every byte of context; preview-only fields violated that for the
   * outbound wire trace. The reviewer-leaked-secrets concern (CWE-532-class
   * logging failure) applies symmetrically to all audit content here and
   * to `codex:verdict.body`, `codex:rescue-start.prompt`, and
   * `codex:response.response`. That trade-off is accepted per ADR-005;
   * operators control JSONL retention and may add a sanitize follow-up.
   */
  | {
      tag: "codex:request";
      payload: {
        dispatchId: string;
        model: string;
        prompt: string;
      };
    }
  /**
   * Fires when Codex's response returns to the harness. Captures the full
   * response body and the wall-clock duration from request emit to
   * response emit. Pairs with `codex:request.dispatchId` for lifecycle
   * reconstruction.
   *
   * Audit invariant (ADR-005): ADR-013 §1 verdict-preservation — every
   * response from a non-Claude teammate has a JSONL-internal copy of the
   * body and the timing, so a forensic reader can confirm that a request
   * produced a response without joining against external Codex CLI logs.
   *
   * NQ-4: camelCase (`dispatchId`, `response`, `durationMs`, `tokensIn`,
   * `tokensOut`, `costUsd`, `cacheHit`). NQ-13: no `Error` field — Codex
   * API failures route to `codex:unavailable` (pre-dispatch) or
   * `codex:verdict` with `gateVerdict: "block"` (post-dispatch).
   *
   * Sensitive-content policy (CONCERN-2 from retry 1 review): `response`
   * is the FULL body, symmetric with `codex:request.prompt`. Same
   * trade-off as the request arm — ADR-005 reconstructability over
   * preview-only redaction.
   *
   * Usage telemetry (MISSING-6 from retry 1 review): `tokensIn`,
   * `tokensOut`, `costUsd`, `cacheHit` are optional fields populated from
   * the Codex CLI response envelope when the provider surfaces them.
   * ADR-013 Known gaps §3 names prompt-cost / latency-budget measurement
   * as a MEDIUM gap; this arm is the natural home. All fields optional
   * because the Codex CLI may not emit usage on every response (cached
   * responses, errored responses, version-skew). `costUsd` is the
   * harness's best estimate per Codex's published pricing; treat as
   * advisory, not billing-authoritative.
   */
  | {
      tag: "codex:response";
      payload: {
        dispatchId: string;
        response: string;
        durationMs: number;
        tokensIn?: number;
        tokensOut?: number;
        costUsd?: number;
        cacheHit?: boolean;
      };
    }
  /**
   * Fires when Codex returns a structured review verdict (REVIEW path).
   * `body` is the verbatim Codex output preserved per the
   * codex-result-handling directive — operators must see what Codex said,
   * not a lossy normalization.
   *
   * Vocabulary split (CONCERN-1 from retry 1 review): Codex's review
   * output schema emits `approve` | `needs-attention` (the source
   * vocabulary the `codex-result-handling` skill defines). The
   * orchestrator's merge gate is binary (approve / block) per RUNBOOK §4
   * normalization. v1 collapsed these into one tristate, which left
   * downstream consumers unable to tell raw Codex output from the
   * orchestrator-normalized decision.
   *
   *   `sourceVerdict` — raw Codex verdict, exactly as Codex emitted it.
   *   `gateVerdict`   — orchestrator-normalized binary used by the merge
   *                     gate. Mapping: `needs-attention → block`,
   *                     `approve → approve`.
   *
   * The orchestrator MUST set both: source preserves auditability,
   * gate preserves the binary contract the merge-gate code wants.
   *
   * Forward-compat: a Claude reviewer arm could share `gateVerdict` with
   * a parallel mapping (`APPROVE → approve`, `REQUEST_CHANGES → block`).
   * That arm is deferred — the field's literal type is shared-shape ready.
   *
   * Audit invariant (ADR-005): the gate decision is the most consequential
   * moment in the pipeline; the JSONL must record what was said exactly,
   * not a summary. ADR-013 §1's "either verdict can REQUEST_CHANGES and
   * block merge" gate is auditable only if the body is verbatim.
   *
   * NQ-4: camelCase (`dispatchId`, `sourceVerdict`, `gateVerdict`).
   * NQ-13: no `Error` field — Codex failures during review route to
   * `codex:unavailable.reason`.
   *
   * Sensitive-content policy (OQ-1): `body` is verbatim, NOT truncated.
   * Symmetric with `codex:request.prompt` / `codex:response.response` per
   * CONCERN-2; reviewer-leaked content is a CWE-532-class trade-off
   * accepted per ADR-005's reconstructability invariant.
   */
  | {
      tag: "codex:verdict";
      payload: {
        dispatchId: string;
        sourceVerdict: "approve" | "needs-attention";
        gateVerdict: "approve" | "block";
        body: string;
      };
    }
  /**
   * Fires when CODE retry-exhaust triggers and the orchestrator dispatches
   * the `codex:codex-rescue` subagent. Distinct from `codex:dispatch`
   * because the rescue path has special containment semantics per
   * RUNBOOK §2 (touched-file allowlist, full TEST + SECURITY re-run, fresh
   * REVIEW face-off) — operational observers want to filter on rescue
   * lifecycle without sifting general dispatches.
   *
   * Audit invariant (ADR-005): full prompt is captured (NOT truncated)
   * because rescue scope is rare and forensically critical — a rescue
   * outcome that "applied" or "reverted-out-of-scope" must be replayable
   * from the JSONL alone. `filesAllowlist` records the diff-allowlist
   * the rescue is bound to so the post-rescue containment check (RUNBOOK
   * §2 step 2) has its inputs in the audit trail.
   *
   * NQ-4: camelCase (`dispatchId`, `filesAllowlist`). NQ-13: no `Error`
   * field — rescue subagent crashes route to `codex:rescue-end` with
   * `outcome: "rescue-error"` (preserves `dispatchId` pairing per OQ-3).
   *
   * Sensitive-content policy: `prompt` is full-body, symmetric with
   * `codex:request.prompt` and `codex:response.response` per CONCERN-2
   * from the retry 1 review. Rescue scope warrants the full forensics
   * trade-off in any case.
   */
  | {
      tag: "codex:rescue-start";
      payload: {
        dispatchId: string;
        prompt: string;
        filesAllowlist: ReadonlyArray<string>;
      };
    }
  /**
   * Fires when the rescue subagent returns. `outcome` discriminates the
   * five rescue-end states from RUNBOOK §2's containment sequence
   * (CONCERN-3 from retry 1 review — v1's `ok | error | timeout` was too
   * coarse to capture the runbook's revert paths). Pairs with
   * `codex:rescue-start.dispatchId`.
   *
   *   `applied`                  — rescue diff was applied; all
   *                                post-rescue TEST + SECURITY + REVIEW
   *                                gates passed (RUNBOOK §2 happy path).
   *   `reverted-out-of-scope`    — rescue touched files outside the
   *                                diff allowlist; orchestrator reverted
   *                                the diff per RUNBOOK §2 step 2.
   *   `reverted-gate-failed`     — touched files were in scope but the
   *                                post-rescue TEST / SECURITY / REVIEW
   *                                gate failed; orchestrator reverted
   *                                the diff per RUNBOOK §2 step 5.
   *   `rescue-error`             — rescue subagent crashed, returned
   *                                malformed output, or the forwarder
   *                                failed.
   *   `timeout`                  — rescue exceeded the orchestrator's
   *                                deadline.
   *
   * Audit invariant (ADR-005): rescue gate outcome is preserved. Per
   * OQ-3 resolution, `rescue-error` and `timeout` outcomes stay on
   * `codex:rescue-end` (not `codex:unavailable`) so the `dispatchId`
   * pairing with `codex:rescue-start` remains intact. `codex:unavailable`
   * is for pre-dispatch unavailability, not mid-rescue failure.
   *
   * NQ-4: camelCase (`dispatchId`, `touchedFiles`, `durationMs`).
   * NQ-13: `error?: Error` round-trips via `errorAwareReplacer` in
   * `log.ts` as `{ name, message, stack }` — never `{}`. The smoke
   * (`codex-events.ts`) asserts this round-trip.
   */
  | {
      tag: "codex:rescue-end";
      payload: {
        dispatchId: string;
        outcome:
          | "applied"
          | "reverted-out-of-scope"
          | "reverted-gate-failed"
          | "rescue-error"
          | "timeout";
        touchedFiles: ReadonlyArray<string>;
        durationMs: number;
        error?: Error;
      };
    }
  /**
   * Fires when the orchestrator skips Codex dispatch because of a
   * pre-dispatch unavailability condition: `/codex:status` reports a
   * degraded operator-side state, the venue-default-skip applies
   * (Mirepoix-secure per ADR-013 §4 + commitment 5), a rate limit, an
   * auth-expired error, an output that fails to parse, or a network
   * timeout. The `reason` enum starts narrow per ADR-013 Known gaps §3
   * (partial outage modes future-extension); adding new reasons in v2
   * is a non-breaking widening of the union literal.
   *
   * Audit invariant (ADR-005): without this arm, "no Codex verdict in
   * this REVIEW" cannot be distinguished from "Codex was dispatched but
   * never returned" — the failure mode ADR-013 Known gaps §3 calls out.
   * The `"mirepoix-secure-default"` reason is the load-bearing forward
   * commitment to RUNBOOK §6 (Mirepoix-secure venue-default-skip).
   *
   * NQ-4: camelCase (`details`, `retryAfterMs`, `attempt`,
   * `maxAttempts`). NQ-13: `error?: Error` round-trips via
   * `errorAwareReplacer` as `{ name, message, stack }`. The smoke
   * asserts this round-trip. Optional because some `unavailable`
   * outcomes are non-error states (`mirepoix-secure-default`,
   * `version-incompatible` from a clean `/codex:status` probe).
   *
   * Retry / partial-outage shape (MISSING-5 from retry 1 review):
   *   `retryAfterMs` — server-suggested delay before the orchestrator
   *                    should retry. Mirrors HTTP 429's `Retry-After`
   *                    semantics. Most relevant when `reason` is
   *                    `rate-limit` or `timeout`. Optional because not
   *                    every unavailability path supplies a hint.
   *   `attempt`      — current attempt number, 1-indexed.
   *   `maxAttempts`  — configured retry ceiling. Together with `attempt`
   *                    these let the orchestrator decide whether to
   *                    retry (`attempt < maxAttempts`) or fail-permanent
   *                    (`attempt === maxAttempts`). ADR-013 Known gaps §3
   *                    names partial-outage modes as a MEDIUM gap; these
   *                    fields are the type surface for that work.
   */
  | {
      tag: "codex:unavailable";
      payload: {
        reason:
          | "not-installed"
          | "not-authenticated"
          | "version-incompatible"
          | "mirepoix-secure-default"
          | "rate-limit"
          | "timeout"
          | "auth-expired"
          | "malformed-output"
          | "other";
        details?: string;
        error?: Error;
        retryAfterMs?: number;
        attempt?: number;
        maxAttempts?: number;
      };
    };

/** Convenience alias for the set of kernel event tags. */
export type EventTag = MirepoixEvent["tag"];

/** Extract the payload type for a given event tag. */
export type PayloadOf<T extends EventTag, E extends BaseEvent = MirepoixEvent> = Extract<
  E,
  { tag: T }
>["payload"];
