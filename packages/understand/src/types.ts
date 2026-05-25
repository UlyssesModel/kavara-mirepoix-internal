// @mirepoix/modernize — shared types
// Design stubs. Production split into packages/{understand,port,validate,modernize}/src/types.ts.

import type { MirepoixEvent } from "@mirepoix/core";

/** Language identifier — use Linguist names (e.g. "Python", "Rust", "C++", "TypeScript", "COBOL"). */
export type Language = string;

// =============================================================================
// @mirepoix/understand types
// =============================================================================

/** A node in the knowledge graph (file / function / class / config / pipeline-step / document). */
export interface GraphNode {
  id: string;
  type: "file" | "function" | "class" | "config" | "pipeline-step" | "document";
  name: string;
  path: string;
  language?: Language;
  summary: string;
  complexity: "simple" | "moderate" | "complex";
  layer?: string;
}

/** An edge between nodes. */
export interface GraphEdge {
  from: string;
  to: string;
  type:
    | "imports"
    | "calls"
    | "contains"
    | "depends_on"
    | "configures"
    | "documents"
    | "triggers"
    | "exports"
    | "related";
}

/** Architectural layer aggregation. */
export interface ArchitecturalLayer {
  id: string;
  name: string;
  description: string;
  fileIds: string[];
  complexity: "simple" | "moderate" | "complex";
}

/** Business-domain aggregation. The second SYNTHESIS-pass LLM phase identifies
 *  the user-facing processes the codebase implements (e.g. "code-comprehension",
 *  "payment-processing") and assigns each architectural layer to exactly one
 *  primary domain. `fileIds` is expanded post-hoc by the orchestrator from
 *  `layerIds` via the architecture's `layer.fileIds` mapping — the LLM never
 *  enumerates files directly. Many-to-one cardinality is the v0 contract (see
 *  packages/understand/src/llm/domain-analyzer.ts for the rationale). */
export interface BusinessDomain {
  id: string;
  name: string;
  description: string;
  /** Architectural-layer ids that participate in this domain. Must be a subset
   *  of the layers from the upstream architecture-analyzer phase. */
  layerIds: string[];
  /** Files belonging to this domain — expanded deterministically from
   *  `layerIds` via the architecture's `layer.fileIds` mapping. */
  fileIds: string[];
  complexity: "simple" | "moderate" | "complex";
}

