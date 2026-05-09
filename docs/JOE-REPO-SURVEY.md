# Joe Stein repository survey and Kavara-Mirepoix copy plan

Internal working document. Date: 2026-05-08.

## Purpose

Joe is core team. His work — primarily `joestein/on-loop` — sits in `~/Documents/Claude/Projects/Project Tensor/` alongside the Kavara repositories (Tiberius, Uhura, Kirk-cli, Kirk-pipeline, Kavara-Visual-Studio, Wonderwall, QB-MVP, Quantbot-vs-Uhura, Inqdata-Pipeline, Kafka-Streaming-Architecture). Joe wants `joestein/on-loop` to remain his personal exploration vehicle, not migrate to the `UlyssesModel` org. Kavara-Mirepoix will copy the patterns and code into its own structure, attribute Joe directly, and let the two diverge as the Kavara version adapts to Mirepoix-base APIs and multi-substrate routing concerns. This document is the inventory and the copy plan.

## Inventory: what is in Project Tensor

The folder contains roughly sixty repositories, falling into three categories.

The first category is Kavara core engineering. Eleven repositories, most of which are referenced from the Kavara × Red Hat collaboration page or from internal Confluence: `tiberius-openshift` (the SOR reference deployment, Apache 2.0, Mike Epley as outside collaborator), `tiberius-substrate-matrix` (the IaC for OpenShift SNO across confidential-compute substrates), `uhura` (the Tensor Generation Engine, the FIX engine for tensors), `kirk-cli` (the Kirk control plane, the canonical CLI for the model), `kirk-pipeline`, `kavara-visual-studio` (drag-and-drop canvas UI for Kirk pipelines, three-layer FastAPI + frontend), `wonderwall` (Kirk encoder to Gemma 4 LLaVA-pattern bridge), `qb-mvp-2510` (the original QuantBot pipeline, Wally-led, mirrored from legacy GitLab), `quantbot-vs-uhura` (today's comparison index between QB and Uhura, written for the Red Hat conference prep), `inqdata-pipeline` (the closed-loop autonomous entropy discovery system, AI-agent-driven), `kafka-streaming-architecture` (no README, presumably architecture docs).

The second category is Joe's plugin and agent work. Three load-bearing repos: `on-loop` (the SDLC-pipeline plugin we are copying from, Apache 2.0, version 0.6.1), `agent-init` (a small LangGraph-plus-FastAPI demo with an MCP-style time server, illustrative of the agent-bootstrap pattern), `mcp-gateway` (a stub repo, README-only, not yet load-bearing). One supporting repo: `plugin-testing` (a Hello-World React plus FastAPI plus Postgres todo app used as a fixture for plugin smoke-testing — not a marketplace despite what on-loop's README implied).

The third category is Joe's reference clones. Roughly forty open-source projects he has contributed to or studied — Apache Kafka, Akka, Kops, Terragrunt, Gruntwork (terraform-aws-influx, gruntwork-installer, fetch, bash-commons, health-checker), Brave, Mesos, Scala-SBT, Scala docs, Python-Prompt-Toolkit, Lift, Pocketchangeapp, and a long tail of small projects (Sobriquets, Health-Pilot, Data-Seal, Quantum-Security, MLB-Auction-AL-Only, Recruiting-Platform, Job-Agent, Sammyba, Periwinkle, Enceladus, Telesto, Zork1, Charmalloc, Phoenix, Net-Modules, Amaunet, BDoss, Storm-Kafka, Lamina, Distributed-Lock-Python, Majesticbutter, Millionsong, Xtend-Example, Clojure-Hadoop, Tollan, Minecraft-API, Skeletor, Gruenewa-Misc, Lift-MongoDb-Rogue-Sample, Apophis, Qetesh, Hector, Cronus, Buildtools). These confirm Joe's depth — Kafka committer, distributed systems, Scala, infrastructure tooling — and tell us we have the right person on persona work for regulated finance and critical infrastructure. They are not in scope for Mirepoix copying.

## Deep dive: `joestein/on-loop` v0.6.1

The plugin is more mature than its public README implies. 4,550 lines across 33 files: 8 agent definitions (124-246 lines each), 18 commands, 4 skills, 3 shared protocol files, the plugin manifest, the marketplace manifest, the hook configuration, and a `.on-loop/` directory with example session state from real runs.

The architectural surface that matters for Kavara-Mirepoix:

**`shared/AGENT_PERSONA.md`** is 63 lines defining the Staff-Engineer-with-six-ISC2-certifications persona explicitly (CISSP, CCSP, CSSLP, ISSAP, ISSEP, ISSMP), the regulated financial services / critical infrastructure / multi-tenant SaaS target environment, the security mindset axioms (zero trust, defense in depth, least privilege, fail secure, secure by default), the compliance vocabulary (SOC 2, PCI-DSS, NIST 800-53, ISO 27001, GDPR, OWASP Top 10, CWE/SANS Top 25), and the eight engineering principles. This is the persona Kavara-Mirepoix adopts for its Kavara-engineer working bundle and for every Customer-X-Mirepoix instance targeting regulated-finance or federal customers. Direct copy, no modification needed.

**`shared/COMMUNICATION_PROTOCOL.md`** is 198 lines defining the inter-agent communication contract — the `.on-loop/` workspace structure, session-directory naming (`YYYYMMDD_HHMMSS_<branch-slug>`), the `index.json` schema (session manifest), the `state.json` schema (phase tracking, retry counters with explicit max-retry budgets, per-session metadata), the `plan.md` format, the `changes.log` append-only format, the agent-notes structure with severity-leveled findings (CRITICAL / HIGH / MEDIUM / LOW / INFO), and seven rules for all agents. This is the canonical multi-agent file-system communication idiom. Mirepoix adopts it under `.mirepoix-session/` with the same shape but renamed root, so the two systems can interoperate cleanly and Mirepoix sessions are recognizable to anyone who has used on-loop.

**`shared/QUALITY_STANDARDS.md`** is 98 lines of must-have / should-have quality bars across code, testing, security, documentation, build/CI, and review. This is the rubric for what "good" looks like across phases. It is not Mirepoix-specific — it could ship as the public Kavara-Mirepoix quality skill, and it is exactly the kind of taste-as-marketing extension that makes the case-by-case-public posture useful.

**`agents/`** contains 8 agent definitions: `orchestrator.md` (246 lines, the conductor — phase transitions, quality gates, retry logic, session lifecycle), `architect.md` (124 lines, spec generation), `coding.md` (127 lines, implementation), `testing.md` (140 lines), `security.md` (152 lines), `documentation.md` (159 lines), `build.md` (142 lines), `reviewer.md` (169 lines). Each agent file is a Claude Code-formatted markdown with front-matter declaring `name`, `description`, `model` (opus / sonnet), `color`, and `tools`. The agents are model-tier-typed: Opus for orchestrator / architect / coding / security / reviewer, Sonnet for testing / documentation / build. This is the empirical task-class routing that ADR-008 cites.

**`commands/`** contains 18 slash-commands. The core SDLC pipeline: `on-loop`, `on-loop-continue`, `on-loop-status`, `on-loop-resume`, `on-loop-clear`, `on-loop-main-resolve`, `on-loop-check` (CI status integration), `on-loop-debug-fix` (debug from logs or images, with explicit complexity levels). The standalone phase invocations: `on-spec`, `on-test`, `on-security`, `on-doc`, `on-build`, `on-review`. The roadmap multi-session pattern: `on-prepare` (generate phased roadmap with mermaid diagrams), `on-plan` (detailed implementation plan with parallelism annotations), `on-continue` (pick up next available step), `on-pause` (release locks, commit WIP, write handoff). The roadmap commands are what make on-loop a multi-session-capable system rather than a one-shot pipeline. Mirepoix inherits all of this.

**`skills/`** contains 4 skills, each with its own SKILL.md: `loop-state` (phase transition rules, valid sequences), `quality-gate` (gate-validation logic between phases), `roadmap-lock` (multi-session lock coordination), `roadmap-state` (roadmap state machine). These are the formalized rules that the agents reference. They are exactly the shape of the Mirepoix skills we have been planning — markdown with frontmatter, loaded into context, referenceable by name.

**`hooks/hooks.json`** wires two hooks: a `Stop` hook that reminds the user about active sessions when the agent stops, and a `PostToolUse` hook on `Write` and `Edit` that appends to the per-session `changes.log` whenever a file is modified. These are Claude Code hooks and don't directly translate to Mirepoix (which uses an in-process event bus per ADR-004), but the *behaviors* (active-session reminder, file-change tracking) are easy to port to Mirepoix event-bus listeners.

