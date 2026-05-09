# Architecture Decision Records

This directory captures the load-bearing architectural decisions for Mirepoix. Each ADR follows the Michael Nygard format — context, decision, consequences, alternatives — and is immutable once accepted. A change to a decision means a new ADR that supersedes the old one; the old one is marked as superseded but kept on disk so the reasoning trail is preserved.

The current set is read in order. Earlier ADRs set up the structure later ones depend on.

ADR-001 establishes the four-package decomposition (`@mirepoix/ai`, `@mirepoix/core`, `@mirepoix/coding`, `@mirepoix/cli`) and the discipline that keeps the core under five thousand lines.

ADR-002 fixes the tool surface at four base tools (bash, read, write, edit) and commits to bash-unrestricted-by-default with security delegated to the operator's environment.

ADR-003 defines extensions as TypeScript modules with hot reload, no marketplace, and the ability for the agent to write its own extensions during a session.

ADR-004 commits to a typed in-process event bus instead of a hook-and-process model, with rationale for why per-event subprocess spawning is the wrong default.

ADR-005 binds the harness to context-ownership and observability invariants — full visibility, full reconstructibility, no silent injection, no auto-pruning, no behind-the-back LSP loops.

ADR-006 settles distribution on NPM, adopts the cross-tool skills format, and explicitly commits to never building a marketplace.

ADR-007 establishes the three-layer distribution model — Mirepoix-base, Kavara-Mirepoix, Customer-X-Mirepoix — and the per-extension license-tagging contract (`internal`, `customer-licensed`, `public`) enforced by the bundler at build time. Restrictive default, opt-in to public on a case-by-case basis, with the public Kavara-Mirepoix bundle hosted at `github.com/UlyssesModel/kavara-mirepoix` and `internal` extensions kept in a parallel private repository.

ADR-008 commits to model routing, provider abstraction, and substrate-aware self-hosted serving. Cascade and task-class as first-class routing policies. Four provider tiers (Anthropic, OpenAI Codex, self-hosted KServe-on-OCP fleet with Qwen3-Coder-480B-A35B-Instruct as the default model across GCP / Azure / AWS-AMD-SEV-SNP substrates, and on-prem TDX appliance for customer deployments). Substrate-aware bundle manifests, prompt-cache as a routing dimension, and a `mirepoix sweep` harness for eval-driven validation before any routing default hardens.

The master implementation plan at `../IMPLEMENTATION-PLAN.md` references this set and uses it as the architectural spine of the phased build.
