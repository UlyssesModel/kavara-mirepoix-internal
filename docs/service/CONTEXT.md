# Service — Supporting Subdomain CONTEXT.md

| | |
|---|---|
| **Subdomain classification** | Supporting (per [ADR-015 §39](../../adrs/ADR-015-mirepoix-as-acp-server.md)) |
| **Promoted to active** | [`sub-phase-service-context-skeleton`](../../specs/sub-phase-service-context-skeleton.md) — fifth bounded context via R18 in [`CONTEXT-MAP.md`](../../CONTEXT-MAP.md) |
| **Canonical-term population state** | **Skeleton** — first Service-context grilling session pending. Paired with F4 ([#24](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/24)) and F5 ([#25](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/25)). |
| **Maintenance posture** | Inline during `/grill-with-docs` sessions per [ADR-014 §52](../../adrs/ADR-014-domain-driven-design-adoption.md). Every ADR-015 deliverable sub-phase (1, 2, 4, 5, 6) updates this file inline when it resolves new vocabulary — see CONTEXT-MAP.md watch-list R18. |

This document is the per-context vocabulary artifact for the Service bounded context (CONTEXT-MAP.md row 5 of 5). Until the first grilling session against the Service context lands, all term entries below are **placeholders** carrying the wording from [ADR-015 §39](../../adrs/ADR-015-mirepoix-as-acp-server.md). Do not treat them as canonical; they exist so v0.2.0 implementation work has a target for inline updates as terms accrue.

## Boundary

The Service context owns multi-tenant hosting, ACP-server operations, attestation manifest *consumption*, and the commercialization concerns that v0.2.0 productizes — distinct from Harness (the `@mirepoix/*` package surface and the JSONL wire it publishes), from Deployment (the venue posture and host operation that runs the Harness), from Tooling (the runtimes consumed at session-time by Claude Code or a future Mirepoix CLI), and from Pipeline (the methodology and artifacts producing PRs).

Per [ADR-015 §39](../../adrs/ADR-015-mirepoix-as-acp-server.md), the Service context covers:

- tenant identity & routing;
- authentication & authorization (initially v0.2.0 single-tenant via operator-owned API keys; v0.2.1 multi-tenant via OIDC/SAML/passkey);
- metering & billing (per-session counts, per-methodology-feature gating, per-tool-call cost attribution);
- per-tenant resource quotas;
- per-tenant data residency policies;
- the API surface beyond ACP itself (admin endpoints, billing webhooks, audit-log export).

The Service context is a Supporting Subdomain — necessary infrastructure that supports the Core Domain (Harness), with operational rigor and well-defined boundary contracts, but where invention happens only where the commercial proposition demands it (e.g., metering shape) and not where commodity solutions exist (e.g., OIDC).

The boundary with Deployment is the most contended of the four edges (F5 / [#25](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/25)). Deployment owns "where Mirepoix runs"; Service owns "what Mirepoix offers as a hosted surface". Both touch venue-specific behavior, the deny-all-egress posture, and attestation; the formal cut lives in [`CONTEXT-MAP.md`](../../CONTEXT-MAP.md) integration-patterns once the first grilling session locks it.

## Seed vocabulary (placeholders pending first grilling session)

> **State:** every entry below is a placeholder carrying ADR-015 §39 wording. The first Service-context grilling session canonicalizes; until then, treat as structurally-addressable-but-not-binding. Grep target: `placeholder; ADR-015`.

- **tenant identity & routing** — placeholder; [ADR-015 §39](../../adrs/ADR-015-mirepoix-as-acp-server.md) + §41. v0.2.0 single-tenant via the `tenant: "solo-operator"` shape; v0.2.1 multi-tenant.
- **authentication & authorization** — placeholder; [ADR-015 §41](../../adrs/ADR-015-mirepoix-as-acp-server.md). v0.2.0 single-tenant via operator-owned API keys; v0.2.1 multi-tenant via OIDC/SAML/passkey/BYOK.
- **metering & billing** — placeholder; [ADR-015 §39](../../adrs/ADR-015-mirepoix-as-acp-server.md) + §91. Deliverable 4 lands eight `acp:*` event arms: `acp:session-init`, `acp:session-prompt`, `acp:session-cancel`, `acp:session-load`, `acp:tool-call`, `acp:tool-call-update`, `acp:request-permission`, `acp:metering-tick`. Per-session, per-tool-call, per-methodology-feature attribution.
- **per-tenant resource quotas** — placeholder; [ADR-015 §39](../../adrs/ADR-015-mirepoix-as-acp-server.md).
- **per-tenant data residency** — placeholder; [ADR-015 §39](../../adrs/ADR-015-mirepoix-as-acp-server.md) + §105 (HIGH-risk deferred concern).
- **API surface beyond ACP** — placeholder; [ADR-015 §39](../../adrs/ADR-015-mirepoix-as-acp-server.md). Admin endpoints, billing webhooks, audit-log export.
- **single-tenant `solo-operator` placeholder** — [ADR-015 §41](../../adrs/ADR-015-mirepoix-as-acp-server.md). v0.2.0 ships with `tenant: "solo-operator"` so v0.2.1's multi-tenant plug-in does not require rewriting the server shape. The deferred-but-shaped pattern.

## Attestation vocabulary (deferred to F4 / [#24](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/24))

The attestation-manifest terms (`attestation manifest`, `attestation field`, `attestation evidence`) belong in this CONTEXT.md per F4. They are not populated in the skeleton; see [#24](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/24) for the canonicalization work. Once F4 lands, this section becomes a sibling of "Seed vocabulary" with the canonical terms, an [ADR-011](../../adrs/ADR-011-attestation-enforcement.md) vocabulary-ratification footer cross-reference, and the drifted-uses table.

## Integration edges (placeholders — see [`CONTEXT-MAP.md`](../../CONTEXT-MAP.md))

Four edges connect the Service context to the rest of the bounded-context map. Their DDD-pattern classification is deferred to the first Service-context grilling session; CONTEXT-MAP.md is the authoritative location for the placeholder entries and (eventually) the locked classifications. Quick references:

- **Service ↔ Harness** — `@mirepoix/acp-server` is in Harness; the ACP client surface is in Service. Candidate pattern: Conformist.
- **Service ↔ Deployment** — F5 / [#25](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/25). Candidate pattern: Conformist + venue overlay.
- **Service ↔ Tooling** — F3 / [#23](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/23) resolves here (Codex face-off availability under cross-tier ACP). Candidate pattern: Anti-Corruption Layer.
- **Service ↔ Pipeline** — v0.2.0 sub-phases flow through on-loop like any Harness work. Candidate pattern: Customer/Supplier.

## How this document is maintained

Per [ADR-014 §52](../../adrs/ADR-014-domain-driven-design-adoption.md), this document is updated **inline during `/grill-with-docs` sessions, never batched**. Every ADR-015 deliverable sub-phase (1, 2, 4, 5, 6) is expected to update this file inline when it resolves new vocabulary — the skeleton's placeholder seed vocabulary becomes canonical incrementally, not in one batched grilling pass at the end of v0.2.0.

The first dedicated Service-context grilling session is queued, paired with F4 ([#24](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/24)) and F5 ([#25](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/25)) per the post-merge grilling doc's followup queue ([`docs/grilling/adr-011-015-post-merge-grilling.md`](../grilling/adr-011-015-post-merge-grilling.md)).

## Cross-references

- [ADR-015](../../adrs/ADR-015-mirepoix-as-acp-server.md) — promotion source; §39 (charter), §41 (single-tenant v0.2.0 shape), §89 (skeleton deliverable), §91 (metering hooks deliverable), §105 (data residency deferred concern).
- [ADR-014](../../adrs/ADR-014-domain-driven-design-adoption.md) — DDD discipline; §26-34 (bounded contexts), §52 (inline maintenance).
- [ADR-011](../../adrs/ADR-011-attestation-enforcement.md) — attestation enforcement; attestation-manifest vocabulary lives here once F4 canonicalizes.
- [ADR-013](../../adrs/ADR-013-codex-as-teammate.md) — Codex as teammate; F3 ([#23](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/23)) reconciliation lives on the Service ↔ Tooling edge.
- [ADR-010](../../adrs/ADR-010-mirepoix-secure-and-scotty-gpu-pilot.md) — Mirepoix-secure posture; F2 ([#22](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/22)) ACP-server-on-locked-host posture lives on the Service ↔ Deployment edge.
- [`CONTEXT-MAP.md`](../../CONTEXT-MAP.md) — five-bounded-contexts map; R18 records this context's promotion.
- [`sub-phase-service-context-skeleton`](../../specs/sub-phase-service-context-skeleton.md) — the spec that produced this file.
- [`docs/grilling/adr-011-015-post-merge-grilling.md`](../grilling/adr-011-015-post-merge-grilling.md) — F1-F6 followup queue; F3 / F4 / F5 land vocabulary into this file.
