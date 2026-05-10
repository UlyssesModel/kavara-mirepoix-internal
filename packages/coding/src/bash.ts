// runBash — internal helper for the bash tool. Extracted from
// phase-zero-spike/mirepoix-spike.ts (lines 162-173). Exported from this
// module so execute.ts can import it; deliberately NOT re-exported from
// index.ts (consumers go through executeTool("bash", { command })).

import { spawn } from "node:child_process";

export async function runBash(command: string): Promise<string> {
  return new Promise((resolveBash) => {
    const proc = spawn("bash", ["-c", command]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      resolveBash(`stdout:\n${stdout}\nstderr:\n${stderr}\nexit: ${code}`);
    });
  });
}
