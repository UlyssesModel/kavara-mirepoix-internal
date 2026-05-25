// @mirepoix/port — per-module port harness
// Takes one module from the legacy codebase + its target language +
// architecture context, runs it through Mirepoix's on-loop pipeline with
// multi-agent face-off review, and produces a ported version with
// retry-on-block semantics.
//
// Extends today's Kirk-precursor demo pattern (PyTorch MLP → Rust port with
// 10-decimal-match validation) to arbitrary language pairs.

import type {
  PortRequest,
  PortResult,
  FaceOffVerdict,
} from "./types";

/** Configuration for the port operation. */
export interface PortConfig {
  /** @mirepoix/acp endpoint for face-off sub-sessions. */
  acpEndpoint: string;

  /** Primary provider config (typically local Qwen for the port itself). */
  providerConfig: {
    url: string;
    model: string;
  };

  /** Face-off reviewers — one or more secondary providers for review. */
  reviewers: Array<{
    name: "claude" | "codex" | "codestral" | "granite" | string;
    providerConfig: { url: string; model: string };
  }>;

  /** Maximum retries on face-off block. Default: 1 (per the qwen3-coder quirk memory). */
  maxRetries?: number;

  /** Whether to fail-soft (mark needs-human-review) or fail-hard on max-retries-exhausted. */
  onMaxRetries?: "fail-soft" | "fail-hard";
}

/**
 * Port a single module from source → target language.
 *
 * Pipeline (extends Kirk-precursor demo pattern):
 *
 *   1. Read source file via Mirepoix `read` tool.
 *   2. Construct port prompt:
 *      - Architecture context (purpose, public interface, dependencies)
 *      - Source code
 *      - Target-language conventions + idioms hint
 *      - Plain-prose instruction (avoid qwen3-coder tool-format quirk)
 *   3. Run @mirepoix/core run() loop against the prompt.
 *   4. Multi-agent face-off review:
 *      - Spawn N parallel @mirepoix/acp sessions, one per reviewer
 *      - Each reviewer sees the source + the port + the architecture context
 *      - Each emits an approve|block verdict with notes
 *   5. If any reviewer blocks AND retries remain:
 *      - Construct retry prompt with the blocking reviewer's notes as feedback
 *      - GOTO step 3
 *   6. Write final port to outputDir.
 *   7. Return PortResult with audit log + face-off verdicts.
 *
 * @returns PortResult with success flag, output path, dependencies extracted,
 *          audit log, and all face-off verdicts.
 */
export async function portModule(
  request: PortRequest,
  config: PortConfig,
): Promise<PortResult> {
  // IMPLEMENTATION:
  //   const sourceCode = await readFile(request.sourceFile);
  //   let retries = 0;
  //   let portedCode: string;
  //   let verdicts: FaceOffVerdict[] = [];
  //
  //   while (retries <= (config.maxRetries ?? 1)) {
  //     const promptText = buildPortPrompt(request, sourceCode, verdicts);
  //     const session = await runMirepoixSession(promptText, config.providerConfig);
  //     portedCode = extractGeneratedCode(session);
  //
  //     verdicts = await runFaceOff(sourceCode, portedCode, request, config.reviewers);
  //     if (verdicts.every(v => v.verdict === "approve")) break;
  //     retries++;
  //   }
  //
  //   const writeSuccess = verdicts.every(v => v.verdict === "approve") || config.onMaxRetries === "fail-soft";
  //   if (writeSuccess) {
  //     await writePortedFile(request.outputDir, portedCode);
  //   }
  //
  //   return {
  //     success: writeSuccess,
  //     portedFile: writeSuccess ? path.join(request.outputDir, derivedName) : "",
  //     targetLanguage: request.targetLanguage,
  //     dependencies: extractDependencies(portedCode, request.targetLanguage),
  //     notes: collectNotes(verdicts),
  //     retries,
  //     auditLog: session.bus.eventLog(),
  //     faceOffVerdicts: verdicts,
  //   };
  throw new Error("@mirepoix/port: not yet implemented (v0.2.0-α-3 work item)");
}

/**
 * Build the port prompt. Plain prose (avoid qwen3-coder XML-tool-format
 * hallucination quirk; see feedback_qwen3_coder_tool_format_quirk memory).
 *
 * Prompt structure:
 *   1. Identity: "You are porting a {sourceLanguage} module to {targetLanguage}."
 *   2. Context: architecture summary, public interface, dependencies
 *   3. Conventions: target-language idioms (e.g., "Use Result<T, E> for error handling in Rust")
 *   4. Source: the actual source code
 *   5. Retry feedback (if any): "Previous attempt was blocked by reviewer X with the note: ..."
 *   6. Task: "Save the ported {targetLanguage} file to {outputPath}."
 *
 * Notably AVOIDS "use the write tool" phrasing — let the model decide tool selection.
 */
export function buildPortPrompt(
  request: PortRequest,
  sourceCode: string,
  previousVerdicts: FaceOffVerdict[],
): string {
  // IMPLEMENTATION sketches the prompt template; production version is per-language pair
  throw new Error("@mirepoix/port.buildPortPrompt: not yet implemented");
}

/**
 * Run multi-agent face-off review on the port.
 *
 * Spawns parallel @mirepoix/acp sessions (one per reviewer), each receiving:
 *   - Source code
 *   - Ported code
 *   - Architecture context
 *   - Acceptance criteria
 *
 * Each reviewer emits an approve|block verdict with notes. Returns all verdicts.
 *
 * Reviewers do NOT see each other's verdicts — independent review per ADR-013.
 */
export async function runFaceOff(
  sourceCode: string,
  portedCode: string,
  request: PortRequest,
  reviewers: PortConfig["reviewers"],
): Promise<FaceOffVerdict[]> {
  // IMPLEMENTATION: spawn N parallel @mirepoix/acp sessions; aggregate verdicts.
  throw new Error("@mirepoix/port.runFaceOff: not yet implemented");
}
