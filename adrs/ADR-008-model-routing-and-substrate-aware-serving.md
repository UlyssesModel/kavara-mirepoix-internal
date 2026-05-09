# ADR-008: Model routing, provider abstraction, and substrate-aware self-hosted serving

Status: Accepted
Date: 2026-05-08
Deciders: John Edge (CTO)
Supersedes: none

Note: This ADR was originally written using "Pi" as the platform name. Per ADR-009, the platform is renamed to Mirepoix; this ADR's architectural commitments are unchanged.

## Context

Mirepoix's value at Kavara is in significant part a function of which model handles which work. The harness is the leverage; the model is the engine. ADR-001 settled the package boundary that gives `@mirepoix/ai` ownership of the provider abstraction, but it did not commit to which providers exist, which models map to which agent roles, how the router decides which call goes where, or how the self-hosted serving substrate composes with the hyperscaler APIs we will also use. Phase Zero is one week away from a spike that will hard-code one provider and one model; before that hard-coding escapes into Phase One, the policy needs to be on paper.

Four pieces of empirical and strategic input converge on the answer. Karpathy's Software 3.0 thesis names model cascading as one of the canonical token-optimization patterns and points at prompt caching as a 90%-cost-reduction lever for stateful long-session agents. Uhura's `compare` and `sweep` numbers are the existence proof in a Kavara codebase: Pipeline B routes 49 of 50 inner-loop steps through a small LLM at roughly 20× lower per-token price than the frontier orchestrator, producing 2.8× token compression and 40× cost reduction at the run level. Lucas Meyer's practitioner framing — "Claude is someone you'd invite to your birthday, Codex is the autistic German who writes software" — is empirical preference data on commercial models for code-generation work specifically. Joe Stein's `on-loop` SDLC plugin assigns Opus to Orchestrator / Architect / Coding / Security / Reviewer and Sonnet to Testing / Documentation / Build, which is task-class routing keyed to the verifiability principle: high-judgment work where verification is expensive uses the frontier model; mechanical work where verification is cheap uses the cheaper one.

The Kavara hardware reality adds a fifth input. Kavara has GPU capacity on GCP and Azure and an active AWS-with-AMD-SEV-SNP deployment line as the primary near-term POC path for federal customers. The substrate matrix from the Red Hat collaboration page is real: GCP confidential VMs (Intel SPR, with confidential GPU GA per the 2026-05 timeline), Azure with Intel TDX cluster-level confidential boundaries plus GPU, AWS ROSA with AMD EPYC and SEV-SNP plus GPU, and bare-metal appliances at NY5 and Databank for customer-on-premises deployments. Kavara has the infrastructure to self-host meaningful coding models on confidential compute across three clouds and one appliance posture. ADR-008 commits to using it.

The Model-as-a-Service business framing from the implementation plan and ADR-007 closes the loop. For Customer-X-Mirepoix instances where data-locality is a contractual requirement — federal customers, regulated-finance customers, customers whose code cannot touch hyperscaler APIs — the self-hosted tier is not an option, it is the only tier. ADR-008 has to model that.

## Decision

ADR-008 commits to five things: a typed provider abstraction, a `Router` interface with two first-class policies, four provider tiers with the self-hosted tier scoped as a multi-substrate fleet, substrate-aware bundle manifests, and a `mirepoix sweep` harness for eval-driven routing-decision validation.

The provider abstraction lives in `@mirepoix/ai`. A `Model` is a typed record with the fields name, provider, contextWindow, costPerInputToken, costPerOutputToken, costPerCachedToken, toolCallReliability (a coarse 1-5 score we maintain from eval data), declaredRateLimit (tokens per minute, requests per minute), promptCacheSupport (boolean and cache-eligibility predicate), geographicRegion, and substrate (where the substrate field is meaningful only for self-hosted models — `gcp-confidential-spr`, `azure-tdx-spr`, `aws-rosa-amd-sev-snp`, `on-prem-tdx-appliance`, or `n/a` for hyperscaler models). Models are first-class. The router never deals with strings.

The `Router` is an interface that takes a `Request` (the messages, the tool list, the task class hint, the customer-constraint metadata) and returns a `Model` to invoke. There can be multiple `Router` implementations registered as extensions, and the bundle manifest picks which one is active for a session. ADR-008 commits to two `Router` implementations as first-class, both shipped in Kavara-Mirepoix.

