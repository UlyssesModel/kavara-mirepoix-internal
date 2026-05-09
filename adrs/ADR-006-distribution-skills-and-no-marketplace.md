# ADR-006: Distribution, skills, and the no-marketplace stance

Status: Accepted
Date: 2026-05-06
Deciders: John Edge (CTO)
Supersedes: none

Note: This ADR was originally written using "Pi" as the platform name. Per ADR-009, the platform is renamed to Mirepoix; this ADR's architectural commitments are unchanged.

## Context

Two questions about ecosystem shape need to be answered before Phase One ships, because the answers determine what we build, what we operate, and what we maintain in perpetuity. The first is how Mirepoix extensions are published and discovered. The second is how operators teach Mirepoix about their codebase, conventions, and workflows — the layer that, in the broader industry, has converged under the name "skills."

The default industry answer to both is to build proprietary infrastructure. A vendor builds a marketplace for extensions, often with a curation layer, a billing layer, and a sign-in flow. A vendor invents a proprietary format for skills or for memory or for "rules" — different from every other vendor's format — and locks operator content to its tool. We have watched this happen in a half-dozen developer-tool categories and the result is always the same: short-term polish for the operator, long-term capture for the vendor, and a fragmented landscape where the operator's content cannot move with them.

We are choosing a different shape. Mirepoix distributes its extensions through NPM and adopts the cross-tool skills standard rather than inventing a Kavara-specific replacement. The value Mirepoix adds is the harness, not the ecosystem layer.

## Decision

Mirepoix extensions are distributed via NPM. There is no Mirepoix marketplace. There is no Kavara-controlled extension registry, curation layer, or store. Operators publish extensions to NPM under any name they like; by convention, public Mirepoix extensions use the `mirepoix-extension` keyword in their `package.json` so that NPM search becomes the discoverability layer. Mirepoix ships a small CLI helper, `mirepoix extensions search <query>`, that wraps `npm search keywords:mirepoix-extension <query>` and renders the results — but the helper is a convenience, not the registry. An operator who prefers to use NPM directly is fully equipped to do so.

Skills in Mirepoix are markdown files in a `skills/` directory. We adopt the cross-tool skills format — the one that has converged across Anthropic-side tooling and the broader ecosystem — without modification. A skill is a file with frontmatter declaring its name, description, and triggers, and a body of markdown that the model reads when the skill is loaded. The skill format is documented in `packages/mirepoix-coding/src/skills/README.md` for operators and at the top of `writing-extensions.md` for the agent.

Skills compose. There are three levels: skills that ship with `@mirepoix/coding` (a small set covering conventions like "writing extensions," "compaction strategy," and the like), skills installed in the user's config directory (`~/.config/mirepoix/skills/`), and skills committed to the repository under `.mirepoix/skills/`. All three are discovered at session start and made available to the model. Repo-local skills override user skills override built-in skills when names collide.

Skills are not extensions. A skill is content; an extension is code. Skills can change the model's behavior by changing what is in the system prompt; extensions can change the model's behavior by changing what tools exist, how compaction works, or what events fire. The two are complementary and the distinction is load-bearing — an operator who wants to teach Mirepoix about a codebase convention writes a skill, an operator who wants to give Mirepoix a new capability writes an extension.

Distribution of skills follows distribution of extensions. Skills can be published as NPM packages with the keyword `mirepoix-skill`, and `mirepoix skills install <package>` will fetch and install one into the user's skill directory. Most skills will not be published — they will live in the repository they describe — and that is fine. We do not require publication.

The CLI itself is distributed via NPM as `@mirepoix/cli`. Installation is `npm i -g @mirepoix/cli` or the equivalent in any other package manager. We do not ship a binary installer, a curl-pipe-bash script, a desktop application, or a managed service. The runtime is whatever the operator has installed; we test against current Bun and current Node LTS.

We commit to never building the following: a marketplace, a registry of approved extensions, a sign-in flow for installation, a billing layer, a vendor-controlled curation system, a "verified extension" badge, telemetry-on-by-default, or any feature that requires Kavara to operate infrastructure on the operator's behalf. Mirepoix runs entirely on the operator's machine and against the model provider of their choice.

## Consequences

The intended consequence is that we do not build, fund, or operate ecosystem infrastructure. NPM is run by a third party that knows how to run a package registry; we do not. By using their work, we focus our work on the harness.

