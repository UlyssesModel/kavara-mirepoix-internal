# Post-merge grilling: ADR-011 + ADR-015

**Date:** 2026-05-19
**Trigger:** PR #19 merged single-author without ADR-013 face-off review
**Methodology:** grill-with-docs pattern (per memory: `mirepoix_grill_with_docs_pattern.md`)
**Yield:** 12 findings (above the 4-6 expected — merged surface was two strategic ADRs, not a single sub-phase)

## Footguns (2)

**F1 — `scotty-gpu` TDX capability load-bearing for ADR-011 but unverified.** ADR-011 commits GCP TDX as the v1 substrate profile. `scotty-gpu` is an A100 GPU host (NVIDIA), and TDX is an Intel CPU feature. If `scotty-gpu`'s instance type does not include TDX, Mirepoix-secure deployments cannot pass the attestation gate.
**Remediation:** NEW ISSUE — verify `scotty-gpu`'s instance type and confidential-compute capability; amend ADR-011 if needed.

**F2 — ACP-server-on-locked-host vs ADR-010 deny-all-egress.** ADR-015 commitment six commits a local `@mirepoix/acp-server` on the locked host; ADR-010 commits deny-all-egress. The architectural claim that ingress-only operation does not weaken the egress posture is implicit, not explicit.
**Remediation:** NEW COMMIT — Mirepoix-secure runbook gains a "Local ACP server posture" subsection.

## Methodology bugs (4)

**F3 — Face-off semantics for Mirepoix Cloud across venue postures.** ADR-013 commitment four says Codex teammate is Mirepoix-build only; ADR-015 commitment seven says all ACP clients get face-off automatically. Composition contradiction for Mirepoix Cloud customers on Mirepoix-secure infrastructure.
**Remediation:** NEW ISSUE — cross-ADR reconciliation between ADR-013 and ADR-015.

**F4 — Attestation vocabulary drift.** "Attestation manifest", "declaration", "field", "evidence" used interchangeably in ADR-011. Per ADR-014 Ubiquitous Language discipline these need canonical resolution.
**Remediation:** NEW ISSUE — populate canonical attestation terms in `docs/service/CONTEXT.md` once Service context skeleton ships.

**F5 — Service vs Deployment bounded-context boundary fuzzy.** ADR-015's new Service context overlaps with ADR-014's Deployment context. Distinction is sound but not formalized.
**Remediation:** NEW ISSUE — populate `CONTEXT-MAP.md` with explicit Service ↔ Deployment boundary.

**F6 — Mirepoix `verify-attestation` aligned to Kirk-real verifier that may not exist yet.** ADR-011 commits "identical to" a Confluence PE/111017985 tool currently in "Proposed — JE to accept / amend" status.
**Remediation:** NEW ISSUE — verify Kirk-real verifier status; reframe as co-design if it's design-only.

## Ratifications (6)

**R1** — Publication pipeline tool depends on `@mirepoix/cli` not fully built (Implementation Note 1 names this).

**R2** — Audit-trail gravity-of-three coupling is fragile to future attestation-storage changes (accept; future ADRs must re-evaluate).

**R3** — Customer-side existing-bundle handling is intentionally silent (forward-only enforcement).

**R4** — Service bounded context is speculative DDD application (accept; first implementation sub-phase grills the boundary).

**R5** — v0.2.0 → v0.2.1 timeline unspecified (accept; success criteria do not depend on v0.2.1).

**R6** — Implicit framework alignment between `verify-attestation` and Mirepoix Cloud web frontend (note for future web-frontend ADR).

## Followup queue

Six new GitHub issues filed (F1-F6); F2's remediation is a small runbook commit, tracked under its issue.

| Finding | Issue                                                                                   | Remediation kind                    |
| ------- | --------------------------------------------------------------------------------------- | ----------------------------------- |
| F1      | [#21](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/21)               | Verification + possible ADR amend   |
| F2      | [#22](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/22)               | Small runbook commit                |
| F3      | [#23](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/23)               | New ADR (likely ADR-016)            |
| F4      | [#24](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/24)               | CONTEXT.md population + ADR footer  |
| F5      | [#25](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/25)               | CONTEXT-MAP.md population           |
| F6      | [#26](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/26)               | Status check + ADR amend / footnote |

F4 and F5 are paired (both are CONTEXT.md work on the same merged-ADR origin) and should be tackled in the same on-loop run after [#15](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/15) lands.
