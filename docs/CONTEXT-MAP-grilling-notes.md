# Q2 — Is the Tooling/Pipeline split actually distinct, or are they one context wearing two hats?

This is the single biggest threat to the four-context map. The two contexts have huge surface overlap if you press on them:

| Concept | Where ADR-014 puts it | Could plausibly be the other |
|---|---|---|
| `on-loop` plugin | Tooling (it's a Joe-Stein plugin) | Pipeline (it IS the SDLC phases) |
| `mise-en-place` plugin | Tooling (Kavara behavioral plugin) | Pipeline (codifies grilling/decision discipline) |
| `grill-with-docs` | Tooling (Matt Pocock skill) | Pipeline (the vocabulary-resolution methodology) |
| Multi-agent face-off | Tooling (per ADR-014) | Pipeline (per ADR-014 — *named in both!*) |
| Architect → coder → tester → security → reviewer phases | Pipeline | Tooling (they're on-loop plugin commands) |
| Karpathy four / eight operating modes | Tooling (per ADR-014) | Pipeline-adjacent (modes shape how phases run) |
| Sub-phase letters (A, B, B.1, C, D, D.1, E) | Pipeline | Harness-coupled (each sub-phase = a Harness PR) |
| `FR-X`/`NQ-X`/`OQ-X`/`MS-X` spec notation | Pipeline | Tooling-adjacent (the on-loop SPEC phase consumes it) |
| `codex-result-handling` "don't auto-apply findings" rule | Tooling (skill convention) | Pipeline (rule enforced during REVIEW phase) |

ADR-014 itself drops one tell: "the multi-agent face-off pattern (codex-teammate, dispatch + reconciliation)" appears in **both** the Tooling description ("the multi-agent face-off pattern") and the Pipeline description ("the multi-agent review face-off (PR #11 and PR #12 as empirical anchors)"). That's not a typo — it's the framework leaking that the boundary isn't crisp.

Three candidate ways to draw it. I want you to pick or veto:

**Option A — Tooling = runtimes, Pipeline = methodology+artifacts.** (My lean.)
- Tooling owns: *the plugin/skill code* — on-loop's plugin source, mise-en-place's source, grill-with-docs' source, the Karpathy-four agent-contract text, the eight operating modes as enumeration, the `codex-plugin-cc` package.
- Pipeline owns: *the contract those runtimes implement* — sub-phase letters as a numbering convention, spec file format (`FR-X`/`NQ-X`/`OQ-X`/`MS-X`/`MQ-X`), the eight phases as an abstract sequence (architect → coder → tester → security → docs+build → reviewer → git → CI), the deliverable-tracking convention, the spec-resolution convention (specs as pre-OQ snapshots, PR body as resolution record), the multi-agent face-off as a methodology (dispatch + reconcile + adjudicate).
- Test: if someone replaced on-loop with a hypothetical fork "off-loop" that implemented the same eight phases differently, Pipeline's vocabulary doesn't change but Tooling's roster does. This is the falsifiability check that Option A passes.

**Option B — Collapse to three contexts (Harness / Deployment / Workflow), where Workflow = Tooling + Pipeline.**
- Argument for: ADR-014's own framing leaks ("multi-agent face-off" in both); operationally, you never deploy on-loop without also adopting Pipeline conventions; they evolve in lockstep across PR #11, PR #12, PR #13, this PR.
- Argument against: this is a real DDD violation — Generic (off-the-shelf upstream) and Supporting (Kavara-curated methodology) are *different Subdomain classifications* per ADR-014. Collapsing them flattens Subdomain discipline.

**Option C — Tooling = plugins/skills runtime, Pipeline = SDLC orchestration only; Behavioral Discipline becomes a fifth context (mise-en-place addenda, Karpathy four, operating modes, grilling discipline).**
- Argument for: behavioral contracts (mise-en-place addenda, grilling-then-resolve) are vocabulary-rich and don't fit Pipeline's "what to produce" framing or Tooling's "what plugin is installed" framing.
- Argument against: introduces a fifth context two days after ADR-014 set the count at four. The DDD anti-pattern ("over-application") warning in ADR-014 §62 explicitly cautions against this.

**Recommended answer: Option A.** It's the only option that passes the falsifiability test (if you replaced the runtime, does the methodology vocabulary persist? Yes for A, ambiguous for B, contorted for C). Option B is operationally honest but architecturally flattening. Option C creates a fifth context just as ADR-014 dries.

Under Option A, the cross-context glossary entries that earn their keep:

- **`review`** — Pipeline phase (architect→coder→tester→security→docs+build→**reviewer**→git→CI), Tooling mode (`mise-en-place` mode `review`), Pipeline dispatch (`codex:adversarial-review`). Three different referents. The dispatch is mediated by the *operating mode* (`mise-en-place mode review` activates posture changes; on-loop dispatching to the `reviewer` phase is unrelated to the mode the operator chose). Code review and operator prose should always qualify.
- **`agent`** — Harness's agent loop (the `@mirepoix/core` `while`-loop), Tooling's specialist agent (Claude Code's `Agent` tool spawning subagents like `Explore`, `on-loop:reviewer`, `claude-code-guide`), Pipeline's reviewer-agent (the Claude reviewer dispatched during REVIEW phase, distinct from the Codex teammate). All three are "agents" in casual speech.
- **`session`** — Harness Aggregate (`Session` in `@mirepoix/core` per ADR-014's anaemic-domain-model critique), Pipeline artifact (the on-loop `.on-loop/sessions/<sub-phase>` log + the JSONL audit log per ADR-005), Tooling session (Claude Code's CLI session, mise-en-place's "session start" pre-flight).
- **`phase`** — Harness macro-phase (Phase Zero through Phase Six in `IMPLEMENTATION-PLAN.md`), Pipeline phase (architect / coder / tester / security / docs+build / reviewer / git / CI). Both are first-class. Operator who says "Phase D" means a *sub-phase* (Pipeline numbering inside Phase One); operator who says "the reviewer phase" means a Pipeline phase. Phase Zero vs sub-phase A is a real conflation hazard.
- **`spec`** — Pipeline artifact (`specs/<sub-phase>.md`, pre-OQ snapshot). Sometimes used colloquially for "the resolved contract" — but per the spec-resolution convention (commit `1a83a67`), specs/*.md are *prompts*, not contracts. The contract lives in the PR body + on-loop SPEC artifact. Worth a Pipeline-internal glossary entry: `spec` vs `resolved spec`.
- **`skill`** — Harness loader (`@mirepoix/coding` skills loader reads markdown files into the system prompt), Tooling skill (Matt Pocock's `mattpocock/skills` marketplace, Anthropic's bundled skills like `frontend-design`, `prototype`, `diagnose`). These are *different things*: Harness skills are appended to *Mirepoix's* system prompt; Tooling skills (`/grill-with-docs`, `/on-loop`) run inside Claude Code and dispatch agents. When the harness eventually loads its own skills directory, the collision becomes operational.
- **`extension`** — Harness extension API (the typed TS interface from ADR-003), Tooling plugin (Claude Code plugins like `codex-plugin-cc`, `on-loop`, `mise-en-place`). Different mechanisms — Mirepoix extensions hot-reload into the harness binary's process; Claude Code plugins are loaded by Claude Code.

Which option — A, B, or C — and any glossary entries above you want struck or sharpened?
