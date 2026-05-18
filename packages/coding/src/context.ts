// ToolContext — the aggregate carried into every tool invocation.
//
// Per ADR-014 Refactor 2 / MS-3 and CONTEXT-MAP.md R1. The workingDir
// value object is the default resolution base for relative paths in
// read/write/edit and the spawn cwd for bash. Replaces the structural
// binding to the parent process's working directory that the NQ-7
// holding-pattern assertion cross-checked.
//
// Not a security boundary (ADR-002): tools still accept any path or
// command; workingDir is a default, not a sandbox.

export interface ToolContext {
  /** Absolute working-directory path. The CLI's resolved `--cwd`, or
   *  the operator's working directory at invocation time. */
  workingDir: string;
}
