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
  tour: TourStep[];
  meta: {
    generatedAt: string;
    generatorVersion: string;
    schemaVersion: string;
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

/** Face-off review verdict from one reviewer. */
export interface FaceOffVerdict {
  reviewer: "claude" | "codex" | "codestral" | "granite" | string;
  verdict: "approve" | "block";
  notes: string;
  dispatchId: string;
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
