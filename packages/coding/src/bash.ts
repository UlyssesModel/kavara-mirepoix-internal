// runBash — internal helper for the bash tool. Extracted from
// phase-zero-spike/mirepoix-spike.ts (lines 162-173). Exported from this
// module so execute.ts can import it; deliberately NOT re-exported from
// index.ts (consumers go through executeTool("bash", { command })).
//
// Per ADR-014 Refactor 2 / MS-3 (Issue #14), `runBash` takes a
// `ToolContext` and spawns the child with `cwd: ctx.workingDir` —
// replacing the structural binding to the parent's working directory.

import { spawn } from "node:child_process";

import type { ToolContext } from "./context";

export async function runBash(command: string, ctx: ToolContext): Promise<string> {
  return new Promise((resolveBash) => {
    const proc = spawn("bash", ["-c", command], { cwd: ctx.workingDir });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    // 'error' fires (and 'close' does NOT) when spawn itself fails — most
    // notably when cwd: ctx.workingDir does not exist. Without this handler
    // the promise never resolves and executeTool's "always returns a string,
    // never throws" invariant (spec NQ-9) breaks for the newly-reachable
    // failure mode that the deleted NQ-7 assertion previously guarded
    // against. See PR for issue #14 — Codex adversarial-review [P2].
    proc.on("error", (err) => {
      resolveBash(`error: ${err.message}`);
    });
    proc.on("close", (code) => {
      resolveBash(`stdout:\n${stdout}\nstderr:\n${stderr}\nexit: ${code}`);
    });
  });
}
