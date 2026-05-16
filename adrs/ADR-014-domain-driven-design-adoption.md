# ADR-014: Domain-Driven Design as Mirepoix's architectural framework

Status: Accepted
Date: 2026-05-16
Deciders: John Edge (CTO)
Supersedes: extends and structurally re-frames all prior architectural ADRs (001–013) without superseding any of them — DDD is a frame that fits over the existing decisions, not a replacement for them.

## Context

Mirepoix has reached the scale where ad-hoc vocabulary discipline is producing measurable cost. The clearest empirical signal landed in PR #12 (codex-events, Issue #10) just two days before this ADR: the multi-agent face-off pattern caught a "verdict vocabulary mix" — `source` verdicts and `gate-normalized` verdicts had been used interchangeably in the codex-teammate spec, and the inconsistency would have shipped silently if a second reviewer had not surfaced it. That's vocabulary drift becoming an architectural defect in production code, not a theoretical concern.

Three other vocabulary-drift moments visible in recent work confirm the pattern is not isolated. The sub-phase D spec used `tool_calls` (snake_case) in one place and `toolCalls` (camelCase) in another, requiring a normative-question pass (NQ-4) to lock the convention. The Session class shipped as a passive struct with the loop reaching directly into its `messages` array — a structural soundness gap that has a name in DDD vocabulary (anaemic domain model) but had no name in Mirepoix's internal conversation. The two-venue deployment model (ADR-012) needed an explicit "one repository, two venues" commitment because the implicit assumption was producing confusion about whether per-venue repos were required.

The underlying problem is that Mirepoix has been building architectural decisions faster than it has been building the vocabulary to talk about them. Each ADR introduces terms — Mirepoix-secure, the bastion pattern, deny-all-egress posture, the rehydration helper, MirepoixEvent, the face-off pattern — and each spec adds more — sub-phase letters, NQ-X numbering, FR-X requirements, MS-X missing-seam markers, OQ-X open questions, the deliverable-tracking convention. The terms are mostly good. The discipline of *naming the same thing the same way every time and surfacing conflicts when they emerge* has been missing.

Domain-Driven Design (DDD) is the established framework for that discipline. Authored by Eric Evans in 2003, refined over 20+ years across thousands of teams, with well-developed semantics for each concept (Ubiquitous Language, Bounded Context, Subdomain classification, Entity vs. Value Object, Aggregate Root, Repository). The framework's value is precisely the problem Mirepoix has — making vocabulary discipline a first-class architectural concern with named tools, named patterns, and named anti-patterns. ADR-014 adopts DDD as Mirepoix's architectural framework, not as a code-refactoring directive but as a vocabulary and structuring discipline that informs how decisions are made and recorded going forward.

A complementary tool landed independently at the same time. Matt Pocock's `grill-with-docs` skill (in `mattpocock/skills`) operationalizes the Ubiquitous Language and Bounded Context patterns: it interviews the operator relentlessly on a plan, walks the design tree branch-by-branch, sharpens fuzzy terminology by cross-referencing the project's `CONTEXT.md`, and updates that `CONTEXT.md` inline as terms resolve. The skill happens to match the DDD framing precisely — `CONTEXT.md` is DDD's Ubiquitous Language artifact, `CONTEXT-MAP.md` is DDD's Bounded Context map, the three-criteria ADR gate (hard to reverse, surprising without context, real trade-off) matches DDD's prudent-ADR discipline. ADR-014 adopts both: DDD as the framework, `grill-with-docs` as the operational maintenance tool.

## Decision

ADR-014 makes three architectural commitments.

The first commitment is **Ubiquitous Language via per-context `CONTEXT.md`**. Each bounded context in the Mirepoix architecture maintains a `CONTEXT.md` file capturing its shared vocabulary — the precise canonical terms used in that context's discussions, specs, ADRs, code, and operator conversations. The `CONTEXT.md` files are living documents updated inline during decision-resolution sessions, never batched. The maintenance tool is `grill-with-docs`: when the skill is invoked during a planning session, it stress-tests the operator's plan against the existing vocabulary, calls out conflicts, proposes precise canonical terms for fuzzy language, and writes resolved terms into the relevant `CONTEXT.md` immediately. The format follows Matt Pocock's `CONTEXT-FORMAT.md` template referenced from `grill-with-docs`; if the project's needs diverge from that template, the divergence is itself an architectural decision worth its own ADR.

