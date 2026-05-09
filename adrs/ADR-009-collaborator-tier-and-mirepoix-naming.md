# ADR-009: Collaborator-shared distribution tier and Mirepoix naming hierarchy

Status: Accepted
Date: 2026-05-08
Deciders: John Edge (CTO)
Supersedes: extends ADR-007

## Context

ADR-007 established a three-layer distribution model — Mirepoix-base, Kavara-Mirepoix, Customer-X-Mirepoix — and a per-extension license-tagging contract with three values: `internal`, `customer-licensed`, `public`. ADR-007 explicitly considered a fourth `partner-licensed` tier and rejected it on the grounds that there was no current case requiring it. That changes today.

Two updates land together in this ADR because they are entangled and disentangling them creates more confusion than the merged ADR resolves. The first is the platform name. We are adopting "Mirepoix" as the brand for the platform — promoting the architectural metaphor that has been guiding the design into the actual product name — and committing to a specific naming hierarchy across the three layers. The second is the distribution-tier addition. CTO direction is that we want to give the platform to Joe Stein and to other selected collaborators when it is finished, under terms distinct from `internal` (Kavara-confidential), `customer-licensed` (commercial deliverable to specific customer contracts), and `public` (no-restriction open release). This is the partner case ADR-007 anticipated and deferred. ADR-009 commits to it.

A third consideration — the possibility of a hosted SaaS offering on GCP — is not the subject of this ADR but informs the design. Mirepoix should be deployable both as on-prem-style installations and as a hosted runtime that customers subscribe to. The distribution tag governs *who can install* an extension; the deployment mode governs *who runs* it. The two are independent and ADR-009 keeps them that way. A future ADR can commit to the hosted SaaS deployment work without re-litigating the distribution tags.

## Decision

ADR-009 makes three architectural commitments.

The first is the Mirepoix naming hierarchy. The platform is **Mirepoix**. The three layers from ADR-001 retain their structural meaning but get renamed to align with the platform brand.

**Mirepoix-base** is the open-source kernel — the four packages formerly named `@kavara/pi-ai`, `@kavara/pi-core`, `@kavara/pi-coding`, `@kavara/pi-cli`. They are republished under the `@mirepoix` NPM scope as `@mirepoix/ai`, `@mirepoix/core`, `@mirepoix/coding`, `@mirepoix/cli`. The package boundaries and the responsibilities of each package are unchanged from ADR-001.