The first is the cascade router. It tries the cheapest model in the configured tier first and escalates to a more expensive model on verification failure, low-confidence signal, or repeated tool-call errors. It is the default for general-purpose Kavara engineering work where most steps are cheap-tier-tractable and the cost of escalation is bounded. Empirical anchor: Uhura's Pipeline B already operationalizes this pattern at 40× cost reduction in production.

The second is the task-class router. It maps from agent role to model tier statically — Orchestrator and Architect to a frontier model, Coding to either Codex or Qwen3-Coder depending on customer constraint, Testing and Documentation and Build to Sonnet or Haiku, Security and Review to a frontier model. It is the default for SDLC-pipeline workloads where the verifiability principle dictates the tier and where deterministic routing makes the pipeline easier to reason about. Empirical anchor: Joe Stein's `on-loop` plugin already operationalizes this assignment in production.

The four provider tiers are Anthropic, OpenAI, self-hosted KServe-on-OCP fleet, and on-prem appliance.

The Anthropic tier covers Claude Opus 4.6 (orchestration, architectural judgment, security review, final review), Claude Sonnet 4.6 (planning, mid-tier implementation, doc and test generation), and Claude Haiku 4.5 (cheap triage, summarization, classification, status updates). It is the default frontier tier where Kavara-internal work is concerned and where the customer has not opted out of hyperscaler API access.

The OpenAI tier covers Codex variants for commercial code-generation work where Lucas Meyer's Codex preference applies and where the customer accepts data flowing to OpenAI. It is not the default tier; it is selected when an extension explicitly routes to it, typically for the implementation phase of a task-class pipeline when Codex's empirical edge on code-generation outweighs the data-flow cost.

The self-hosted KServe-on-OCP tier is a fleet of three endpoint deployments running the same model (Qwen3-Coder-480B-A35B-Instruct as the named default), the same V2 OpenInference protocol, and the same KServe wrapper pattern that the Phase 3A artifact already validated for Kirk. The three substrates are GCP (Intel SPR plus confidential GPU plus Kata-VM pod-level boundary), Azure (Intel SPR plus TDX cluster-level boundary plus GPU), and AWS (ROSA plus AMD EPYC plus SEV-SNP plus GPU). The router selects among them by health, latency, available capacity, and customer constraint. A request from a Customer-X-Mirepoix configured for AWS-only routes to the AWS endpoint and falls back to the on-prem appliance if AWS is unhealthy; a request from a Kavara-internal session routes to whichever endpoint has the most capacity at the lowest latency. Adding a fourth substrate is a manifest change plus a deployment, not an ADR change.

The on-prem appliance tier covers Customer-X-Mirepoix instances deployed inside customer TDX appliances (Databank DL360, NY5 kirk-td, similar future deployments). Qwen3-Coder weights are bundled into the appliance image, inference runs inside the Trust Domain, and no model-call network traffic leaves the appliance. This is the only tier that satisfies the strictest customer-data-locality requirements — federal customers under air-gap operating constraints, customers whose code cannot leave their own perimeter under any circumstances. For these customers, the on-prem appliance is not a fallback, it is the only configured tier in their bundle, and the cascade or task-class router has nothing else to fall through to.

The bundle manifest schema (defined in ADR-007) gains a new section that declares which tiers are configured and, within the self-hosted tier, which substrates are available. A Kavara-internal Kavara-Mirepoix v0.1 manifest enables Anthropic, optionally OpenAI Codex, and the GCP and Azure self-hosted endpoints; the AWS endpoint is enabled when a Kavara engineer is doing ROSA-pipeline work. A Customer-X-Mirepoix manifest for a federal customer enables only the on-prem appliance tier and the AWS self-hosted tier (as a backup if the customer's environment permits cross-region traffic to the Kavara-managed AWS endpoint under the customer's own AWS account). The bundler validates these manifests at build time and refuses to ship a customer-deliverable bundle that points at a hyperscaler tier the customer has explicitly opted out of.