The second commitment is **Bounded Context discipline**. Mirepoix is composed of four named bounded contexts, each with its own vocabulary, its own concerns, its own canonical terms, and its own `CONTEXT.md`. The four contexts are:

**Harness** — the `@mirepoix/*` packages (`@mirepoix/ai`, `@mirepoix/core`, `@mirepoix/coding`, `@mirepoix/cli`), the Phase Zero spike, and the kernel types those packages export. The vocabulary in this context covers the agent loop, the typed event bus (`MirepoixEvent`, `Bus`, `Session`, `RunOptions`), the tool surface (`bash`, `read`, `write`, `edit`, `executeTool`), the provider abstraction (`callProvider`, `normalizeAssistantMessage`, the rehydration helpers), and the JSONL session log per ADR-005. The Harness context is the Core Domain.

**Deployment** — the operational infrastructure that runs the Harness in production. Vocabulary covers Mirepoix-build (the default posture, on `kavara-builder`), Mirepoix-secure (the exception posture, on `scotty-gpu`), the side-by-side bastion (`mirepoix-bastion`), the deny-all-egress firewall pattern, ProxyJump SSH for continuous-lockdown GitHub access, the GCP VPC inter-host path, and the smoke-acceptance gate. The Deployment context is a Supporting Subdomain — necessary, well-understood, well-documented in runbooks, but not where Kavara is uniquely innovating.

