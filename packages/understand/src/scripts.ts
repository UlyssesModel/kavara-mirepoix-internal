// @mirepoix/understand — subprocess wrappers around upstream
// Understand-Anything's deterministic Phase 1 scripts.
//
// The upstream plugin ships 5 LLM-free Node scripts in skills/understand/.
// This module wraps the 3 that produce data the orchestrator consumes:
//
//   - scan-project.mjs        → file inventory + language/category/complexity
//   - extract-import-map.mjs  → tree-sitter resolved import edges per file
//   - extract-structure.mjs   → per-file structural extraction (per batch)
//
// `compute-batches.mjs` and `build-fingerprints.mjs` have orchestration-side
// preconditions (merged scan-result.json on disk; current git commit hash) so
// they are wired in the orchestrator, not exposed as bare wrappers.
//
// Each wrapper:
//   - Marshals typed inputs to a tmp JSON file (or argv positional)
//   - Invokes `node <script> <args>` via execFile (no shell)
//   - Reads the output JSON file back and parses it against a typed result
//   - Cleans up the tmp dir on exit (success or failure)
//
// Path resolution prefers the editable marketplace checkout so the wrapper
// tracks upstream as it evolves; cache fallback is selected for users who
// installed via the cache path. `UNDERSTAND_ANYTHING_PLUGIN` env var lets a
// developer point at a local fork.

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// =============================================================================
// Plugin path resolution
// =============================================================================

/**
 * Resolve the upstream Understand-Anything plugin's `skills/understand/` dir.
 *
 * Resolution order:
 *   1. `UNDERSTAND_ANYTHING_PLUGIN` env var (must be the plugin root, not the
 *      skills dir) — used by tests + local-fork development.
 *   2. `~/.claude/plugins/marketplaces/understand-anything/understand-anything-plugin/`
 *      — the editable git checkout the upstream marketplace installs. Tracks
 *      upstream HEAD as the user updates the plugin.
 *   3. `~/.claude/plugins/cache/understand-anything/understand-anything/<version>/`
 *      — the frozen runtime copy. We pick the lexicographically-greatest
 *      version directory present (good enough for semver-style "1.2.3" names;
 *      will need re-thinking if upstream ever ships pre-release suffixes).
 *
 * @throws Error if no path resolves with skills/understand/ inside it.
 */