/** Knowledge graph — output of @mirepoix/understand. Schema-compatible with the upstream Understand-Anything dashboard. */
export interface KnowledgeGraph {
  project: {
    name: string;
    description: string;
    rootPath: string;
    languages: Language[];
    frameworks: string[];
    fileCount: number;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: ArchitecturalLayer[];
  /** Business-domain aggregation. Each architectural layer belongs to exactly
   *  one domain; each domain's `fileIds` is the union of its member layers'
   *  files. v0 contract owned by the upstream domain-analyzer phase. */
  domains: BusinessDomain[];
  tour: TourStep[];
  meta: {
    generatedAt: string;
    generatorVersion: string;
    schemaVersion: string;
    /** In-product face-off review audit trail, split by pipeline phase so each
     *  verdict is attributable to the artifact it was rendered on:
     *    - `assemble`: verdicts from the assemble-reviewer pair (Commit 8),
     *      rendered against the freshly-assembled graph BEFORE tour generation.
     *      Targets contract / completeness defects in the assembly process.
     *    - `graph`: verdicts from the graph-reviewer pair (Commit 9), rendered
     *      against the FINAL graph-with-tour as customer-facing QA. Targets
     *      representativeness defects — does this graph "make sense" as the
     *      documentation a new engineer would read first?
     *  Both arrays are populated each run; an empty inner array means the
     *  corresponding face-off phase did not execute (deterministic earlier
     *  pipelines like scan-with-assembler leave `graph: []`). */
    faceOffVerdicts: {
      assemble: FaceOffVerdict[];
      graph: FaceOffVerdict[];
    };
  };
}

/** A single step of the dependency-ordered tour. */
export interface TourStep {
  stepNumber: number;
  title: string;
  description: string;
  primaryNodeIds: string[];
  relatedNodeIds: string[];
}

/** Per-module narrative summary used as port-prompt context. */
export interface PerModuleSummary {
  nodeId: string;
  path: string;
  language: Language;
  purpose: string;
  publicInterface: string;
  dependencies: string[];
  notes: string[];
}

// =============================================================================
// @mirepoix/port types
// =============================================================================

/** Inputs to a single module port. */
export interface PortRequest {
  sourceFile: string;
  sourceLanguage: Language;
  targetLanguage: Language;
  architectureContext: PerModuleSummary;
  outputDir: string;
}

/** Outputs from a single module port. */
export interface PortResult {
  success: boolean;
  portedFile: string;
  targetLanguage: Language;
  dependencies: string[];
  notes: string[];
  retries: number;
  auditLog: MirepoixEvent[];
  faceOffVerdicts: FaceOffVerdict[];
}

/** Face-off review verdict from one reviewer. v0 audit-trail shape — recorded
 *  verbatim in KnowledgeGraph.meta.faceOffVerdicts when the in-product
 *  face-off review runs against an artifact (per ADR-013). Reviewer rosters
 *  in v0:
 *    - Assemble-reviewer pair (Commit 8, against the assembled graph):
 *      "claude-reviewer" + "codex-adversarial".
 *    - Graph-reviewer pair (Commit 9, against the graph-with-tour):
 *      "claude-graph-reviewer" + "codex-graph-adversarial".
 *  The union widens to `string` because the reviewer roster grows over time
 *  ("codestral", "granite") without locking the audit-trail consumers. */
export interface FaceOffVerdict {
  reviewer:
    | "claude-reviewer"
    | "codex-adversarial"
    | "claude-graph-reviewer"
    | "codex-graph-adversarial"
    | string;
  verdict: "approve" | "block";
  /** The reviewer's findings text, verbatim. Never paraphrased — operators
   *  audit the trail and need the raw output. */
  notes: string;
  /** ACP session id for trace-back into the @mirepoix/acp session log. */
  acpSessionId: string;
  /** Wall-clock for this reviewer's session (initialize → end_turn). */
  durationMs: number;
  /** ISO 8601 timestamp recorded at session start. */
  timestamp: string;
}

// =============================================================================
// @mirepoix/validate types
// =============================================================================

/** Optional customer-provided test corpus — the equivalence oracle. */
export interface TestCorpus {
  format: "json" | "yaml" | "custom";
  cases: TestCase[];
}

/** A single test case: input → expected behavioral output. */
export interface TestCase {
  id: string;
  description?: string;
  input: unknown;
  expectedOutput?: unknown;
  tolerance?: number;
}

/** Inputs to a validation run. */
export interface ValidationRequest {
  sourceFile: string;
  portedFile: string;
  sourceLanguage: Language;
  targetLanguage: Language;
  customerTestCorpus?: TestCorpus;
  architectureContext: PerModuleSummary;
  tolerance: number;
  sandboxImage?: string;
}

/** Outputs from a validation run. */
export interface ValidationResult {
  passed: boolean;
  testCount: number;
  failureCount: number;
  details: TestResult[];
  equivalenceReport: string;
  auditLog: MirepoixEvent[];
}

/** Per-test result. */
export interface TestResult {
  caseId: string;
  passed: boolean;
  sourceOutput?: unknown;
  targetOutput?: unknown;
  divergenceNote?: string;
}

// =============================================================================
// @mirepoix/modernize (top-level orchestrator) types
// =============================================================================

/** Engagement-level configuration. */
export interface EngagementConfig {
  customerName: string;
  repoPath: string;
  sourceLanguage: Language;
  targetLanguage: Language;
  outputDir: string;
  customerTestCorpus?: TestCorpus;
  tolerance: number;
  attestationEndpoint?: string;
  acpEndpoint: string;
  providerConfig: {
    url: string;
    model: string;
  };
}

/** Engagement result — what gets delivered to the customer. */
export interface EngagementResult {
  customerName: string;
  status: "complete" | "partial" | "failed";
  modulesPorted: number;
  modulesTotal: number;
  modulesNeedingHumanReview: string[];
  knowledgeGraphSource: KnowledgeGraph;
  knowledgeGraphTarget: KnowledgeGraph;
  perModuleResults: Array<{
    nodeId: string;
    port: PortResult;
    validate: ValidationResult;
  }>;
  attestationReport?: string;
  auditLogPath: string;
  startedAt: string;
  completedAt: string;
}