**`.claude-plugin/plugin.json`** is the standard Claude Code plugin manifest. **`.claude-plugin/marketplace.json`** declares this repo as a single-plugin marketplace. Mirepoix does not adopt the marketplace format (per ADR-006) but does adopt the plugin manifest concept — Mirepoix extensions use `mirepoix-extension.json` per ADR-007, with structurally similar but Mirepoix-shaped fields.

**Worktree-per-session**: `.claude/worktrees/<branch-slug>/` is gitignored and temporary, created during INIT and removed on COMPLETE (left in place on FAILED for resume). This isolates concurrent SDLC sessions from each other and from the user's working directory. Mirepoix adopts the same pattern; the implementation lives in the SDLC-pipeline extension, not in Mirepoix-base.

**`.on-loop/sessions/<name>/`** is committed to the repo as an audit log. Two example sessions are present (`20260426_083441_on-loop-check` and `20260426_100540_on-loop-debug-fix`) showing what real session state looks like. These are useful test fixtures for the Kavara-Mirepoix port.

## What we are NOT copying

Joe's reference clones (Kafka, Akka, Kops, Terragrunt, Gruntwork tooling) are not Kavara-Mirepoix material — they are Joe's own study/contribution history. Stays in his world.

`agent-init` is a small demo, not a Kavara-Mirepoix extension. Reference only — useful for understanding the LangGraph plus FastAPI plus MCP-style-time-server pattern but not directly portable.

`mcp-gateway` is a stub. Skip until it has real content.

`plugin-testing` is a fixture app, not a plugin. Skip.

The Claude Code hooks (`hooks/hooks.json`) do not port directly because Mirepoix uses an in-process event bus, not subprocess hooks (per ADR-004). The *behaviors* port; the *mechanism* does not.

The `.claude/worktrees/` configuration ports as a concept but Mirepoix's session-tree-navigation (the queued ADR-009) may handle the same concern differently. Worth a design check during the port.

## Copy plan: where each piece lands

The destinations are the two Kavara-Mirepoix repositories: the public `UlyssesModel/kavara-mirepoix` (currently seeded with planning artifacts, accepts only `public`-tagged content) and the private `UlyssesModel/kavara-mirepoix-internal` (currently empty, accepts `internal` and `customer-licensed` content, must be flipped to private before any real content lands).

**Public extensions (`kavara-mirepoix/extensions/`):**

`kavara-mirepoix/extensions/sdlc-pipeline/` is the port of on-loop's full SDLC pipeline. It includes the eight agent definitions (renamed to Mirepoix-extension format with frontmatter adapted to `mirepoix-extension.json`), the 18 commands (ported as Mirepoix slash-commands), the four skills (ported as Mirepoix skills, markdown is mostly compatible), the hook behaviors as Mirepoix event-bus listeners, and an attribution NOTICE crediting Joe's authorship of the underlying patterns. Tag: `public`. License: Apache 2.0. The extension is generic enough to advertise as Kavara engineering taste without revealing IP — the pipeline pattern itself is the marketing.

`kavara-mirepoix/extensions/agent-persona-staff-isc2/` is the persona file as a system-prompt extension. 63 lines of high-density persona prompt that any Kavara-Mirepoix or Customer-X-Mirepoix instance can load. Tag: `public`. License: Apache 2.0. Attribution: Joe Stein.

`kavara-mirepoix/extensions/quality-standards/` is the rubric file as a referenceable skill. 98 lines of must-have / should-have bars across code, testing, security, docs, build, review. Tag: `public`. License: Apache 2.0. Attribution: Joe Stein.

`kavara-mirepoix/extensions/communication-protocol/` is the multi-agent file-system communication idiom (`.mirepoix-session/` directory shape, session naming, state schema, plan format, changes log, agent-notes format with severity levels) ported from on-loop's `.on-loop/` convention. Tag: `public`. License: Apache 2.0. Attribution: Joe Stein. This extension is the foundation that the SDLC-pipeline extension and other multi-agent extensions build on top of.

**Internal extensions (`kavara-mirepoix-internal/extensions/`):**

`kavara-mirepoix-internal/extensions/sdlc-pipeline-kavara/` is the Kavara-specific overlay on top of the public SDLC pipeline. It tunes the agent personas with Kavara-specific context (Tiberius / Uhura / Kirk awareness, Kafka topic conventions, OpenShift cluster knowledge, substrate-matrix awareness, Red Hat collab context). Tag: `internal`. The public sdlc-pipeline extension is the generic one; this one is the Kavara-specific one. Customer-X-Mirepoix instances may layer this in or not depending on the customer's contractual posture.