export function resolveUpstreamSkillsDir(): string {
  const override = process.env.UNDERSTAND_ANYTHING_PLUGIN;
  if (override) {
    const dir = resolve(override, "skills/understand");
    if (existsSync(dir)) return dir;
    throw new Error(`UNDERSTAND_ANYTHING_PLUGIN=${override} does not contain skills/understand/`);
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

  const marketplace = resolve(
    home,
    ".claude/plugins/marketplaces/understand-anything/understand-anything-plugin/skills/understand",
  );
  if (existsSync(marketplace)) return marketplace;

  const cacheRoot = resolve(home, ".claude/plugins/cache/understand-anything/understand-anything");
  if (existsSync(cacheRoot)) {
    const versions = readdirSync(cacheRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const v of versions) {
      const candidate = resolve(cacheRoot, v, "skills/understand");
      if (existsSync(candidate)) return candidate;
    }
  }

  throw new Error(
    "Could not locate Understand-Anything plugin. Set UNDERSTAND_ANYTHING_PLUGIN " +
      "to a plugin root directory, or install via `/plugin install understand-anything`.",
  );
}

// =============================================================================
// Upstream build prerequisite
// =============================================================================

/**
 * Ensure the upstream Understand-Anything workspace's `@understand-anything/core`
 * package is built. Idempotent.
 *
 * Why this exists: the plugin's deterministic .mjs scripts each import
 * `@understand-anything/core`, falling back to
 * `<pluginRoot>/packages/core/dist/index.js`. That dist file is a build artifact
 * (gitignored upstream), so a fresh plugin install has it missing. Claude Code's
 * `/understand` command runs `pnpm install` against the workspace before invoking
 * the skill, which builds it via the workspace's `prepare` script. When we invoke
 * the .mjs scripts directly (outside Claude Code), we have to satisfy that
 * prerequisite ourselves.
 *
 * First-run cost: ~30-90s (depends on pnpm cache state).
 * Subsequent runs: one `existsSync` (~µs).
 *
 * Mutation safety: uses `--frozen-lockfile` so the plugin's committed
 * `pnpm-lock.yaml` is never modified — Claude Code's next plugin update will
 * remain a clean overwrite.
 *
 * Build mode: this currently does NOT enable native build scripts for
 * tree-sitter parsers (the `allowBuilds: true` workaround documented in the
 * `reference_understand_anything_setup_on_kavara_builder` memory). The upstream
 * extract-import-map.mjs is resilient to tree-sitter init failure — it emits
 * empty `importMap` entries with a stderr warning rather than aborting — so
 * v0 still produces valid output for downstream phases. Enabling native
 * tree-sitter builds is tracked as a follow-up.
 *
 * @throws if pnpm isn't on PATH or the build fails.
 */
export async function ensureUpstreamBuilt(): Promise<void> {
  const skillsDir = resolveUpstreamSkillsDir();
  // pluginRoot is two dirs up from skills/understand/.
  const pluginRoot = resolve(skillsDir, "..", "..");
  const coreDistEntry = resolve(pluginRoot, "packages/core/dist/index.js");
  // The .mjs scripts also need the plugin's registry deps (graphology etc.)
  // present at <pluginRoot>/node_modules/. Checking core's dist alone is
  // insufficient — a prior install scoped to @understand-anything/core only
  // would build core but leave the plugin's node_modules empty, and the
  // existsSync(coreDistEntry) early-return would then mask the missing deps.
  // graphology is the canonical sentinel since its absence is the failure
  // mode that motivated this check (see the iteration-2 fix below).
  const graphologyEntry = resolve(pluginRoot, "node_modules/graphology/package.json");

  if (existsSync(coreDistEntry) && existsSync(graphologyEntry)) return;

  // Workspace root is one level up from the plugin (per the outer
  // pnpm-workspace.yaml that declares `understand-anything-plugin/packages/*`).
  const workspaceRoot = resolve(pluginRoot, "..");
  const workspaceFile = resolve(workspaceRoot, "pnpm-workspace.yaml");
  if (!existsSync(workspaceFile)) {
    throw new Error(
      `@mirepoix/understand: expected pnpm-workspace.yaml at ${workspaceFile} ` +
        "(one level up from the plugin root). The upstream layout may have changed; " +
        "review ensureUpstreamBuilt in scripts.ts.",
    );
  }

  // 1. Install workspace deps for understand-anything-plugin and its transitive
  //    workspaces. The plugin's .mjs scripts (compute-batches.mjs, etc.) use
  //    registry deps declared on understand-anything-plugin/package.json
  //    (graphology, graphology-communities-louvain), NOT on @understand-anything/core.
  //    Filtering on the plugin via path (`./understand-anything-plugin...`)
  //    pulls in both: the plugin's own deps AND core (a workspace dep of the
  //    plugin). `...` includes deps; `--frozen-lockfile` refuses lockfile edits.
  await execFileAsync(
    "pnpm",
    ["install", "--filter", "./understand-anything-plugin...", "--frozen-lockfile"],
    { cwd: workspaceRoot },
  );

  // 2. Build @understand-anything/core explicitly. The workspace's `prepare`
  //    script runs this on install too, but invoking it directly is a safety
  //    belt against `prepare` being skipped in some pnpm configurations.
  await execFileAsync("pnpm", ["--filter", "@understand-anything/core", "build"], {
    cwd: workspaceRoot,
  });

  if (!existsSync(coreDistEntry)) {
    throw new Error(
      `@mirepoix/understand: built @understand-anything/core but expected artifact ` +
        `missing at ${coreDistEntry}. pnpm install + build completed without producing ` +
        "the dist file. Check pnpm output for warnings.",
    );
  }
}

// =============================================================================
// Typed result shapes — mirror the JSON written by each upstream script
// =============================================================================

/** A single file row from scan-project's `files` array. */
export interface ScannedFile {
  path: string;
  language: string;
  sizeLines: number;
  fileCategory: string;
}

/** scan-project.mjs output. */
export interface ScanProjectResult {
  scriptCompleted: boolean;
  files: ScannedFile[];
  totalFiles: number;
  filteredByIgnore: number;
  estimatedComplexity: "small" | "moderate" | "large" | "very-large";
  stats: {
    filesScanned: number;
    byCategory: Record<string, number>;
    byLanguage: Record<string, number>;
  };
}

/** extract-import-map.mjs output. */
export interface ImportMapResult {
  scriptCompleted: boolean;
  stats: {
    filesScanned: number;
    filesWithImports: number;
    totalEdges: number;
  };
  /** Map<sourceFilePath, resolvedImportTargetPaths[]>. */
  importMap: Record<string, string[]>;
}

/** extract-structure.mjs output (per-batch). The `results` shape is intentionally
 *  open for v0; it will be narrowed when @mirepoix/understand wires the
 *  file-analyzer phase in Commit 4. */
export interface ExtractStructureResult {
  scriptCompleted: boolean;
  filesAnalyzed: number;
  filesSkipped: number;
  results: unknown[];
}

/** Per-batch entry inside compute-batches output. */
export interface BatchEntry {
  batchIndex: number;
  files: ScannedFile[];
  mergeable: boolean;
}

/** compute-batches.mjs output. The shape is intentionally open beyond the
 *  known fields — upstream emits additional metadata (algorithm choice,
 *  neighborMap, non-code groups, etc.) that the orchestrator does not need
 *  to type fully for v0. */
export interface BatchesResult {
  batches: BatchEntry[];
  neighborMap?: Record<string, string[]>;
  [key: string]: unknown;
}

// =============================================================================
// Wrappers
// =============================================================================

/**
 * Run scan-project.mjs against a project root.
 * Equivalent to: `node scan-project.mjs <projectRoot> <outputPath>`.
 */
export async function runScanProject(projectRoot: string): Promise<ScanProjectResult> {
  await ensureUpstreamBuilt();
  const script = join(resolveUpstreamSkillsDir(), "scan-project.mjs");
  return withTmpOutput<ScanProjectResult>(async (outputPath) => {
    await execFileAsync("node", [script, projectRoot, outputPath]);
    return JSON.parse(readFileSync(outputPath, "utf8")) as ScanProjectResult;
  });
}

/**
 * Run extract-import-map.mjs against the scan-project file list.
 * Equivalent to: `node extract-import-map.mjs <input.json> <output.json>`.
 *
 * @param projectRoot — absolute path, written into the input JSON.
 * @param files — typically `(await runScanProject(projectRoot)).files`.
 */
export async function runExtractImportMap(
  projectRoot: string,
  files: ScannedFile[],
): Promise<ImportMapResult> {
  await ensureUpstreamBuilt();
  const script = join(resolveUpstreamSkillsDir(), "extract-import-map.mjs");
  return withTmpInputOutput<ImportMapResult>(
    { projectRoot, files },
    async (inputPath, outputPath) => {
      await execFileAsync("node", [script, inputPath, outputPath]);
      return JSON.parse(readFileSync(outputPath, "utf8")) as ImportMapResult;
    },
  );
}

/**
 * Run extract-structure.mjs against one batch of files.
 * Equivalent to: `node extract-structure.mjs <input.json> <output.json>`.
 *
 * @param projectRoot — absolute path.
 * @param batchFiles — subset of scan-project's files, selected by Phase 1.5
 *   batching (compute-batches.mjs). For non-batched single-file calls, pass
 *   `[fileRow]`.
 * @param batchImportData — the slice of importMap relevant to this batch
 *   plus its 1-hop neighbours. The upstream contract is "whatever data the
 *   file-analyzer agent needs to reason about the batch"; for v0 we pass the
 *   full importMap and let upstream do the slicing.
 */
export async function runExtractStructure(
  projectRoot: string,
  batchFiles: ScannedFile[],
  batchImportData: Record<string, unknown>,
): Promise<ExtractStructureResult> {
  await ensureUpstreamBuilt();
  const script = join(resolveUpstreamSkillsDir(), "extract-structure.mjs");
  return withTmpInputOutput<ExtractStructureResult>(
    { projectRoot, batchFiles, batchImportData },
    async (inputPath, outputPath) => {
      await execFileAsync("node", [script, inputPath, outputPath]);
      return JSON.parse(readFileSync(outputPath, "utf8")) as ExtractStructureResult;
    },
  );
}

/**
 * Run compute-batches.mjs.
 *
 * Precondition: `<projectRoot>/.understand-anything/intermediate/scan-result.json`
 * must exist and contain at minimum `{ files: ScannedFile[], importMap: Record<string, string[]> }`.
 * compute-batches reads only those two fields (per its main() at lines 338-341);
 * the orchestrator can omit the LLM-narrative fields without affecting batching.
 *
 * Writes `<projectRoot>/.understand-anything/intermediate/batches.json` and
 * returns its parsed contents.
 *
 * Equivalent to: `node compute-batches.mjs <projectRoot> [--changed-files=<path>]`.
 */
export async function runComputeBatches(
  projectRoot: string,
  options?: { changedFiles?: string },
): Promise<BatchesResult> {
  await ensureUpstreamBuilt();
  const script = join(resolveUpstreamSkillsDir(), "compute-batches.mjs");
  const args = [script, projectRoot];
  if (options?.changedFiles) args.push(`--changed-files=${options.changedFiles}`);
  await execFileAsync("node", args);
  const outPath = join(projectRoot, ".understand-anything", "intermediate", "batches.json");
  return JSON.parse(readFileSync(outPath, "utf8")) as BatchesResult;
}

/**
 * Run build-fingerprints.mjs.
 *
 * Writes `<projectRoot>/.understand-anything/fingerprints.json`, used by
 * upstream's auto-update path for incremental change detection. Has no
 * separate output JSON, so we hand-roll the tmp-input pattern here (the
 * `withTmpInputOutput` helper assumes both files exist).
 *
 * Equivalent to: `node build-fingerprints.mjs <input.json>`.
 */
export async function runBuildFingerprints(
  projectRoot: string,
  sourceFilePaths: string[],
  gitCommitHash: string,
): Promise<void> {
  await ensureUpstreamBuilt();
  const script = join(resolveUpstreamSkillsDir(), "build-fingerprints.mjs");
  const dir = mkdtempSync(join(tmpdir(), "mirepoix-understand-"));
  const inputPath = join(dir, "in.json");
  try {
    writeFileSync(inputPath, JSON.stringify({ projectRoot, sourceFilePaths, gitCommitHash }));
    await execFileAsync("node", [script, inputPath]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// =============================================================================
// Tmp-file helpers
// =============================================================================

/** Allocate a tmp dir, hand a single output path to `body`, clean up on exit. */
async function withTmpOutput<T>(body: (outputPath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "mirepoix-understand-"));
  const outputPath = join(dir, "out.json");
  try {
    return await body(outputPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Allocate a tmp dir, marshal `input` to in.json, hand both paths to `body`. */
async function withTmpInputOutput<T>(
  input: unknown,
  body: (inputPath: string, outputPath: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "mirepoix-understand-"));
  const inputPath = join(dir, "in.json");
  const outputPath = join(dir, "out.json");
  try {
    writeFileSync(inputPath, JSON.stringify(input));
    return await body(inputPath, outputPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
