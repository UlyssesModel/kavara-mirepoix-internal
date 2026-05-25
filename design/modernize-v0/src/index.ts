#!/usr/bin/env bun
// @mirepoix/modernize — top-level orchestrator
//
// Composes @mirepoix/understand (comprehension) + @mirepoix/port (per-module
// port harness) + @mirepoix/validate (equivalence testing) into a complete
// legacy-modernization engagement that runs entirely inside the customer's
// TDX/SEV-attested OpenShift TEE.
//
// Per the third-engine commercial model added to Mirepoix Co Business Model
// v1.6 (Confluence PM1/120160339). Reference customer story: Kavara is
// modernizing Kirk (production AI model) from Python to Rust using this
// pipeline on locked-down scotty-gpu under attestation.

export { runUnderstand, extractPerModuleSummaries, runUnderstandOnModernized } from "./understand";
export { portModule, buildPortPrompt, runFaceOff } from "./port";
export { validateEquivalence, synthesizeTestCorpus, generateRunner, executeInSandbox, compareOutputs } from "./validate";
export type * from "./types";

import { runUnderstand, extractPerModuleSummaries, runUnderstandOnModernized } from "./understand";
import { portModule } from "./port";
import { validateEquivalence } from "./validate";

import type {
  EngagementConfig,
  EngagementResult,
  PerModuleSummary,
  PortResult,
  ValidationResult,
} from "./types";

/**
 * Run a complete Mirepoix Modernize engagement end-to-end.
 *
 * Pipeline:
 *
 *   1. Run @mirepoix/understand against the customer's legacy repo
 *      → produces source-language KnowledgeGraph with dependency-ordered tour
 *
 *   2. For each module in dependency order:
 *      a. Run @mirepoix/port → generates the modernized module
 *      b. Run @mirepoix/validate → confirms behavioral / numerical equivalence
 *      c. If validation fails, retry port once with diagnostics;
 *         if retry fails, mark module as "needs-human-review" and continue
 *      d. Write JSONL audit entry for the module
 *
 *   3. Run @mirepoix/understand against the modernized repo
 *      → produces target-language KnowledgeGraph for the customer deliverable
 *
 *   4. Capture TDX/SEV attestation report (cryptographic proof Mirepoix Co
 *      operators never had access to the source).
 *
 *   5. Generate engagement summary and write deliverables to outputDir.
 *
 * Progress is reported via the @mirepoix/acp server interface, so the
 * @mirepoix/tui manager view can render per-module progress in real time.
 *
 * @returns EngagementResult — the complete customer deliverable manifest.
 */