**Kavara-Mirepoix** is the curated middle layer — the Kavara distribution of Mirepoix-base. Public extensions live under the `@kavara/mirepoix-*` NPM scope, sourced from `github.com/UlyssesModel/kavara-mirepoix` (renamed from `github.com/UlyssesModel/kavara-pi` as part of the rename pass that accompanies this ADR; the old URL auto-redirects per GitHub's repository-rename behavior). The internal counterpart lives at `github.com/UlyssesModel/kavara-mirepoix-internal` (similarly renamed from `kavara-pi-internal`). The Kavara-Mirepoix bundle is versioned with semver and tagged for release independently of Mirepoix-base.

**Customer-X-Mirepoix** is the third layer — per-customer remixes of Kavara-Mirepoix. Each customer engagement that produces a deliverable Mirepoix instance (federal POC sites, Databank DL360 deployments, NY5, future engagements) lives in its own private repository under the `UlyssesModel` organization, named `customer-<X>-mirepoix`.

The naming carries the cooking metaphor through deliberately. Mirepoix-base is the foundation that sits unchanged in every dish; Kavara-Mirepoix is the regional sofrito that gives Kavara's prepared dishes their identifiable character; Customer-X-Mirepoix is the actual finished dish, branded for the customer. Operators reading the codebase encounter a single coherent metaphor.

The second commitment is the addition of `collaborator-shared` as the fourth distribution tag, joining `internal`, `customer-licensed`, and `public`.

`collaborator-shared` extensions are distributable to a named set of collaborators outside Kavara — individuals or organizations that Kavara has chosen to work with under terms that are neither commercial-customer nor unrestricted-public. They get the platform under reciprocity-style arrangements: typically the collaborator is contributing to Kavara's broader work, working on adjacent problems Kavara wants to learn from, or carrying Kavara's design conventions into their own ecosystem. The terms are case-by-case; the tag captures the architectural posture, not the legal contract.

The bundler enforces the collaborator-shared tag at build time. When `mirepoix bundle` (formerly `pi bundle`) targets a collaborator-deliverable build, the manifest includes the named recipient and the bundler validates that every included extension carries either the `public` tag or the `collaborator-shared` tag with that recipient on its allow-list. The recipient list is per-extension, so an extension can be shared with collaborator A but not with collaborator B. The list lives in the extension's `package.json` under `mirepoix.collaborators` as an array of stable identifiers (GitHub handles, organization names, or contract IDs).

Promotion of an extension to `collaborator-shared` is an explicit governance act, the same shape as promotion to `public` per ADR-007. It is a manifest change committed with a CTO-level approval gate. Adding a new recipient to an existing `collaborator-shared` extension is a manifest-level change, not an extension-level promotion; the recipient list can grow or shrink without re-promoting the extension itself.

Revocation is straightforward. Removing a collaborator from a recipient list, by manifest change, makes future bundles for that collaborator fail the build. The bundler refuses to ship a bundle to a recipient who has been removed. Bundles already delivered are not retroactively recalled — the architectural mechanism is build-time, not runtime, and the legal/contractual revocation lives outside the architecture.

The third commitment is a deployment-mode-agnostic posture for the bundler. The bundler does not assume that bundles run on customer machines, on collaborator machines, or on Kavara-hosted VMs. A `customer-licensed` bundle may be delivered to a customer's TDX appliance for on-prem operation, or it may be deployed to a Kavara-hosted GCP VM that the customer subscribes to. The same bundle shape supports both. The deployment mode is recorded in the bundle manifest's `deployment` field (`on-prem-appliance` / `hosted-saas` / `customer-cloud` / `collaborator-environment`) for observability and for downstream tooling, but it does not change the bundler's enforcement of the distribution tag.

This explicitly opens the path to a hosted Mirepoix SaaS offering that ADR-009 does not commit to building, but does commit to not foreclosing. A future ADR (ADR-010 or beyond) can land the hosted-SaaS-specific concerns — the hosting infrastructure, the subscription billing, the SLA model, the multi-tenant isolation posture — without re-opening the distribution-tag question.

## Consequences

The first consequence is that we have a name we can actually use externally. Mirepoix is distinctive, the metaphor is sticky, and the layered model maps cleanly onto a culinary vocabulary that is easier to talk about than abstract layer names. Press and marketing material can use the metaphor without needing to teach it from scratch.

The second consequence is a near-term rename pass across the planning artifacts. ADRs 001-008, the implementation plan, the seed READMEs in `kavara-mirepoix-seed/` and `kavara-mirepoix-internal-seed/`, the memory entries, and the GitHub repository names all need to be updated. The rename is mechanical (Pi → Mirepoix, Pi-base → Mirepoix-base, Kavara-Pi → Kavara-Mirepoix, Customer-X-Pi → Customer-X-Mirepoix) and is captured as a separate task with a one-time superseding note added to the renamed ADRs clarifying that the rename is naming-only and the architectural commitments are unchanged.

The third consequence is that GitHub repository renames will produce auto-redirects from the old URLs (`github.com/UlyssesModel/kavara-mirepoix` → `github.com/UlyssesModel/kavara-mirepoix`). This is GitHub default behavior and we accept the URL drift. Any external references — Confluence pages, customer documents, third-party citations — get updated lazily as we encounter them. The auto-redirects mean nothing breaks immediately.

The fourth consequence is that the collaborator-shared tier becomes operational and Joe is the first named recipient. Once the SDLC-pipeline extension and the persona / quality-standards / communication-protocol extensions have landed, a collaborator-shared bundle for Joe can be built — giving him access to the Kavara-flavored Mirepoix work he would otherwise not have, in exchange for the work he has already contributed. Future collaborators are added to the recipient list one-by-one with CTO approval.

The fifth consequence is that the bundler implementation gets one more code path and one more manifest field. The added complexity is bounded — the collaborator-shared tag is structurally similar to the `customer-licensed` tag, just with a recipient list instead of a single customer name. The implementation note at the bottom of this ADR captures the schema.

The sixth consequence is that the deployment-mode field opens a small amount of observability surface but no enforcement. The bundle manifest records whether a build was intended for on-prem, hosted-SaaS, customer-cloud, or collaborator-environment, and downstream tooling (telemetry, billing, SLA monitoring) can read the field. The bundler does not enforce that a bundle is deployed in the mode it declares, because the architectural commitment in ADR-005 is that the harness does not police what happens after delivery — that is the operator's domain.

The seventh consequence is that we are now compatible with a future hosted SaaS commercial product without committing to it. If the hosted SaaS path is taken, the bundles, the routing, the substrate-aware deployment manifests from ADR-008, and the distribution tags from ADR-007 plus this ADR all carry across unchanged. The hosted SaaS-specific work is purely infrastructure (GCP hosting, multi-tenant isolation, subscription billing, SLA monitoring) and lives outside the bundler.

The eighth consequence is a minor naming awkwardness for legacy internal vocabulary. People who joined the project before today will say "Pi" reflexively; people who join later will say "Mirepoix" reflexively. The naming-only superseding note in the renamed ADRs documents the change, but social convention catches up at its own pace. We accept this as a cost of getting the naming right rather than persisting in a placeholder.

## Alternatives considered

We considered keeping "Mirepoix" as the platform name and using "Mirepoix" only as internal vocabulary for the layered architecture. Rejected. Mirepoix is a stronger external brand and the metaphor is the architecture. Splitting the two creates ongoing translation overhead.

We considered using a different culinary metaphor — Sofrito, Roux, Aromatics, Stock — as the platform name. Rejected. Mirepoix is the most universally-recognized of the foundational-base culinary terms in English, French, and roughly aligned across other cuisines. Roux is too specific to French sauces; Sofrito is regional to Spanish/Latin American cuisine; Stock is generic to English-speaking cuisine but already overloaded in software (financial trading stock, software stack). Mirepoix lands cleanest.

We considered making the collaborator-shared tier a sub-tag of `customer-licensed` rather than a peer tag. Rejected. The two posturеs are materially different — customer-licensed is commercial with contractual obligations on both sides, collaborator-shared is reciprocity-style with looser arrangements — and conflating them creates confusion about what terms apply.

We considered making the collaborator recipient list a global allow-list rather than per-extension. Rejected. Per-extension lists are more flexible — Kavara can share extension A with collaborator X but not extension B, depending on what each collaborator's working context requires. The global allow-list is a coarser tool and we prefer the finer one.

We considered enforcing the deployment mode at the bundler level (e.g., refuse to build a `hosted-saas` bundle that contains an extension flagged as on-prem-only). Rejected for now. Adding deployment-mode enforcement is a forward-looking concern that needs the hosted-SaaS infrastructure to exist first to know what enforcement actually means. The deployment field is observational in this ADR; future ADRs may promote it to enforced.

We considered structured legal criteria for collaborator inclusion — named-org agreements, mutual NDA, contribution reciprocity requirement. Rejected. The criterion is "CTO discretion, case-by-case" matching the conservative-default-with-opt-in posture from ADR-007. As the collaborator pool grows, more structured criteria may become necessary, but premature structure costs more than it buys at the current scale.

## Implementation notes

The `mirepoix.collaborators` field in `package.json` is an array of stable collaborator identifiers. Format:

```json
{
  "name": "@kavara/mirepoix-sdlc-pipeline",
  "version": "0.1.0",
  "license": "Apache-2.0",
  "mirepoix": {
    "distribution": "collaborator-shared",
    "collaborators": ["github:joestein", "org:redhat", "contract:LD-2026-0042"]
  }
}
```

The bundler reads this field. When building a `collaborator-deliverable` target, the manifest names the intended recipient; the bundler validates that every included extension either has tag `public` or has tag `collaborator-shared` with the named recipient on its `mirepoix.collaborators` list.

```yaml
target: collaborator-deliverable
recipient: github:joestein
manifest:
  - "@kavara/mirepoix-sdlc-pipeline"
  - "@kavara/mirepoix-quality-standards"
  - "@kavara/mirepoix-agent-persona-staff-isc2"
```

The bundler refuses the build if any extension carries the `internal` tag, or if any extension carries `customer-licensed`, or if any `collaborator-shared` extension does not name `github:joestein` on its recipient list.

The deployment-mode field lives at the manifest level (not per-extension) and takes one of `on-prem-appliance`, `hosted-saas`, `customer-cloud`, `collaborator-environment`. Default is `on-prem-appliance` to match the existing ADR-005 / ADR-007 / ADR-008 assumptions. Future ADRs may add modes or commit to enforcement semantics.

The repository renames happen via GitHub's repository-rename feature, which auto-creates redirects from the old URLs. Steps: rename `UlyssesModel/kavara-mirepoix` to `UlyssesModel/kavara-mirepoix`, rename `UlyssesModel/kavara-mirepoix-internal` to `UlyssesModel/kavara-mirepoix-internal`. The auto-redirects mean existing clones, pushed branches, and external links continue to work; we update the canonical URLs in our own documentation as part of the rename pass.

The NPM scope `@mirepoix` should be reserved before the first Mirepoix-base package publishes. `npm whoami` plus `npm org create mirepoix` (or the equivalent enterprise process) handles this; the cost is operational, not architectural.

Ports of the existing planning artifacts happen mechanically via the rename pass that accompanies this ADR. The pass is captured as a separate task and produces a single git commit per affected repository, with a commit message documenting the rename: `Rename Pi → Mirepoix per ADR-009`. The renamed ADRs each gain a one-line superseding note at the top: `Note: This ADR was originally written using "Pi" as the platform name. Per ADR-009, the platform is renamed to Mirepoix; this ADR's architectural commitments are unchanged.`
