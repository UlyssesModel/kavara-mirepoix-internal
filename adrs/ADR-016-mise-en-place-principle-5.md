# ADR-016: mise-en-place Principle 5 — Justified Action (Five Whys)

Status: Accepted
Date: 2026-05-20
Deciders: John Edge (CTO)
Supersedes: none — extends the mise-en-place contract structure established at v0.1.0

## Context

mise-en-place v0.1.0 through v0.4.0 ships with four behavioral principles, kept verbatim from Andrej Karpathy's published CLAUDE.md skill content (forrestchang/andrej-karpathy-skills). The LICENSE and contract.md are explicit about the lineage: principles #1 through #4 are adopted upstream content, structurally invariant within mise-en-place. Kavara's contributions sit at two other layers — the eight operating modes (Section 5 of the contract through v0.4.0) and the five Mirepoix addenda (Section 6 through v0.4.0; addendum #5 — Multi-agent review — landed at v0.4.0 on 2026-05-15).

The four Karpathy principles cover *how to act once you have decided to act*: think first, prefer simplicity, change surgically, drive toward a goal. They do not cover *whether to act in the first place*. The implicit assumption is that the operator has already justified the work; the principles shape how the work proceeds.

Two recent operational signals make the implicit-justification gap costly:

The PR #19 single-author merge (2026-05-19, in kavara-mirepoix-internal) was a methodology discipline failure recovered via post-merge grilling that produced 12 findings. The proximate cause was "operator forgot to dispatch Codex teammate." Five iterations of "why" reveal a different root cause: methodology discipline (face-off) outran the tooling that enables it (Codex CLI bootstrap), and the operator's individual action was the visible symptom of a structural infrastructure lag. The original analysis stopped at "human error" — the structural root cause was only surfaced through subsequent grilling.

The ADR-014 Follow-up 3 lag (2026-05-16 to 2026-05-20) is a second instance. ADR-014's text explicitly committed to a Confluence sibling page within days of the ADR landing. The page didn't ship for four days. Surface analysis: "operator was busy." Five-iteration analysis: ADR-follow-ups did not get explicit ticketing at landing time, so the follow-up sat in implicit-work-queue purgatory while explicit-work-queue items took priority. Structural root cause: the methodology assumed follow-up commitments would self-execute; in practice they need the same explicit ticketing as any other work.

Both incidents share a shape: the proximate explanation stops at the operator's individual action, but the structural root cause sits one or two iterations of "why" further down. Amazon's Five Whys technique (Well-Architected framework) names this discipline directly — keep asking why until you reach a cause that could have been prevented or detected structurally, refusing "human error" as a terminal explanation.

Five Whys also has a forward-looking application that the existing contract does not address: before substantive work begins, the same why-chain forces articulation of why the time should be spent. "I am drafting this spec because [reason 1] because [reason 2] because [reason 3] because [reason 4] because [reason 5: root strategic premise]." If the chain doesn't terminate in a load-bearing premise within five iterations, the proposed work is exposed as unjustified.

The operator's framing on 2026-05-20: time is the operator's most valuable commodity; no spent unit deserves to be unjustified, and when problems occur the discipline of "find the why, not the who" must be procedural rather than aspirational.

## Decision

ADR-016 commits mise-en-place to a **fifth foundational principle**, added alongside but distinct from the four Karpathy-derived principles, and elevated to the same structural layer (the "fixed invariants" tier per the contract's invariants clause).

The principle is named **"Justified Action"** in the contract and **"Five Whys"** in the LICENSE attribution. The two names refer to the same principle from different framing angles:

- **Forward application:** before substantive work, articulate the why-chain. Five iterations is the floor for non-trivial work; stop when the chain reaches a load-bearing root premise.
- **Backward application:** when problems occur, apply five whys to the failure. Each iteration tests whether the reason is the root cause: could it have been prevented? could it have been detected? if the reason is human error, why was it possible?
- **Posture:** blame the system, never the operator. The discipline is finding the why, not assigning the who. Ad-hominem analysis is a methodology violation, not just a politeness preference.

The principle's lineage is named explicitly in the contract: the technique is Amazon's Five Whys from the Well-Architected framework, generalized from incident-response RCA to a foundational discipline covering both forward justification and backward causal analysis. The principle is **Kavara-attributed**, not upstream-attributed. This is a fork-shaped commitment per ADR-014's Generic Domain principle.

ADR-016 makes three operational commitments:

The first commitment is **principle-layer placement**. Justified Action joins principles 1-4 as a structural invariant of the contract. It is renumbered as Section 5; the existing Sections 5 (Modes), 6 (Mirepoix Addenda), and 7 (Acceptance Test) shift to 6, 7, and 8. The mode signature table in MODES.md gains a #5 column. Each mode's #5 override is explicit in the mode-specific section of the contract. The principle is foundational and applies in every mode, with mode-specific relaxation or strengthening (see the second commitment).

The second commitment is **mode-specific override structure**. The principle is binding by default (`build` mode) but bends in mode-specific ways:

- **`build`** — full strength. Every action gets a why-chain.
- **`explore`** — relaxed. Instinct-driven work is allowed; the why-chain may not be complete yet. Defer the chain to the writeup at mode exit.
- **`harden`** — strengthened. The why-chain is a publication-time gate; every failure mode mapped must include a why-this-could-happen chain.
- **`ship`** — strengthened. Deploy-readiness includes why-chain trace to a root premise (e.g., "this ships now because [customer commitment / strategic premise / time-window].").
- **`firefight`** — **deferred** (the strongest override). Do not run five-whys during the incident. Act, rollback, then run the analysis in the postmortem. This is the only mode where the principle is structurally postponed rather than relaxed or strengthened.
- **`review`** — applied to findings. Every flagged finding traces to a why; "this looks wrong" is insufficient without one iteration of why.
- **`migrate`** — strengthened. Forward and reverse why-chains required. "Why does this migrate succeed?" and "Why does the rollback work?" both must be answerable.
- **`refactor`** — applied to the refactor's existence. "Why this refactor now?" must terminate in a load-bearing premise (architecture debt, scaling pressure, vocabulary alignment per ADR-014).

The third commitment is **integration with existing methodology surfaces**. Justified Action interlocks with:

- **The three-criteria ADR gate (per ADR-014).** An ADR proposal that fails the five-whys forward chain (cannot trace its proposed decision back to a load-bearing premise within five iterations) likely fails one of the three criteria (most commonly "real trade-off"). The two disciplines reinforce each other.
- **The Multi-agent review addendum #5 (per v0.4.0).** When reviewers disagree, the operator's "act on finding" default per the face-off loop-closure memory is itself a Justified Action call — the operator must articulate why dismissing a finding is the correct action. Default action is "investigate the why behind the disagreement," not "pick a reviewer."
- **The face-off pattern (per ADR-013).** Multi-agent review (addendum #5) is the contract-layer manifestation of ADR-013's face-off pattern. Justified Action shapes how reviewers articulate findings (one iteration of why per finding, per the `review` mode override) and how the operator reconciles disagreements (act-on-finding default rooted in why-chain analysis).
- **The post-merge grilling pattern.** Post-merge grilling produces findings; Justified Action requires each finding to be traced to a structural cause via five iterations. The grilling-with-five-whys pairing produces architectural debt at higher resolution than grilling alone.
- **Mode `firefight` postmortems.** The existing `firefight` postcondition ("every firefight session emits a postmortem stub") gets an explicit five-whys requirement: the postmortem must include the five-iteration causal analysis, not just a chronology.

## Consequences

The first consequence is that the contract.md structure changes. Section 5 (Modes) renumbers to Section 6; Section 6 (Mirepoix Addenda) renumbers to Section 7; Section 7 (Acceptance Test) renumbers to Section 8. Cross-references in MODES.md, README.md, SKILL.md update. Existing operators who have memorized "Section 5 is Modes" experience a brief friction during migration. The friction is acceptable; the alternative (calling the new principle "Section 4.5") is structurally awkward.

The second consequence is that the LICENSE attribution gets a clarification paragraph. The four Karpathy principles remain attributed to upstream; Principle 5 is attributed to Amazon's Well-Architected framework (Five Whys, with conceptual generalization by Kavara). The fork-shaped nature of the addition is explicit in the LICENSE.

The third consequence is that the CI validator gains a new invariant check: contract.md must contain a "## 5. Justified Action" heading. Future versions of the contract that drop or rename Principle 5 require their own ADR.

The fourth consequence is that the operator's session-start activation prompt changes. The current prompt elicits the active mode from the operator; the v0.5.0 prompt also surfaces Principle 5 as a foundational invariant. Sessions opened mid-task (without explicit activation) inherit the principle by default.

The fifth consequence is that mise-en-place v0.5.0 ships with a behavior-changing release. The semver bump is 0.4.0 → 0.5.0 (minor for the principle layer change; not 1.0.0 because the 0.x series is intentionally pre-stable). The slot v0.5.0 is unused; v0.4.0 was claimed by the Multi-agent review addendum #5 (PR #5, 2026-05-15). Per ADR-016's third commitment, the DDD addendum from ADR-014's Follow-up 2 (originally targeted as addendum #6) bumps to v0.6.0.

The sixth consequence is that Mirepoix's broader methodology stack gets a forward-looking justification gate that previously existed only as a default operator instinct. Forward Five Whys applied to spec drafting, ADR authoring, or sub-phase planning forces premise articulation at design time. This is structurally similar to the three-criteria ADR gate (which forces premise articulation for architectural commitments) but applies to all substantive work, not only ADR-shaped work.

The seventh consequence is a risk worth naming: Five Whys can ossify into bureaucracy if applied indiscriminately. The mode-specific override structure (commitment 2) is the primary mitigation — `explore` mode explicitly relaxes the principle, `firefight` defers it, the trivial-task waiver in the contract's existing tradeoff clause continues to apply. A second mitigation: the principle's text explicitly states "five is the floor, not a ceiling — stop when you are confident; not before." The intent is procedural depth when it matters, not five-iteration ritual for every commit.

The eighth consequence — surfaced ironically by the rollout itself — is that ADR-016's authoring exposed a self-referential failure of the principle it formalizes. The Mac-side staging assumed mise-en-place's main was at v0.3.0; main had moved to v0.4.0 (addendum #5 multi-agent review). The forward Five Whys chain on the rollout missed verifying canonical state before assuming. Lesson incorporated: any forward Five Whys involving cross-host state must include "verify canonical state is current" as an iteration of the chain.

## Alternatives considered

We considered placing Five Whys at the addendum layer (a sixth Mirepoix addendum alongside skills, evaluation packs, meta-agent, ADRs, and multi-agent review). Rejected. The principle is too foundational; it gates not only "how to act in this codebase" (the addenda layer's concern) but "whether to act, and how to find the structural cause when action goes wrong" (a meta-level concern that all addenda assume). Placement at the addendum layer would force every addendum to re-derive the justification discipline. The Multi-agent review addendum #5 sits at the addendum layer correctly — it concerns dispatch and reconciliation shape, a "how to act" rule. Five Whys is structurally different.

We considered placing Five Whys at a new "candidates not yet promoted" entry, with formal promotion deferred to v0.6.0 or later. Rejected. The operational signals (PR #19, ADR-014 Follow-up 3 lag) demonstrate the discipline is already load-bearing; deferring formal promotion would mean continuing to operate without the structural backing the principle provides. The discipline is already in use; the formalization is overdue, not premature.

We considered keeping Five Whys as a backward-only discipline (incident RCA only), placed in the `firefight` mode's postcondition. Rejected. The forward-looking application — justifying time-spent before substantive work — is the more interesting placement per the operator's 2026-05-20 framing. Backward-only placement would lose the forward justification gate that the operator explicitly identified as load-bearing.

We considered building Mirepoix's own custom justification framework rather than adopting Five Whys. Rejected for the same reasons ADR-014 rejected building a custom vocabulary framework. Amazon's Five Whys is established (Well-Architected framework, 20+ years of operational practice across the industry), with well-developed semantics. Kavara's contribution is the foundational placement and the mode-specific override structure, not a new framework.

We considered scoping the principle narrowly to the Mirepoix harness only, leaving downstream agents (on-loop pipeline agents, multi-agent reviewers per addendum #5) outside the principle. Rejected. The principle is generic enough to be foundational; mode-specific overrides handle the operational variation. A scoped placement would leave the same drift problem in the un-scoped contexts. In particular, addendum #5's multi-agent reviewers benefit from #5's "one iteration of why per finding" requirement — without it, REQUEST_CHANGES findings can collapse to "this looks wrong" without structural causal claim.

## Implementation notes

ADR-016 commits to the principle and the structural placement; implementation ships across two coordinated PRs.

### PR 1 — mise-en-place v0.5.0 (in `UlyssesModel/mise-en-place`)

- `skills/mise-en-place/references/contract.md` — insert Section 5 (Justified Action); renumber Sections 5/6/7 → 6/7/8; extend each mode section with a #5 override paragraph; preserve the v0.4.0 addendum #5 (Multi-agent review) text verbatim in the new Section 7
- `MODES.md` — add #5 column to the mode signature table; add #5-specific load-bearing oddities entries (`firefight` is the only mode that defers #5; `explore` is the only other mode that relaxes #5 without deferral); update §5b cross-references to §6b; update §6 cross-references to §7 (the existing `ship` and `review` mode subsections reference §6 for multi-agent review)
- `README.md` — restructure framing to "five principles, eight modes, five addenda"; update §5b cross-references to §6b
- `LICENSE` — add Five Whys attribution to Amazon's Well-Architected framework; clarify that Principle 5 is Mirepoix-augmented, not upstream-verbatim
- `CHANGELOG.md` — v0.5.0 entry naming ADR-016 as the architectural authority, prepended above the existing v0.4.0 entry (addendum #5 multi-agent review)
- `.claude-plugin/plugin.json` — version 0.4.0 → 0.5.0; update description to reference five principles
- `skills/mise-en-place/SKILL.md` — surface Principle 5 in activation prompt; update Sections 1-4 → 1-5; update §5b → §6b; update §6 → §7
- `.github/scripts/validate_plugin.py` — add assertion that contract.md contains "## 5. Justified Action" heading; add `TestPrinciple5Invariant` test class (6 tests)
- `commands/mise-en-place.md` — surface Principle 5 in slash-command output

### PR 2 — kavara-mirepoix-internal harmonization (in `UlyssesModel/kavara-mirepoix-internal`)

- `adrs/ADR-016-mise-en-place-principle-5.md` — this document
- Update `CONTEXT-MAP.md` — Tooling-context vocabulary now includes "Justified Action" / "Five Whys"
- Update `docs/tooling/CONTEXT.md` — add the principle to the Tooling-context Ubiquitous Language

### Sequencing

PR 1 in mise-en-place ships first (the principle text is canonical). PR 2 in kavara-mirepoix-internal cross-references PR 1 and lands within 24 hours. Face-off review per ADR-013 (and the contract-layer addendum #5 Multi-agent review) applies to both PRs. Confluence sibling page authored as part of the standard 2026-05-20-onward Confluence backfill discipline (page becomes the ninth in the new dev-tooling cluster).

### Version trajectory

| Version | Subject | Status |
|---|---|---|
| v0.3.0 | Slash command surface (PR #4) | Shipped 2026-05-09 |
| v0.4.0 | Addendum #5 — Multi-agent review (PR #5) | Shipped 2026-05-15 |
| **v0.5.0** | **Principle 5 — Justified Action (this ADR)** | **Authorized; PR 1 in this rollout** |
| v0.6.0 | Addendum #6 — DDD vocabulary discipline (ADR-014 Follow-up 2) | Future; targeted post-v0.5.0 |

### Followups

- ADR-014 Follow-up 2 (DDD addendum, now slotted as addendum #6) ships in v0.6.0 once Principle 5 stabilizes
- The forward-looking Five Whys discipline interacts with the three-criteria ADR gate; future ADRs run both checks at the architect phase of the on-loop pipeline
- Post-merge grilling sessions add an explicit "Five Whys per finding" step where appropriate (footguns and methodology bugs; ratifications are exempt)
- Multi-agent review reviewers (per addendum #5) apply the `review` mode override of Principle 5 — at least one iteration of why per flagged finding. Worth surfacing in the next on-loop pipeline iteration that touches the multi-agent-review prompt template.
- Operator-facing documentation in the on-loop plugin (Kavara mirror) gets a Five Whys hook at the architect phase: every spec draft includes a five-iteration forward chain

### What does NOT change

ADR-016 does not modify the Karpathy four principles. Their text, their attribution, and their mode-overrides remain exactly as in v0.4.0. The principle 5 addition is purely additive; principles 1-4 are unchanged. Existing operator memory of "Karpathy four" remains correct; the addition is "Karpathy four plus Kavara's fifth."

The mode set does not change. Eight modes remain. New modes were not added as part of this work.

The Mirepoix addenda set does not change at v0.5.0. The current five addenda (Skills, Evaluation packs, Meta-agent, ADRs, Multi-agent review) remain at v0.5.0; addendum #6 (DDD vocabulary discipline) ships in v0.6.0 per the followups above.

### What this ADR is not

ADR-016 is not a methodology document about Five Whys as a technique. It is an architectural commitment about the structural placement of Five Whys in the mise-en-place contract and its interaction with the existing eight modes and five addenda. The technique itself is Amazon's; the placement is Kavara's.

ADR-016 is not a directive to apply Five Whys to every action. Mode-specific overrides explicitly relax or defer the principle. The intent is procedural depth when it matters, governed by the mode-specific structure, not five-iteration ritual for every commit.