A second consequence is that the long tail of low-quality extensions will exist on NPM and we will not curate them out. Operators who care vet the extensions they install. We document conventions for "what a good extension looks like" in `writing-extensions.md` so that the model produces extensions that fit those conventions, and we trust operators to evaluate what they install.

A third consequence is that we lose the ability to enforce ecosystem-level standards. We cannot force every public Mirepoix extension to follow a security policy, a performance budget, or a lifecycle convention. We accept this. The alternative — running a curation layer — is more work than the benefit justifies.

A fourth consequence is that we adopt the skills format that exists rather than inventing a better one. Where the existing format is awkward, we live with the awkwardness; where it is good, we benefit from cross-tool portability. Operators can move skills between Mirepoix and other tools that adopt the same format without rewriting them. This is the property we are buying with the decision, and it is worth the cost of adopting a format we did not design.

A fifth consequence is that some features that vendors typically offer through their marketplaces — installation flows, version pinning, usage analytics, license enforcement — are not available in Mirepoix. Operators who want these capabilities use NPM's own facilities (`package-lock.json`, `npm audit`, `package.json` license fields). We do not reproduce them.

A sixth consequence is that the "official" set of capabilities for Mirepoix is small. There is `@mirepoix/cli`, `@mirepoix/coding`, `@mirepoix/core`, `@mirepoix/ai`, and a handful of reference extensions in the `examples/` directory. Everything else is in the open ecosystem. We treat the small "official" surface as an asset, not a deficiency.

A seventh consequence is that we depend on NPM and on the model provider's API. If NPM goes down, extension installation breaks (existing installations continue to work). If the model provider's API changes, the AI package needs to update. We treat both as acceptable concentrations of risk for a project of this size, and the four-package decomposition (ADR-001) gives us a clean place to add a second AI provider when we want to.

## Alternatives considered

We considered building a marketplace as a Phase Four deliverable. Rejected. It is a multi-quarter project for benefits that NPM already provides. We will not be talked into it.

We considered hosting our own NPM registry mirror to reduce dependency on the public registry. Rejected. The operational cost is not justified at our scale.

We considered inventing a Kavara skills format with richer metadata and richer composition rules. Rejected. The cross-tool format is sufficient, and divergence costs portability.

We considered shipping a curated default set of extensions inside `@mirepoix/cli` so that new operators have immediate richness. Rejected. The right default is a small one. Operators who want richness install it explicitly.

We considered a "Mirepoix-recommended" badge on NPM packages that we curate. Rejected. Curation creates an obligation we are not willing to take on, and the absence of a badge becomes a signal of low quality even for high-quality packages we have not had time to review.

We considered restricting the runtime to Bun-only on the theory that Bun is faster, has built-in features (file watcher, TypeScript runtime) that we want, and is gaining adoption. Rejected for distribution but accepted for development. We will test against Bun and Node, document both, and not block operators who prefer Node from using Mirepoix.

We considered binary distribution via Homebrew, apt, and the App Store. Rejected. The audience is engineers who already have a package manager. Binary distribution adds maintenance burden for a small audience.

## Implementation notes

The `mirepoix extensions search` command lives in `packages/mirepoix-cli/src/commands/extensions.ts` and shells out to `npm search`. The `mirepoix extensions install <package>` command runs `npm install` into a designated extension directory and adds the package name to the user's extension config. The `mirepoix skills install <package>` command does the same for skill packages and unpacks the skill files into the user's skills directory.

The skills format we adopt is documented in `packages/mirepoix-coding/src/skills/README.md`. We do not copy the spec into our docs; we link to the canonical source and add Mirepoix-specific notes (where Mirepoix looks for skills, how composition works, how skills interact with extensions). When the upstream format changes in a non-breaking way, we adopt the change. When it changes in a breaking way, we evaluate and either follow or supersede via ADR.

The list of "blessed" example extensions in the repository is short by design: an observability-jsonl extension (per ADR-005), an MCP-client extension (so Mirepoix can talk to MCP servers without baking MCP into the core), a sub-agent extension, a plan-mode extension, and a web-search extension. This list is intended to demonstrate the API surface, not to define the boundary of supported functionality. Examples live in `examples/<name>/` with their own READMEs and are not published to NPM by Kavara — operators who want them publish their own forks if needed.

We will register the `@kavara` NPM scope before Phase One ships, with two-factor authentication, recovery procedures, and publication permissions limited to a small group. We will document the publication process in the repository so that the agent can read it when it eventually needs to understand how Mirepoix packages get released.
