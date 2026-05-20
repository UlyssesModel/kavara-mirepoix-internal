# Sub-phase: Service bounded-context skeleton

## Status

Phase: v0.2.0 implementation, sub-phase 1 of 6 (the
[ADR-015](adrs/ADR-015-mirepoix-as-acp-server.md) implementation deliverable
sequence). **Implementation deliverable 3** per ADR-015 §89 — the
Service bounded-context skeleton. Sequenced first inside v0.2.0 because
deliverables 1 (`@mirepoix/acp-server`), 4 (metering hooks), and 5
(Mirepoix Cloud web frontend) all need a place in the bounded-context
map before they can land without re-grilling the map mid-implementation.

Pre-OQ snapshot per the spec-resolution convention (commit `1a83a67`).
The resolved contract lives in this file's `## Open Questions (OQs)` and
`## Negative Questions (NQs)` resolutions plus the merged PR body.

**Scope discipline:** this sub-phase ships a *skeleton*, not the first
grilling session against the Service context. Per ADR-015 §89, "The
first grilling session against the Service context populates the
canonical terms." That session is a separate run (likely paired with
issues [#24](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/24)
(F4) and [#25](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/25)
(F5) per the F1-F6 followup queue).

## Context

[ADR-015](adrs/ADR-015-mirepoix-as-acp-server.md) (merged 2026-05-19, PR
#19) introduces a fifth bounded context — **Service** — to own the
multi-tenant, hosting, and commercialization concerns that v0.2.0
productizes. ADR-015 §39 (commitment 4) names the Service context's
charter; §89 (implementation note 3) commits the skeleton as the third
v0.2.0 sub-phase.

The four-context map already exists. [CONTEXT-MAP.md](CONTEXT-MAP.md)
landed via [#15](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/15)
/ PR #15 (commit `791f034`) with Harness, Deployment, Tooling, and
Pipeline declared and integration-pattern-classified. **Per-context
`CONTEXT.md` files for those four were explicitly out of scope for #15**
(CONTEXT-MAP.md line 13: "The per-context `CONTEXT.md` files (one per
bounded context) are out of scope for this delivery"). They are scoped
to follow-up grilling sessions, seeded from the per-context annexes
inside CONTEXT-MAP.md.

The Service context arrives in a different posture from the other four:
ADR-015 brings the context into existence *before* the first grilling
session. The skeleton's job is to make the context **structurally
addressable** — a row in the bounded-contexts table, a seed annex, a
path on disk for `docs/service/CONTEXT.md` — so that v0.2.0's
implementation work (deliverables 1, 2, 4, 5, 6) has somewhere to put
vocabulary as it accumulates, and so the first grilling session has a
target file to populate.

CONTEXT-MAP.md §304-318 names **Distribution / Licensing** as a
*candidate* fifth context (R17), with promotion trigger "Phase Four
bundler operational." ADR-015 commits Service as a fifth context with a
*different* promotion trigger — v0.2.0 productization. These do not
collide: Service is the fifth context landing now; Distribution remains
a candidate sixth context whose trigger has not yet fired. The
skeleton's CONTEXT-MAP.md update must reflect this clearly so future
grilling does not re-litigate.

<task>
Land the Service bounded-context skeleton:

1. Update `CONTEXT-MAP.md` to declare Service as the fifth bounded
   context, sequenced alongside the existing four. Add a row to the
   bounded-contexts table; add a Service annex with seed vocabulary
   drawn from ADR-015 §39; update the "Candidate future contexts"
   section so Distribution is recognized as candidate-sixth (not
   candidate-fifth). The integration-edges section gains four new edges
   (Service ↔ {Harness, Deployment, Tooling, Pipeline}) as
   **placeholders** with the DDD-pattern classification deferred to
   the first grilling session — placeholders so the structure is
   present; classification deferred because the load-bearing
   integration-pattern choice (Customer/Supplier? Conformist?
   Anti-Corruption Layer?) is exactly the grilling session's job.

2. Create `docs/service/CONTEXT.md` as a new file with the canonical
   skeleton shape: a `## Status` block, a `## Boundary` paragraph
   sourced from ADR-015 §39, a `## Seed vocabulary` section listing
   the seven placeholder concepts ADR-015 names (tenant identity &
   routing; authentication & authorization; metering & billing;
   per-tenant resource quotas; per-tenant data residency; API surface
   beyond ACP; v0.2.0 single-tenant `solo-operator` placeholder), and
   a `## Cross-references` section pointing to ADR-015, CONTEXT-MAP.md,
   and ADR-014.

3. Pure documentation work. No package source changes. No code, no
   tests, no CI workflow additions. The deliverable-tracking check
   (`scripts/check-deliverables.sh`) and Biome lint must pass without
   modification.
</task>

<grounding_rules>

This spec is bound to the following source locations. Line numbers
reflect HEAD on branch `sub-phase/service-context-skeleton` (forked from
`main`, latest commit `4202028` on main).

- **[ADR-015](adrs/ADR-015-mirepoix-as-acp-server.md)** —
  - §24 (commitment 1): Mirepoix v0.2.0 ships as an ACP server.
  - §39 (commitment 4): the Service context's charter — tenant
    identity & routing, authentication & authorization, metering &
    billing, per-tenant resource quotas, per-tenant data residency,
    API surface beyond ACP.
  - §41 (commitment 5): single-tenant v0.2.0; tenant-aware shape
    (`tenant: "solo-operator"`) without retrofitting.
  - §89 (implementation note 3): "Service bounded context skeleton.
    CONTEXT-MAP.md is updated to declare the fifth context;
    `docs/service/CONTEXT.md` ships with placeholders … the first
    grilling session against the Service context populates the
    canonical terms." This is THE deliverable.

- **[CONTEXT-MAP.md](CONTEXT-MAP.md)** (commit `791f034`) —
  - Lines 41-50: "The four bounded contexts" table (Harness /
    Deployment / Tooling / Pipeline). Becomes "The five bounded
    contexts" with the Service row added.
  - Lines 154-196: integration-patterns section, six current edges.
    Service adds four edges; placeholders for now.
  - Lines 198-292: per-context annexes (Harness §202, Tooling §226,
    Pipeline §247, Deployment §269). The Service annex slots in
    after Deployment.
  - Lines 304-318: "Candidate future contexts" — Distribution / R17.
    Update: Distribution is candidate-sixth, not candidate-fifth.
  - Lines 13, 293-302: scope-of-#15 note + watch list. The watch
    list gains an entry on Service context maintenance posture.

- **[ADR-014](adrs/ADR-014-domain-driven-design-adoption.md)** —
  - §26-34: bounded-context discipline. Service must conform to
    the same shape (Subdomain classification + boundary + seed
    vocabulary + integration patterns).
  - §52 + §24: maintenance discipline — inline during
    `/grill-with-docs` sessions, never batched. The skeleton honors
    this by *not* populating canonical terms (that's grilling work);
    it only commits structure.

- **F4 ([#24](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/24))** —
  attestation vocabulary in `docs/service/CONTEXT.md`. Out of scope
  for the skeleton (placeholder for `attestation manifest` /
  `attestation field` / `attestation evidence` is allowed; the
  canonical resolution is the grilling session's job).

- **F5 ([#25](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/25))** —
  Service ↔ Deployment boundary formalization in CONTEXT-MAP.md. The
  skeleton ships the edge as a *placeholder*; the formalization
  (exclusive boundaries, shared/translated terms, ACL-or-not) is the
  first grilling session's job, paired with F4.

</grounding_rules>

## Goal

After this sub-phase lands:

1. `CONTEXT-MAP.md` declares five bounded contexts. The Service row
   has a Subdomain classification (Supporting, per ADR-015 §39:
   "Supporting Subdomain per the ADR-014 Subdomain-classification
   axis"), a one-line ownership statement, and a path
   (`docs/service/CONTEXT.md`).
2. `docs/service/CONTEXT.md` exists as a structurally-complete
   skeleton — same H2 sections as the other four annexes would
   produce when fully populated, but with explicit "skeleton; first
   grilling session populates canonical terms" status banners.
3. The integration-patterns section has four Service edges with
   placeholder DDD-classifications that the first grilling session
   will lock.
4. The "Candidate future contexts" section recognizes Distribution as
   candidate-**sixth**, with the same R17 trigger ("Phase Four bundler
   operational") preserved.
5. The deliverable-tracking CI check passes. No code, lint, type, or
   test gates are touched.

## Concrete work

### Concern 1 → `CONTEXT-MAP.md` — five-context update

Specific edits (load-bearing structure only; non-trivial wording is
the architect's call during SPEC phase):

- **Status table (lines 3-9).** Append a row recording this sub-phase
  as the delivery vector for the fifth-context promotion.
- **Resolution provenance (lines 15-39).** Add a new resolution row
  for the Service promotion — likely **R18: Service context promoted
  from candidate to active per ADR-015**. The architect lays out the
  R18 row; the integration-pattern resolutions for the four new edges
  are NOT R18 (they are first-grilling-session resolutions and will
  get their own R-tags then).
- **"The four bounded contexts" → "The five bounded contexts"
  (lines 41-50).** Rename the section heading; add a Service row to
  the table:
    | **Service** | Supporting | Multi-tenant hosting, ACP server
    operations, attestation manifest consumption, commercialization
    concerns | `docs/service/CONTEXT.md` |
- **Cross-context glossary (lines 62-152).** No additions in the
  skeleton — `tenant`, `attestation manifest`, etc. land in the
  grilling session, not here. Architect verifies during SPEC.
- **Integration patterns (lines 154-196).** Add a "Service ↔ {Harness,
  Deployment, Tooling, Pipeline}" sub-section with four new edges,
  each tagged `(placeholder — DDD pattern classification deferred to
  first grilling session)`. Brief one-line description of what flows
  across each edge is allowed; the binding pattern classification is
  NOT.
- **Per-context annexes (lines 198-292).** Add a "Service —
  Supporting Subdomain (`docs/service/CONTEXT.md`)" annex after
  Deployment. The annex matches the shape of the other four
  (boundary statement + seed vocabulary list) but the seed vocabulary
  is the seven ADR-015 §39 concepts, each marked as a placeholder.
- **Watch list (lines 293-302).** Add an entry: "Service context
  maintenance posture during v0.2.0 implementation — every
  deliverable 1/2/4/5/6 sub-phase should update the Service annex
  inline when it resolves new terms, per the ADR-014 §52 discipline."
- **Candidate future contexts (lines 304-318).** Rename the
  Distribution / Licensing section header from "candidate fifth
  context" to **"candidate sixth context"**. Update the section's
  intro paragraph similarly. Preserve the R17 promotion-trigger
  rubric verbatim — the trigger has not changed, only the ordinal.

### Concern 2 → `docs/service/CONTEXT.md` — new skeleton file

File path: `docs/service/CONTEXT.md` (named by ADR-015 §89).
Architect creates the directory if not present.

Skeleton structure (no canonical-term population; status banners
make the skeleton state explicit):

```markdown
# Service — Supporting Subdomain CONTEXT.md

## Status

| | |
|---|---|
| **Subdomain classification** | Supporting (per ADR-015 §39) |
| **Promoted to active** | <PR-link to this sub-phase> |
| **Canonical-term population state** | Skeleton — first grilling session pending |
| **Maintenance posture** | Inline during `/grill-with-docs` sessions per ADR-014 §52 |

This document is the per-context vocabulary artifact for the Service
bounded context (CONTEXT-MAP.md row 5 of 5). Until the first
grilling session against the Service context lands, all term entries
below are **placeholders** carrying the wording from ADR-015 §39.
Do not treat them as canonical; they exist so v0.2.0 implementation
work has a target for inline updates.

## Boundary

[One paragraph sourced from ADR-015 §39 — multi-tenant hosting,
ACP-server operations, attestation manifest consumption, the
commercialization concerns that v0.2.0 productizes. Architect
expands to fit.]

## Seed vocabulary (placeholders pending first grilling session)

- **tenant identity & routing** — placeholder; ADR-015 §39 + §41.
- **authentication & authorization** — placeholder; ADR-015 §41
  (v0.2.0 single-tenant via operator-owned API keys; v0.2.1
  multi-tenant via OIDC/SAML/passkey).
- **metering & billing** — placeholder; ADR-015 §39 + §91
  (deliverable 4: `acp:*` event arms; per-session, per-tool-call,
  per-methodology-feature attribution).
- **per-tenant resource quotas** — placeholder; ADR-015 §39.
- **per-tenant data residency** — placeholder; ADR-015 §39 + §105
  (HIGH-risk deferred concern).
- **API surface beyond ACP** — placeholder; ADR-015 §39 (admin
  endpoints, billing webhooks, audit-log export).
- **single-tenant `solo-operator` placeholder** — ADR-015 §41:
  v0.2.0 ships with `tenant: "solo-operator"` so v0.2.1's
  multi-tenant plug-in does not require rewriting the server shape.

## Attestation vocabulary (deferred to F4 / issue #24)

The attestation-manifest terms (manifest, field, evidence) belong in
this CONTEXT.md per F4. They are not populated in the skeleton; see
issue #24 for the canonicalization work.

## Cross-references

- [ADR-015](../../adrs/ADR-015-mirepoix-as-acp-server.md) — promotion source.
- [CONTEXT-MAP.md](../../CONTEXT-MAP.md) — bounded-context map.
- [ADR-014](../../adrs/ADR-014-domain-driven-design-adoption.md) — DDD discipline.
- [ADR-011](../../adrs/ADR-011-attestation-enforcement.md) — attestation enforcement
  whose manifest vocabulary lives here once canonicalized.
```

The skeleton intentionally does NOT:

- Lock DDD integration patterns for the four new edges (architect
  resists during SPEC; the patterns are F5 / grilling-session work).
- Canonicalize "manifest" / "field" / "evidence" (F4 / issue #24).
- Add `tenant` / `attestation manifest` to the CONTEXT-MAP.md
  cross-context glossary (grilling-session work).
- Specify file location for `docs/service/`'s parent — ADR-015 names
  the path `docs/service/CONTEXT.md`; the directory is created.

## Open Questions (OQs)

Architect resolves during SPEC phase; resolutions land in the merge
commit's PR body per the spec-resolution convention.

**OQ-1.** **Service annex seed-vocabulary depth.** The other four
context annexes in CONTEXT-MAP.md range from 6 entries (Deployment)
to 17 entries (Harness, after R12 expanded it). The Service annex
under this skeleton should target ~7 entries (the seven ADR-015 §39
concepts). Is that the right depth, or should the skeleton mirror
Harness's depth by pre-listing what the v0.2.0 deliverables 1/2/4/5/6
will plausibly contribute (e.g., "tool-call metering" from
deliverable 4, "stdio transport binding" from deliverable 1, etc.)?
**Recommendation:** stay at the seven ADR-015-named concepts. Adding
forward-looking terms is the grilling session's job; the skeleton
ships what ADR-015 §39 explicitly names.

**OQ-2.** **Distribution candidate ordinal in CONTEXT-MAP.md
"Candidate future contexts" section.** Today the section reads
"candidate fifth context"; the skeleton renames this to "candidate
sixth context" since Service is the fifth. **Does the R17
text need any other tightening** beyond the ordinal rename — for
example, does the promotion-trigger rubric ("Phase Four bundler
operational") need a note acknowledging that "fifth" was occupied by
a different context (Service) than Distribution? **Recommendation:**
add a single sentence: "Distribution was originally posited as the
candidate fifth context (R17). Service landed as the fifth context
via ADR-015 in 2026-05; Distribution is now candidate-sixth, with
the R17 promotion trigger unchanged."

**OQ-3.** **`docs/service/CONTEXT.md` directory creation.** The
existing per-context-annex paths from CONTEXT-MAP.md table:
`docs/deployment/CONTEXT.md`, `docs/tooling/CONTEXT.md`,
`docs/pipeline/CONTEXT.md` — none of these directories exist on disk
yet either (#15 was explicit about per-context CONTEXT.md being
out-of-scope). The skeleton creates `docs/service/` ahead of the
other three. **Is that fine, or should we batch-create the other
three skeletons in the same PR for consistency?** **Recommendation:**
ship only `docs/service/CONTEXT.md` here. The other three are
explicitly the scope of follow-up grilling sessions per #15;
pre-creating empty skeletons for them would over-commit to a
structural choice (skeleton-first vs grilling-first) that the
operator may want to make per-context, not en bloc.

**OQ-4.** **Integration-edge placeholder wording in CONTEXT-MAP.md.**
The four new Service edges have placeholder DDD classifications.
**What wording marks a placeholder unambiguously?** Candidates:
`(placeholder — DDD pattern deferred to first Service grilling
session)`; `(TBD — see issue #25)`; an italicized note. **The
load-bearing requirement** is that automated tooling or a future
operator can grep for the placeholders later and know they are
deferred-not-decided. **Recommendation:** the explicit
`(placeholder — DDD pattern deferred to first Service grilling
session)` form, because it names the gating event (grilling session)
and a grep for "placeholder" surfaces all four edges deterministically.

## Negative Questions (NQs)

Locked decisions. Recorded inline.

**NQ-1.** **Skeleton ≠ first grilling session.** This sub-phase does
NOT populate canonical terms. The seven seed-vocabulary entries in
`docs/service/CONTEXT.md` carry ADR-015 §39 wording verbatim and are
marked as placeholders. The canonical-term work is a separate
on-loop run, paired with F4 (#24) and F5 (#25).

**NQ-2.** **No DDD-pattern classification for the four new
integration edges.** Service ↔ {Harness, Deployment, Tooling,
Pipeline} get placeholder entries in the CONTEXT-MAP integration
section; the binding pattern (Customer/Supplier vs Conformist vs
Anti-Corruption Layer vs Partnership vs Published Language vs
Separate Ways) is the first grilling session's job. Locking
classifications here would foreclose grilling-session findings.

**NQ-3.** **No cross-context-glossary additions.** Terms like
`tenant`, `attestation manifest`, `metering tick` belong in the
cross-context glossary if they appear in more than one context's
vocabulary. They do not appear in the four current contexts'
vocabularies yet. The skeleton does NOT add them; that's the
grilling session's job, after the term has actually appeared in
multiple contexts and the collision is real.

**NQ-4.** **No code in `packages/`.** This sub-phase is pure
documentation. The architect MUST refuse `Edit` calls against any
`packages/*/src/` path. (If a future Service-context concept ends up
implicating a code change — e.g., a new `MirepoixEvent` arm for
`acp:*` — that work lands in deliverable 1 or deliverable 4, not
here.)

**NQ-5.** **No CI workflow additions.** The deliverable-tracking
check at `scripts/check-deliverables.sh` and the existing Biome /
TypeScript jobs are sufficient. The architect MUST refuse to add
new jobs (e.g., "lint CONTEXT.md schema") in this sub-phase. A
future iteration may add such jobs once the skeleton-vs-populated
distinction is more codified, but that decision is its own ADR or
spec.

**NQ-6.** **No Distribution-context decisions.** R17 stays as-is
modulo the candidate-fifth → candidate-sixth ordinal rename. The
trigger ("Phase Four bundler operational") is unchanged. Whether to
promote Distribution is genuinely out of scope.

**NQ-7.** **No retroactive changes to the four existing annexes
(Harness, Deployment, Tooling, Pipeline).** Their seed-vocabulary
lists may have terms that, with Service in the map, would arguably
belong in Service instead — but those re-classifications are the
first grilling session's job, not this skeleton's. The skeleton
modifies CONTEXT-MAP.md additively only (new rows, new section,
ordinal rename); the existing four annexes are not edited.

## Acceptance

A green sub-phase requires all of the following:

1. **`scripts/check-deliverables.sh specs/sub-phase-service-context-skeleton.md`
   exits 0**, with all three listed deliverables present and git-tracked.
2. **`CONTEXT-MAP.md` opens with a five-context table** (not four).
   The Service row has Subdomain classification "Supporting", an
   ownership statement traceable to ADR-015 §39, and a path
   `docs/service/CONTEXT.md`.
3. **`docs/service/CONTEXT.md` exists** at the named path with the
   skeleton sections in this spec's Concern 2 block. Each placeholder
   entry carries a "skeleton — see first grilling session" marker.
4. **Four new integration edges** appear in CONTEXT-MAP.md
   integration-patterns section, each marked as placeholder per OQ-4
   resolution.
5. **R17 (candidate Distribution context)** renamed to
   "candidate sixth context"; promotion trigger unchanged.
6. **No diffs** under `packages/`, `scripts/`, or `.github/`.
7. **Biome `ci .` passes** (clean markdown).
8. **Per-package `bunx tsc --noEmit` passes** for each of `ai`,
   `coding`, `core`, `cli` (sanity: no doc change ought to touch
   typed surface, but the check is cheap).
9. **PR description includes** the four OQ resolutions plus a
   `Closes / Refs:` line for ADR-015 implementation deliverable 3.
   (No GitHub issue exists for deliverable 3 specifically; if one is
   filed pre-merge it gets cross-linked.)

## Deliverables

Files this sub-phase commits to the repository tree:

- `specs/sub-phase-service-context-skeleton.md`
- `CONTEXT-MAP.md`
- `docs/service/CONTEXT.md`

`scripts/check-deliverables.sh` should pass against this `## Deliverables`
section.

## Key references

- [ADR-015](adrs/ADR-015-mirepoix-as-acp-server.md) §39 (Service
  context charter), §89 (deliverable 3 commitment).
- [ADR-014](adrs/ADR-014-domain-driven-design-adoption.md) §26-34
  (bounded-context discipline), §52 (inline-maintenance discipline).
- [CONTEXT-MAP.md](CONTEXT-MAP.md) — current four-context map; this
  sub-phase extends to five.
- [Issue #15](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/15)
  — bootstrap delivery that scoped per-context CONTEXT.md files
  out and seeded the per-context annexes Service now joins.
- [Issue #24 / F4](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/24)
  — attestation vocabulary canonicalization (paired follow-up).
- [Issue #25 / F5](https://github.com/UlyssesModel/kavara-mirepoix-internal/issues/25)
  — Service ↔ Deployment boundary formalization (paired follow-up).
- Post-merge grilling doc: [`docs/grilling/adr-011-015-post-merge-grilling.md`](docs/grilling/adr-011-015-post-merge-grilling.md)
  — F4 + F5 origin.
- Multi-agent face-off discipline per
  [ADR-013](adrs/ADR-013-codex-as-teammate.md) — applies to the
  REVIEW phase of this sub-phase's on-loop run.