The `mirepoix sweep` harness mirrors `uhura sweep` in shape and CLI. It runs a configured eval suite (Kavara-coding tasks: TGE-shape work, OpenShift manifest editing, Kafka troubleshooting, kernel-RT bench analysis, Tiberius SOR threshold sweeps) across a configured grid of (model × routing-policy × task-class × latency-tier) and produces a CSV leaderboard plus a Pareto-frontier visualization. Routing recommendations in Kavara-Mirepoix presets cite specific sweep results; routing decisions in Kavara-Mirepoix do not harden into defaults until they are sweep-validated. This is the SOR-architecture-review v3 epistemic discipline applied to model selection: structural claims (cascade beats single-tier; task-class routing matches Joe's on-loop pattern; Qwen3-Coder is competitive on coding tasks) are defendable now; specific quantitative claims (Qwen3-Coder beats Sonnet on Kavara-shape work by N percent) become defendable after the sweep.

Prompt-cache eligibility is a routing dimension. The router considers cache-prefix overlap with the current request when picking among models in the same tier. A long Kavara-Mirepoix session with a stable system prompt and a stable repo context heavily favors models that support prompt caching, even if their nominal per-token price is higher than an alternative that does not. The cache-aware routing logic lives in the router, not in the provider; this keeps providers stateless and lets us swap routers without redoing provider integrations.

## Consequences

The first consequence is that Kavara-Mirepoix has a real answer to the customer-data-locality requirement that the MaaS business depends on. A federal customer signing for a Customer-X-Mirepoix instance gets a routing configuration where their code never touches Anthropic or OpenAI APIs, and the on-prem appliance plus AWS-AMD-SEV-SNP fleet are sufficient to deliver Mirepoix's value without that data-flow. This is the architectural commitment that lets Kavara compete for federal POC work — Leidos, Anduril, Mercury, WWT — on equal footing with vendors who have always sold air-gap-capable solutions.

The second consequence is that the cost / quality / latency / locality trade-off is encoded in the manifest, not in the router. The router's job is to execute a policy; the policy's choices are visible in the bundle manifest and reviewed at build time. An operator reading a Customer-X-Mirepoix manifest knows exactly which tiers can serve which calls, which models are eligible, and which substrates are in scope. There is no hidden routing decision.

The third consequence is that we commit to running and maintaining a Qwen3-Coder fleet across three confidential-compute substrates. This is real operational work — KServe deployments, GPU provisioning on each cloud, attestation flows for the confidential boundaries, monitoring across three regions, capacity planning. The Phase 3A KServe pattern at GCP is the existence proof for one substrate; Phase Five-ish work extends it to Azure and to AWS with AMD SEV-SNP. We accept this cost because the alternative — pure hyperscaler routing — closes the federal customer market.

The fourth consequence is that the cascade pattern, validated in production by Uhura, becomes Mirepoix's default cost-optimization mechanism. Customers whose work is dominated by cheap-tractable steps (the inner agentic loops of plan-build-review pipelines, the high-volume mechanical edits in refactor sweeps) get the 40× cost reduction Uhura demonstrated. Kavara's gross margin on internal engineering use of Mirepoix improves accordingly.

The fifth consequence is that prompt caching becomes a first-class routing concern. We will model cache-prefix tracking inside the router, monitor cache hit rates per model, and feed the data back into the routing policy. Models that support caching effectively (Anthropic's prompt-caching API, OpenAI's KV-cache reuse, the self-hosted vLLM / KTransformers continuous-batching cache) will be preferred for stateful long-session work, even where their nominal price is higher.

The sixth consequence is that the eval-driven `mirepoix sweep` harness becomes load-bearing. Routing recommendations are not defended by intuition or by upstream marketing claims; they are defended by sweep results against a Kavara-shape eval suite. The first deliverable in the routing-extension implementation is the eval suite itself. We will not commit to a routing default that has not been sweep-validated.

The seventh consequence is that we have to be disciplined about not letting the router's complexity grow. The combinatorial space of (provider × model × substrate × task-class × cache-eligibility × customer-constraint) is large enough that a poorly-designed router could become a complexity sink. The architectural commitment is that the router is a function from typed inputs to a typed output, with the policy expressed declaratively in YAML or TypeScript per the bundle manifest. We will not let the router become a rule engine.

The eighth consequence is that the multi-substrate self-hosted fleet is itself a competitive moat. Operating Qwen3-Coder under AMD SEV-SNP on AWS ROSA, under Intel TDX on Azure, and under confidential GPU on GCP — with attested boundaries on each — is a non-trivial integration that most competitors will not replicate quickly. The Kirk MaaS pipeline already amortizes most of the substrate-engineering work; ADR-008 reuses that work for the model-routing layer.

The ninth consequence is that the router's pluggability — the fact that there are two first-class policies and that other policies can be added as extensions — is itself a Kavara-Mirepoix-public-extension candidate. The cascade and task-class routers are generic enough that publishing them as `public`-tagged extensions advertises Kavara's engineering taste without revealing IP. The customer-aware substrate selection logic stays `internal` because it encodes Kavara's customer-relationship knowledge.

The tenth consequence is that we have to keep the eval suite honest. An eval suite that is too easy will produce routing recommendations that overrate cheap tiers; an eval suite that is too hard will overrate frontier tiers. We will treat the eval suite as a versioned artifact, refresh it quarterly to track real Kavara work, and document it in `kavara-mirepoix-internal` because the specific eval prompts encode Kavara's engineering work patterns and are not for external publication.

## Alternatives considered

We considered a single-provider design — Anthropic only, or OpenAI only, or self-hosted only. Rejected. Single-provider is fragile against rate limits, vendor-side outages, and pricing shifts; it forecloses the customer-data-locality requirement that the MaaS business depends on; and it forces a single tier to handle work it is not optimal for, which is empirically wasteful per Uhura's numbers.

We considered cascade-only routing as the universal default. Rejected. Cascade is cost-optimal for high-volume cheap-tractable work but is suboptimal for SDLC-pipeline workloads where the verifiability principle dictates that some agent roles must use frontier models from the start. Forcing those roles through a cascade adds latency and retry cost without quality improvement.

We considered task-class-only routing. Rejected for the symmetric reason. Task-class routing is correct for SDLC pipelines but loses the cost optimization that cascade gives on the cheap-tractable inner loops of agentic work. The combined-policy model with bundle-level selection is the right shape.

We considered making the self-hosted tier single-substrate (start with GCP, add Azure later, AWS later). Rejected. The federal customer market has AWS-with-AMD-SEV-SNP as the primary near-term path per the Red Hat collaboration page; deferring it pushes that customer line back. The substrate pattern is the same across the three clouds (KServe, V2 OpenInference, confidential boundary, attestation), so the cost of doing all three from the start is amortized, not tripled.

We considered serving Qwen3-Coder on AMX-only CPUs (Intel SPR / GNR with KTransformers). Rejected as the production default. AMX-based serving of a 480B-A35B MoE is feasible (KTransformers reports usable token-per-second on dual-socket SPR) but the throughput is too slow for the inner agent loop. We retain AMX serving as a fallback for the on-prem-appliance tier when GPU capacity is unavailable inside the customer's Trust Domain.

We considered using a smaller open-weights coding model (DeepSeek-Coder-V3, smaller Qwen3-Coder variants, Code Llama variants) as the self-hosted default to reduce GPU footprint. Rejected for now in favor of Qwen3-Coder-480B-A35B-Instruct because Joe Stein's empirical recommendation, the model's Sonnet-comparable benchmark numbers, the Apache 2.0 licensing, the 256K native context, and the explicit agentic-coding tool-call format all make it the strongest open candidate. We may revisit if sweep results show that a smaller model is sufficient for the work distribution we actually have.

We considered not committing to a specific model name in the ADR, on the theory that the model market moves fast enough that any specific name will date. Rejected. The pace of progress is high but the architectural decisions to commit to (the four-tier model, the multi-substrate fleet, the cascade-and-task-class routing, the eval-driven validation) are stable. The specific model name is captured here because operators reading the ADR need to know what is currently configured; if Qwen3-Coder-480B-A35B-Instruct is superseded by a better open model, a superseding ADR captures the swap.

We considered building a Kavara-managed routing API as a service that all Kavara-Mirepoix instances call into, to centralize observability and policy enforcement. Rejected for now. Routing-as-a-service introduces a single point of failure, requires us to operate yet another piece of infrastructure, and conflicts with ADR-005's commitment to operator-owned context (the routing decision is a context-shaping act). The router runs in-process for each Kavara-Mirepoix instance, and observability is a matter of consuming the session log per ADR-005.

## Implementation notes

The `Provider` and `Model` types live in `packages/mirepoix-ai/src/types.ts`. A provider implementation is a class implementing the `Provider` interface — `complete(request) → response | toolCall`, with streaming and cancellation. The Anthropic provider lives in `packages/mirepoix-ai/src/providers/anthropic.ts`; the OpenAI provider in `packages/mirepoix-ai/src/providers/openai.ts`; the self-hosted KServe provider in `packages/mirepoix-ai/src/providers/kserve.ts` (one provider implementation, multiple endpoint configurations); the appliance provider in `packages/mirepoix-ai/src/providers/appliance.ts`. The KServe provider speaks V2 OpenInference, matching the existing Phase 3A pattern.

The `Router` interface lives in `packages/mirepoix-ai/src/router.ts`. Kavara-Mirepoix ships two extensions implementing it: `kavara-mirepoix-router-cascade` and `kavara-mirepoix-router-task-class`. Both are tagged `public` per ADR-007 and intended for external visibility — they are the cleanest pieces of Kavara taste to advertise. The customer-constraint-aware substrate selection logic is a separate router extension, `kavara-mirepoix-router-substrate-aware`, tagged `internal`, that wraps the public routers and adds substrate selection on top.

The bundle manifest format gains a `routing` block:

```yaml
routing:
  policy: cascade  # or task-class
  tiers:
    - name: anthropic
      enabled: true
      models: [claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5]
    - name: openai
      enabled: false  # opt-in per session
      models: [codex]
    - name: self-hosted
      enabled: true
      endpoints:
        - substrate: gcp-confidential-spr
          url: https://qwen-gcp.kavara.internal/v2
          model: qwen3-coder-480b-a35b
        - substrate: azure-tdx-spr
          url: https://qwen-azure.kavara.internal/v2
          model: qwen3-coder-480b-a35b
        - substrate: aws-rosa-amd-sev-snp
          url: https://qwen-aws.kavara.internal/v2
          model: qwen3-coder-480b-a35b
    - name: appliance
      enabled: false  # enabled in Customer-X-Mirepoix remixes only
      endpoint:
        substrate: on-prem-tdx-appliance
        url: ${APPLIANCE_LOCAL_URL}
        model: qwen3-coder-480b-a35b
```

Customer-X-Mirepoix remixes override this block to enable only the tiers and substrates the customer's contract permits. The bundler validates the override against a manifest schema that lives at `schema/routing.schema.json` and refuses to ship a bundle where the routing block contradicts the bundle's distribution target.

The `mirepoix sweep` command lives at `packages/mirepoix-cli/src/commands/sweep.ts`. It accepts an eval-suite manifest (a YAML file pointing at prompts, expected outputs or rubrics, and optional ground-truth results), a routing-grid manifest (which models, which routers, which task classes to test), and an output path. It runs each cell in parallel, captures wall-clock latency, output-token cost, tool-call success, and rubric-validated quality, and writes a CSV leaderboard plus a Pareto-frontier visualization. The CLI shape mirrors `bdata sweep` deliberately, so Kavara engineers carry one mental model for "how do we decide this empirically" between Tiberius and Mirepoix work.

The eval suite for Kavara-coding work lives in `kavara-mirepoix-internal/eval-suites/coding/`. It is an internal artifact; the prompts encode Kavara's actual engineering work and are not for external publication. The first version covers TGE-shape tensor-pipeline work, OpenShift manifest editing, Kafka troubleshooting (mTLS, ACL, Strimzi), kernel-RT analysis, Tiberius SOR threshold sweeps, and a small set of customer-deployment runbook generations. We refresh quarterly.

Prompt-cache tracking is implemented in `packages/mirepoix-ai/src/cache.ts` as a session-scoped prefix tracker. Each provider declares its cache-eligibility predicate (Anthropic: prefixes >= 1024 tokens with the cache-control marker; OpenAI: prefix re-use within session; self-hosted: continuous-batching cache hit rate). The router consults the predicate when picking among models in the same tier. The cache state never leaves the in-process router; it is not persisted across sessions because the session log per ADR-005 is the persistence layer and re-reading it on each turn defeats the purpose of caching.

The first eval run is scheduled for the end of Phase Two, before any Kavara-Mirepoix routing default is committed to. Phase Zero through Phase Two operate against a hand-tuned default (cascade with Anthropic-only) so the spike work is unblocked. Phase Three's deliverable explicitly includes the first sweep result and its routing-recommendation update.