`kavara-mirepoix-internal/extensions/customer-deployment-runbooks/` is templated runbook generation tuned to Kavara's MaaS appliance deployments (Databank DL360, NY5 kirk-td, federal POC sites). Per-customer specifics live in their own Customer-X-Mirepoix repos; this is the templates. Tag: `internal`.

**Internal documentation (`kavara-mirepoix-internal/docs/`):**

`kavara-mirepoix-internal/docs/JOE-REPO-SURVEY.md` is this document. Tag: internal-by-default (it is a working doc with reference to specific customer paths and Kavara IP).

`kavara-mirepoix-internal/docs/SDLC-PORT-NOTES.md` (to be written during the port) captures the design choices made when adapting on-loop to Mirepoix-base — what changed, what stayed, why. Future maintainers (and Joe) read this to understand the divergence.

## Attribution model

Every copied artifact carries an attribution header. Format:

```
# <Artifact name>
#
# Adapted from joestein/on-loop v0.6.1 (Apache 2.0)
# https://github.com/joestein/on-loop
# Original author: Joe Stein
#
# Modified for Kavara-Mirepoix by <author>, <date>.
# Modifications: <one-line summary of what changed for Mirepoix>
```

For the persona and quality-standards extensions where the content is unmodified, the header notes "verbatim adaptation from on-loop" rather than describing modifications. For the SDLC-pipeline extension where significant adaptation happens (Mirepoix-base APIs, event-bus listeners replacing hooks, multi-substrate routing awareness), the header summarizes the divergence and the per-file `# Modifications` block in each file lists the specific changes.

The public Kavara-Mirepoix repository's top-level `NOTICE` file lists Joe's authorship across all on-loop-derived extensions, with a link back to `joestein/on-loop` as the upstream reference. Apache 2.0's attribution requirements are met by this single NOTICE file plus the per-file headers.

## Open questions for Joe

Before the copy lands, three questions for Joe to settle:

Does he want the per-file attribution to read "Original author: Joe Stein" or "Original author: joestein"? The repo uses the latter as the GitHub handle; the former is more readable. CTO call.

Does he want commit-level attribution on the initial copy (Co-Authored-By: Joe Stein, similar to the Mike Epley pattern on tiberius-openshift), or is the file-level attribution sufficient? The Co-Authored-By trailer makes the commit log easier to read; the file-level attribution is more durable across renames and refactors.

Does he want to be a `decider` on the queued ADR-009 (session tree navigation) and the v2 self-review of ADRs 001-006, given that the session-state-shape choices land squarely in his existing work? Currently every ADR lists "John Edge (CTO)" as the sole decider. Adding "Joe Stein" makes the deciders field reflect substantive shared design.

## Next concrete actions

In order, with rough scope:

Stage the persona and quality-standards extensions first. They are the simplest, smallest, no-modification copies. Land in `kavara-mirepoix-seed/extensions/agent-persona-staff-isc2/` and `kavara-mirepoix-seed/extensions/quality-standards/` with attribution headers. Push to public Kavara-Mirepoix as the second commit (after the planning-artifacts initial commit).

Stage the communication-protocol extension. Adapt `.on-loop/` to `.mirepoix-session/`, but keep the schema and the rules verbatim. Land in `kavara-mirepoix-seed/extensions/communication-protocol/`. Push.

Stage the SDLC-pipeline extension. Larger work: port the eight agents, eighteen commands, and four skills, swap the Claude Code hook integration for Mirepoix event-bus listeners, adapt the worktree-per-session pattern for Mirepoix sessions. Land in `kavara-mirepoix-seed/extensions/sdlc-pipeline/`. This is roughly a one-week task and probably warrants its own ADR (ADR-009 or ADR-010 candidate) to capture the design decisions made during the port.

Stage the Kavara-specific overlay in `kavara-mirepoix-internal-seed/extensions/sdlc-pipeline-kavara/`. Smaller work because it is just the persona-tuning and the connector hooks; the scaffolding is inherited from the public extension.

Defer customer-deployment-runbooks until a real Customer-X-Mirepoix engagement is in flight. Templating runbooks before a real customer-shape exists produces fictional runbooks; doing it during a real engagement produces useful ones.