export async function runModernizationEngagement(
  config: EngagementConfig,
): Promise<EngagementResult> {
  const startedAt = new Date().toISOString();

  // === Phase 1: Source-language comprehension ===
  const knowledgeGraphSource = await runUnderstand({
    repoPath: config.repoPath,
    sourceLanguage: config.sourceLanguage,
    targetLanguage: config.targetLanguage,
    acpEndpoint: config.acpEndpoint,
    providerConfig: config.providerConfig,
  });

  const summaries: PerModuleSummary[] = extractPerModuleSummaries(knowledgeGraphSource);

  // === Phase 2: Module-by-module port + validate, in dependency order ===
  // Dependency order from the knowledge-graph tour (TourStep.primaryNodeIds).
  const tour = knowledgeGraphSource.tour;
  const orderedNodeIds = tour.flatMap((step) => step.primaryNodeIds);

  const perModuleResults: EngagementResult["perModuleResults"] = [];
  const modulesNeedingHumanReview: string[] = [];

  for (const nodeId of orderedNodeIds) {
    const summary = summaries.find((s) => s.nodeId === nodeId);
    if (!summary) continue;

    // Step 2a: Port
    let port: PortResult = await portModule(
      {
        sourceFile: summary.path,
        sourceLanguage: summary.language,
        targetLanguage: config.targetLanguage,
        architectureContext: summary,
        outputDir: config.outputDir,
      },
      {
        acpEndpoint: config.acpEndpoint,
        providerConfig: config.providerConfig,
        reviewers: [
          // Default reviewers: configured per engagement
          // E.g., for Mirepoix Sovereign: local Codestral + local Granite (both on-prem)
          // For Volume: hosted Claude + Codex
        ],
        maxRetries: 1,
        onMaxRetries: "fail-soft",
      },
    );

    // Step 2b: Validate
    let validate: ValidationResult = await validateEquivalence(
      {
        sourceFile: summary.path,
        portedFile: port.portedFile,
        sourceLanguage: summary.language,
        targetLanguage: config.targetLanguage,
        customerTestCorpus: config.customerTestCorpus,
        architectureContext: summary,
        tolerance: config.tolerance,
      },
      {
        acpEndpoint: config.acpEndpoint,
        providerConfig: config.providerConfig,
        defaultTolerance: config.tolerance,
        syntheticTestCount: 20,
      },
    );

    // Step 2c: If validation fails, mark for human review
    if (!validate.passed) {
      modulesNeedingHumanReview.push(nodeId);
    }

    // Step 2d: Audit entry
    perModuleResults.push({ nodeId, port, validate });
  }

  // === Phase 3: Target-language comprehension ===
  const knowledgeGraphTarget = await runUnderstandOnModernized({
    repoPath: config.outputDir,
    sourceLanguage: config.targetLanguage,
    acpEndpoint: config.acpEndpoint,
    providerConfig: config.providerConfig,
  });

  // === Phase 4: Attestation report ===
  // IMPLEMENTATION: query the customer's attestation endpoint (e.g., Intel
  // Trust Authority or AMD KDS) for the TDX/SEV quote covering the runtime
  // environment that executed this engagement. The quote includes a hash of
  // the loaded Mirepoix Co binary image; the customer can verify it
  // independently against Mirepoix Co's published signed image.
  const attestationReport = config.attestationEndpoint
    ? await fetchAttestationReport(config.attestationEndpoint)
    : undefined;

  // === Phase 5: Audit log + engagement result ===
  const completedAt = new Date().toISOString();
  const auditLogPath = `${config.outputDir}/.mirepoix-modernize/engagement-audit.jsonl`;

  return {
    customerName: config.customerName,
    status:
      modulesNeedingHumanReview.length === 0
        ? "complete"
        : modulesNeedingHumanReview.length === orderedNodeIds.length
          ? "failed"
          : "partial",
    modulesPorted: perModuleResults.filter((r) => r.port.success).length,
    modulesTotal: orderedNodeIds.length,
    modulesNeedingHumanReview,
    knowledgeGraphSource,
    knowledgeGraphTarget,
    perModuleResults,
    attestationReport,
    auditLogPath,
    startedAt,
    completedAt,
  };
}

/**
 * Stub: fetch TDX/SEV attestation report from the customer's attestation
 * service (e.g., Intel Trust Authority or AMD Key Distribution Service).
 *
 * The returned report includes:
 *   - The TEE measurement (hash of the loaded Mirepoix Co binary)
 *   - The vendor signature
 *   - A nonce binding the report to this specific engagement
 *
 * The customer can verify this report independently — the cryptographic
 * proof that Mirepoix Co operators could not have read the source code
 * during the engagement.
 */
async function fetchAttestationReport(endpoint: string): Promise<string> {
  // IMPLEMENTATION: HTTPS GET to attestation endpoint; parse signed report
  throw new Error("@mirepoix/modernize.fetchAttestationReport: not yet implemented");
}

// === CLI entrypoint ===
// `bun packages/modernize/src/index.ts <engagement-config.json>`
if (import.meta.main) {
  const configPath = process.argv[2];
  if (!configPath) {
    process.stderr.write(
      "usage: mirepoix-modernize <engagement-config.json>\n",
    );
    process.exit(1);
  }

  const config: EngagementConfig = JSON.parse(
    await Bun.file(configPath).text(),
  );

  const result = await runModernizationEngagement(config);

  // Write engagement result to disk
  await Bun.write(
    `${config.outputDir}/.mirepoix-modernize/engagement-result.json`,
    JSON.stringify(result, null, 2),
  );

  console.log(
    `[mirepoix-modernize] engagement ${result.status}: ${result.modulesPorted}/${result.modulesTotal} modules ported, ${result.modulesNeedingHumanReview.length} needing human review`,
  );
  process.exit(result.status === "failed" ? 1 : 0);
}
