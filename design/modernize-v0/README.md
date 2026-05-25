# @mirepoix/modernize — package design scaffold

**Status:** Design artifact, 2026-05-25. Pre-implementation sketch. To be ported to `kavara-mirepoix-internal/packages/modernize/` (or split into `packages/{understand,port,validate,modernize}/`) as the v0.2.0-α-3 work item.

This directory contains the package design for `@mirepoix/modernize` — the top-level orchestrator that composes Mirepoix's pipeline into a finite legacy-modernization engagement. It is the engine behind the **Mirepoix Modernize** commercial product.

## Architecture overview

```
@mirepoix/modernize  (orchestrator — top-level package)
   │
   ├─ depends on  @mirepoix/understand    (codebase comprehension — wraps Understand-Anything)
   │   └─ depends on  @mirepoix/acp        (talks to N parallel Mirepoix sessions)
   │
   ├─ depends on  @mirepoix/port           (per-module port harness)
   │   └─ depends on  @mirepoix/core       (on-loop pipeline)
   │   └─ depends on  @mirepoix/coding     (tools)
   │   └─ depends on  @mirepoix/ai         (provider abstraction; local Qwen by default)
   │
   ├─ depends on  @mirepoix/validate       (equivalence test generator + runner)
   │   └─ depends on  @mirepoix/coding     (test-file write tools)
   │
   └─ depends on  @mirepoix/core           (Bus<MirepoixEvent>, Session — directly for orchestrator-level audit)
```

Each sub-package has a single clear responsibility. The top-level `modernize` orchestrator composes them.

## The four sub-packages

### `@mirepoix/understand`

**Purpose:** Wrap the Understand-Anything multi-agent pipeline as a Mirepoix workflow against local Qwen on the A100.