**Tooling** — the Kavara-adjacent and Kavara-owned plugins, skills, and conventions that operate on the Harness. Vocabulary covers `on-loop` (Joe Stein's multi-agent SDLC pipeline plugin), `mise-en-place` (Kavara's agent behavioral contract plugin), `grill-with-docs` and `grill-me` (Matt Pocock's interview skills), the multi-agent face-off pattern (codex-teammate, dispatch + reconciliation), the Karpathy four principles, the eight operating modes (`build`, `explore`, `harden`, `ship`, `firefight`, `review`, `migrate`, `refactor`), and the four (soon five, soon six) Mirepoix addenda. The Tooling context is mostly a Generic Subdomain — Kavara adopts upstream vocabulary rather than inventing replacements.

**Pipeline** — the methodology by which architectural decisions and code changes are produced. Vocabulary covers sub-phases (`A`, `B`, `B.1`, `C`, `D`, `D.1`, `E`), spec files at `specs/<name>.md`, the typed-spec-section naming (`FR-X` for Functional Requirement, `NQ-X` for Normative Question / locked decision, `OQ-X` for Open Question, `MS-X` for Missing Seam, `MQ-X` for Missing Question), the on-loop pipeline phases (architect → coder → tester → security → docs+build → reviewer → git → CI), the deliverable-tracking convention from PR #9, and the multi-agent review face-off (PR #11 and PR #12 as empirical anchors). The Pipeline context is the Supporting Subdomain that produces work in the Core Domain.

`CONTEXT-MAP.md` lives at the repository root and routes between these four contexts — it declares the boundaries, explains where each `CONTEXT.md` lives, names which terms cross context boundaries (e.g., `review` means a phase in Pipeline, a mode in Tooling, and a multi-agent dispatch target in Pipeline-via-codex-teammate), and provides the entry point for any agent or operator who needs to know which vocabulary applies to which conversation.

The third commitment is **Subdomain classification**. Each bounded context is classified by where it sits on the Core / Supporting / Generic axis, and this classification informs operational decisions about where to invest invention budget:

- **Core Domain** — Harness. Where Kavara is uniquely building and where invention is justified. The most rigorous vocabulary discipline applies here; the type system should be expressive (per the architectural critique recommending Refactor 1 and Refactor 2 — `Message` and `Tool` types, `ToolContext`, `ToolRegistry`); ADRs are most numerous; the <5kloc budget per ADR-001 enforces that Core stays small enough to be load-bearing.
- **Supporting Domains** — Deployment and Pipeline. Necessary infrastructure that supports the Core. Vocabulary discipline still matters but invention budget is bounded. Operational runbooks (the Mirepoix-secure runbook, the Mirepoix-build runbook, the Kavara Builder Confluence runbook) carry most of the documentation weight; ADRs cover boundary-crossing decisions; refactoring proposals must justify why they are not in scope for the Core.
- **Generic Domain** — Tooling. Off-the-shelf and third-party. Kavara adopts upstream vocabulary (on-loop's, mise-en-place's borrowed Karpathy four, grill-with-docs', Claude Code platform's) and refuses to invent replacements. Vocabulary divergence from upstream is itself an ADR-worthy decision because it represents a fork-shaped commitment.

This classification means a specific architectural posture: **Kavara is a Core-Domain-rigorous, Supporting-Domain-operational, Generic-Domain-adoptive organization**. Invention happens in `@mirepoix/*`. Operational excellence happens in deployment and pipeline. Adoption (with credit and continuity-backup) happens in Tooling.

## Consequences

The first consequence is that `grill-with-docs` becomes a first-class workflow in Mirepoix's development cadence. Before any sub-phase spec is written, a grilling session is run against the proposed plan — walking the design tree, surfacing vocabulary conflicts, resolving terms into the relevant `CONTEXT.md`, and producing the refined spec as the output. The grilling session is not optional for substantive architectural work; it is the equivalent of the pre-flight check that mise-en-place performs at session start, applied to the planning artifact itself. Smaller work (the multi-agent review addendum in mise-en-place, for example) may skip grilling; sub-phase E and beyond, on the Core Domain, will not.

The second consequence is that ADRs follow `grill-with-docs`'s three-criteria gate by default — hard to reverse, surprising without context, the result of a real trade-off. This is stricter than the implicit-but-undocumented gate Kavara has been using (which produced 13 ADRs in two months, roughly one per significant decision). Under the new gate, decisions that fail any of the three criteria become NQ-X entries inside specs rather than free-standing ADRs. ADR proliferation declines; the ones that ship carry more architectural weight. Existing ADRs 001–013 are grandfathered under the older implicit gate; new ones starting with ADR-014 (this one) and following meet the three-criteria test.

The third consequence is that `CONTEXT.md` updates happen *inline during grilling sessions*, never batched. The discipline is: when a term resolves, it gets written to `CONTEXT.md` before the session moves on. This eliminates the failure mode where vocabulary discipline is aspirational ("we should update CONTEXT.md when we have time") rather than operational. It also makes `CONTEXT.md` files load-bearing in a way that produces real maintenance friction when grilling sessions are skipped — that friction is the architectural feedback signal that grilling is being short-cut.

The fourth consequence is code-level: refactors toward DDD patterns happen where they earn their keep, not preemptively. The architectural critique earlier identified several DDD-pattern gaps — `Message` as a Value Object lacking its type (MS-1), `Tool` as a domain concept lacking its model (MS-2), `Session` as an Aggregate Root that is currently a passive struct (MS-4). These are real architectural debt that DDD vocabulary makes legible, but they are not action items that ADR-014 mandates. They become candidate sub-phases when the cost of *not* fixing them outweighs the cost of fixing — which is roughly when the Core Domain's <5kloc budget starts feeling tight or when extensions start running into the typed-message-tape friction. ADR-014 names the problem; subsequent sub-phases address it.

The fifth consequence is that mise-en-place gets a new addendum (#6 — DDD-aligned vocabulary discipline) once the current in-flight addendum #5 (multi-agent review) lands. The new addendum codifies the discipline at the agent behavioral-contract level: agents operating under mise-en-place surface vocabulary conflicts when terms cross context boundaries, propose canonical terms from the relevant `CONTEXT.md`, and refuse to silently translate between contexts. This makes the discipline operational not just in operator conversations but in agent-driven work — including on-loop pipeline phases.

The sixth consequence is documentation: the Confluence dev-tooling cluster (the four pages we wrote two days ago covering Mirepoix-build, Mirepoix-secure, on-loop, mise-en-place) gets a fifth sibling page documenting the bounded contexts and pointing at `CONTEXT-MAP.md` and the per-context `CONTEXT.md` files. New team members reading the Confluence cluster see the framework, not just the artifacts.

The seventh consequence is that future architectural conversations have a shared frame. When a critique proposes that "Session should be the Aggregate Root for the message tape," the framing is immediately legible to anyone with DDD literacy. When a refactor is proposed as "introduce `Message` as a proper Value Object," the architectural intent is immediately clear. The cost of being illegible (an architectural discussion that has to explain its own framing every time) drops to zero.

The eighth consequence is a small risk worth naming: DDD can be over-applied. The framework has well-developed semantics for every architectural concept, and an over-zealous adoption could produce bureaucratic overhead — Repository interfaces with one concrete implementation, Aggregate Root boundaries enforced where simple method calls would suffice, ADR proliferation under DDD's three-criteria gate because every decision feels "hard to reverse" once it has DDD vocabulary attached. ADR-014 explicitly rejects over-application: the framework informs vocabulary and structuring; it does not mandate code patterns preemptively. Refactors happen where they earn their keep. Repositories ship when there are alternatives to abstract over. Aggregate Roots ship when the consistency boundary is being violated in practice. Bureaucratic overhead is itself an architectural smell that the framework helps name (DDD calls it "anaemic application of DDD") and that the operator must actively resist.

## Alternatives considered

We considered keeping the vocabulary discipline informal — continuing to make decisions ad-hoc, surfacing vocabulary conflicts when they happen, accepting the occasional verdict-vocabulary-mix-style defect as the cost of speed. Rejected. The empirical evidence from PR #12, NQ-4, and the Session-as-passive-struct critique is that vocabulary drift is producing real defects at a measurable rate. The cost of running grill-with-docs once before substantive work (~30 min per session) is materially less than the cost of catching vocabulary drift after the fact (multi-PR review cycles, retroactive renames, architectural debt the type system cannot enforce). The informal-discipline path was tested empirically; it lost.

We considered adopting Clean Architecture as the framework. Rejected. Clean Architecture's contribution is dependency-direction discipline (dependencies point inward toward entities). That problem is mostly already solved in Mirepoix — the four-package decomposition per ADR-001 enforces clean dependency direction at the workspace level. What Mirepoix lacks is *vocabulary* discipline, which Clean Architecture does not centrally address. DDD does. The two frameworks are compatible (Clean Architecture's entities map to DDD's entities), but DDD is the more apt central framework for Mirepoix's actual problem.

We considered adopting Hexagonal Architecture as the framework. Rejected for the same reason as Clean Architecture — Hexagonal's contribution is port-and-adapter isolation for testability, which is also mostly solved at Mirepoix's current scale. Vocabulary discipline is not its central concern.

We considered adopting DDD's *vocabulary* informally without an ADR commitment — using terms like "Ubiquitous Language" and "Bounded Context" in conversation but not formalizing the discipline. Rejected. Vocabulary discipline benefits from architectural authority. Without ADR-014, the discipline is aspirational; with it, the discipline is binding. The empirical pattern from the deliverable-tracking convention (PR #9) is that conventions enforced by CI and codified in ADRs hold; conventions enforced by hope and convention do not.

We considered building Mirepoix's own custom vocabulary framework rather than adopting DDD. Rejected. DDD is the established framework with 20+ years of refinement, well-developed semantics for every concept, broad practitioner literacy, and existing teaching material. Building a custom framework would invent vocabulary for vocabulary discipline, which is recursive in a way that produces overhead without compensating benefit. DDD's Generic Domain principle (adopt upstream, don't invent) explicitly applies to itself — the framework's own vocabulary is upstream, and Kavara should adopt rather than reinvent.

We considered scoping ADR-014 narrowly to the Harness context only, leaving Deployment / Tooling / Pipeline outside the framework. Rejected. The vocabulary problems that motivated this ADR span all four contexts (the verdict-vocabulary-mix was Pipeline-context; the snake_case-vs-camelCase NQ was Harness-context; the one-repository-two-venues ambiguity was Deployment-context). Scoping the framework narrowly would leave the same drift problem in the un-framed contexts. The framework applies to all four; the *intensity* of application varies by Subdomain classification (Core gets the most rigorous application; Supporting gets operational application; Generic gets adoption-only application).

## Implementation notes

ADR-014 commits to the framework but does not itself ship any operational artifacts. The artifacts ship in three follow-up PRs, in order:

### Follow-up 1 — `CONTEXT-MAP.md` and four skeleton `CONTEXT.md` files

Ships in `kavara-mirepoix-internal` as a small focused PR within the next day or two. The `CONTEXT-MAP.md` at the repo root declares the four bounded contexts, points to where each `CONTEXT.md` lives, and names the cross-context terms that require disambiguation. Each `CONTEXT.md` ships as a skeleton — proper format, with placeholders marked clearly — ready to be populated by grilling sessions. The skeletons do not block by being empty; they exist so that the first grilling session has somewhere to write resolved terms.

The four `CONTEXT.md` locations:
- `CONTEXT.md` at repo root for the Harness context (the largest and most rigorous)
- `docs/deployment/CONTEXT.md` for the Deployment context
- `docs/tooling/CONTEXT.md` for the Tooling context
- `docs/pipeline/CONTEXT.md` for the Pipeline context

The split makes each file readable in isolation. `CONTEXT-MAP.md` at the root is the entry point.

### Follow-up 2 — `mise-en-place` Addendum #6 — DDD-aligned vocabulary discipline

Ships in `UlyssesModel/mise-en-place` after Addendum #5 (multi-agent review) lands in v0.4.0. New addendum bumps to v0.5.0 and codifies the discipline at the agent behavioral-contract level. The addendum text follows the established short-principle-stating shape of addenda #1–4; references ADR-014 as the architectural authority; references `grill-with-docs` as the operational tool; references `CONTEXT-MAP.md` as the cross-context routing table.

### Follow-up 3 — Confluence sibling page

A fifth page in the Platform Engineering dev-tooling cluster on Confluence (alongside Mirepoix-build, Mirepoix-secure, on-loop, mise-en-place), titled something like "Mirepoix — Bounded Contexts and Ubiquitous Language." Documents the four contexts, the Subdomain classification, the grill-with-docs workflow, and the relationship to ADR-014. Cross-links to the per-context `CONTEXT.md` files in the repo.

### Operational adoption

After the three follow-up artifacts land, adoption is operational:

1. Install `grill-with-docs` (and `grill-me` as the lightweight variant) via `claude plugin marketplace add mattpocock/skills && claude plugin install grill-with-docs grill-me`.
2. Optionally fork `mattpocock/skills` to `UlyssesModel/skills` for continuity backup (same shape as the `UlyssesModel/on-loop` arrangement; not urgent).
3. First grilling session: run `/grill-with-docs` against the bounded-context-map proposal itself — stress-test whether the four contexts I've named are the right four, whether the boundaries are correctly drawn, and what additional context-spanning terms need disambiguation. Populate `CONTEXT-MAP.md` and each skeleton `CONTEXT.md` from the session output.
4. Subsequent grilling sessions populate the per-context `CONTEXT.md` files as decisions in each context resolve. The discipline: when a term resolves, it gets written before the session moves on.

### What does NOT change

ADR-014 does not mandate immediate refactors of existing code toward DDD patterns. The architectural critique's MS-1 (no Message type), MS-2 (no Tool type), MS-3 (no ToolContext), and MS-4 (Session as passive struct) become candidate sub-phases — they are now legible as DDD-pattern gaps, but they ship when they earn their keep, not preemptively. Existing ADRs 001–013 are grandfathered; they do not need retrospective DDD-vocabulary updates. Existing specs do not need retrospective `CONTEXT.md` cross-references. The framework applies going forward; the past stays as it is.

### What this ADR is not

ADR-014 is not a process document declaring "we use DDD" as an aspiration. It is an architectural commitment that the framework structures Mirepoix's vocabulary and architectural-decision practice going forward. The discipline is binding for the contexts and subdomains named here; it is enforced through grill-with-docs sessions, the three-criteria ADR gate, and the forthcoming mise-en-place addendum #6.

### Subsequent ADRs may revisit specific elements without superseding the framework

ADR-015 (or any later ADR) may revisit a specific bounded context (e.g., re-draw the boundary between Harness and Tooling if a future change blurs them), promote a Supporting Subdomain to Core (e.g., if Mirepoix-secure's substrate-aware deployment work becomes a Kavara competitive advantage in its own right), or amend the three-criteria ADR gate (e.g., add a fourth criterion if vocabulary drift continues despite the framework). Those are forward-looking concerns. ADR-014 commits to the framework's adoption; the framework itself remains revisable as Mirepoix's needs evolve.