**Inputs:**
- `repoPath: string` — absolute path to the legacy codebase
- `targetLanguage: string` — what to port to (informs the architecture-analyzer's focus)
- `acpEndpoint: string` — the `@mirepoix/acp` server URL for spawning parallel sub-sessions

**Outputs:**
- `KnowledgeGraph` — schema-compatible with the upstream Understand-Anything dashboard
- `DependencyOrderedTour` — list of modules to port in dependency order
- `PerModuleSummary[]` — short narrative per module (used as port-prompt context)
- `IntermediateFiles[]` — `.understand-anything/intermediate/*` for forensic replay

**Pipeline phases** (mirror upstream Understand-Anything):

1. Deterministic scan (`scan-project.mjs` + `extract-import-map.mjs`)
2. Per-file analysis (fan out N parallel `@mirepoix/acp` sessions, one per file batch)
3. Project-level scanner (single Mirepoix session synthesizing per-file outputs)
4. Architecture analyzer (sequential)
5. Domain analyzer (sequential)
6. Assemble reviewer (multi-agent face-off pattern — ADR-013)
7. Knowledge-graph reviewer (face-off again)
8. Tour builder (12-step dependency-ordered)

### `@mirepoix/port`

**Purpose:** Per-module port harness. Takes one module from the legacy codebase + its target language + the architecture context, and produces a ported version.

**Inputs:**
- `sourceFile: string` — path to the legacy module
- `sourceLanguage: string` — language of the source
- `targetLanguage: string` — language to port to
- `architectureContext: PerModuleSummary` — from `@mirepoix/understand`
- `providerConfig: ProviderConfig` — Mirepoix provider config (typically local Qwen)
- `acpEndpoint: string` — for face-off sub-sessions

**Outputs:**
- `portedFile: string` — generated target-language source
- `dependencies: string[]` — package / crate / module dependencies the new code needs
- `notes: string[]` — gotchas, deviations, manual-review-recommended sections
- `auditLog: MirepoixEvent[]` — full session JSONL for the port turn

**Pipeline:**

1. Read source file (Mirepoix `read` tool)
2. Construct port prompt (template includes architecture context + source + target-language conventions)
3. Run on-loop session against the prompt
4. Multi-agent face-off review: parallel Claude + Codex (or Codex + Codestral on-prem) review the diff
5. If either reviewer blocks, retry once with the review feedback as additional context
6. Write port to disk under `<output_dir>/`

### `@mirepoix/validate`

**Purpose:** Generate behavioral / numerical equivalence tests, run them, return pass/fail with diagnostics.

**Inputs:**
- `sourceFile: string` — legacy module
- `portedFile: string` — modernized module
- `sourceLanguage: string`
- `targetLanguage: string`
- `customerTestCorpus?: TestCorpus` — optional customer-provided test inputs (the equivalence oracle)
- `architectureContext: PerModuleSummary` — module's intent / public interface

**Outputs:**
- `result: { passed: boolean; details: TestResult[] }`
- `equivalenceReport: string` — human-readable summary
- `auditLog: MirepoixEvent[]`

**Pipeline:**

1. **Synthesize test cases.** If `customerTestCorpus` is provided, use it directly. Otherwise, generate test inputs covering: typical inputs (architecture-context-informed), boundary cases, error cases.
2. **Generate test runner for source language.** Mirepoix session writes a test script that invokes the source module with each input and captures output.
3. **Generate test runner for target language.** Same for the ported module.
4. **Execute both runners in sandboxed containers.**
5. **Compare outputs.** For numerical outputs, validate within tolerance (Kirk-precursor pattern: 10 decimal places). For structured outputs, deep-equal with comparator. For side-effects (writes, network, etc.), capture and compare.
6. **Produce equivalence report.** Pass = "the ported module is behaviorally indistinguishable from the source for all tested inputs." Fail = "these inputs produced divergent outputs: ..." with diagnostics.

### `@mirepoix/modernize` (top-level orchestrator)

**Purpose:** Run a complete modernization engagement end-to-end. Compose the three sub-packages with engagement-level orchestration.

**Inputs:**
- `engagementConfig: EngagementConfig` — customer name, repo path, source/target languages, acceptance criteria, output paths

**Outputs:**
- `EngagementResult` — modernization deliverables (ported repo, test suite, audit trail, knowledge graph, attestation report)

**Pipeline:**

1. Run `@mirepoix/understand` against the repo → produces architecture graph + dependency-ordered tour
2. For each module in dependency order:
   - Run `@mirepoix/port` to generate the port
   - Run `@mirepoix/validate` to confirm equivalence
   - If equivalence fails, retry port with diagnostics; if retry fails, mark module as needs-human-review
   - Write JSONL audit entry
3. After all modules ported: re-run `@mirepoix/understand` against the modernized repo → produces target-language knowledge graph
4. Generate engagement summary report (deliverables manifest)
5. Surface attestation report (TDX/SEV quote from the TEE substrate)

**Manager view integration:** the orchestrator exposes per-module progress via the `@mirepoix/acp` server interface, so the v0.2.0 manager-view TUI can render N concurrent module-ports in flight.

## Why this composition

The four-package split mirrors Mirepoix's existing layered design (`@mirepoix/{ai,coding,core,cli,acp,tui}`). Each package has one responsibility; the top-level orchestrator does the composition.

This split has three benefits:

1. **Each sub-package is independently useful.** `@mirepoix/understand` becomes a standalone product for "build a knowledge graph of my codebase." `@mirepoix/port` becomes a developer tool for "port this file." `@mirepoix/validate` becomes a CI integration for "is this port equivalent?" These are valid v0.3.0+ products even outside the Modernize engagement context.
2. **Customer-discovery experiments are cheaper.** "Pay for the Understand layer first" might be a $20-50K trial that converts to a full Modernize engagement.
3. **Composability with future engines.** When Mirepoix Co adds a "Security Modernization" or "Performance Optimization" engagement type, those reuse `@mirepoix/understand` and add their own port/validate equivalents. The substrate compounds.

## Implementation order

For v0.2.0-α-3 (after v0.2.0-α-1 manager view and v0.2.0-α-2 Mirepoix-native Understand-Anything orchestrator):

1. **Week 1-2:** `@mirepoix/understand` v0 — Mirepoix-native orchestrator that produces the same `knowledge-graph.json` schema the upstream React dashboard expects, but running on local Qwen via `@mirepoix/acp` parallel sessions. Validate on `kavara-mirepoix-internal` (compare to the 2026-05-25 Anthropic-driven run).
2. **Week 3-4:** `@mirepoix/port` v0 — per-module port harness. Validate on Kirk-precursor PyTorch MLP fixture.
3. **Week 5-6:** `@mirepoix/validate` v0 — equivalence test generator + runner. Validate on the same fixture; demonstrate it catches deliberately-broken ports.
4. **Week 7-8:** `@mirepoix/modernize` orchestrator. End-to-end engagement against the Kirk-precursor-extended fixture (a small but multi-module Python repo).
5. **Week 9-12:** Apply to actual Kirk full port. Capture engagement timing, costs, deliverable shape — becomes the reference customer case study.

## Files in this scaffold

This directory contains design-stub files for the package, not production code:

- `README.md` — this file
- `package.json` — top-level `@mirepoix/modernize` package
- `src/index.ts` — entry point + main `Modernize` orchestrator class
- `src/types.ts` — shared type signatures across the four sub-packages
- `src/understand.ts` — `@mirepoix/understand` interface sketch
- `src/port.ts` — `@mirepoix/port` interface sketch
- `src/validate.ts` — `@mirepoix/validate` interface sketch

The stubs use type signatures + JSDoc to capture the design intent without implementing the bodies. The implementation belongs in the kavara-mirepoix-internal monorepo, where it can use the existing `@mirepoix/{ai,coding,core,cli,acp,tui}` packages.

## Next session start

Open this directory + `mirepoix-modernize-product-spec.md` + the `project_mirepoix_modernize_product_thesis` memory entry. The thesis is clear; the design is sketched. Pick up by:

1. Reviewing the six open architectural questions in `project_mirepoix_v020_manager_view_plan` memory (Ink vs ratatui, sub-agent dispatch, etc.) — these decisions block both v0.2.0-α-1 (manager view) and v0.2.0-α-3 (`@mirepoix/modernize`)
2. Decide the implementation order (above) and create the GitHub branch
3. Begin `@mirepoix/understand` v0 against the kavara-mirepoix-internal monorepo (smallest, most-tractable first target)
