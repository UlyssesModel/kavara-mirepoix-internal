// executeTool dispatcher — extracted from phase-zero-spike/mirepoix-spike.ts
// (lines 240-278). The spike's log() calls are intentionally dropped here;
// observability belongs in @mirepoix/core's typed event bus (sub-phase C,
// ADR-004). The result strings and try/catch shape are byte-equivalent.
//
// Per ADR-014 Refactor 2 / MS-3 (Issue #14), `executeTool` takes a
// `ToolContext` third argument. Relative paths in read/write/edit resolve
// against `ctx.workingDir`; bash receives the same context so spawn uses
// `cwd: ctx.workingDir`. Replaces the structural binding to the parent
// process's working directory.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { runBash } from "./bash";
import type { ToolContext } from "./context";

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  try {
    let result: string;
    if (name === "bash") {
      result = await runBash(args.command as string, ctx);
    } else if (name === "read") {
      result = readFileSync(resolve(ctx.workingDir, args.path as string), "utf-8");
    } else if (name === "write") {
      const path = resolve(ctx.workingDir, args.path as string);
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path, args.content as string);
      result = `wrote ${(args.content as string).length} bytes to ${args.path}`;
    } else if (name === "edit") {
      const path = resolve(ctx.workingDir, args.path as string);
      const content = readFileSync(path, "utf-8");
      const oldStr = args.old_string as string;
      const newStr = args.new_string as string;
      const occurrences = content.split(oldStr).length - 1;
      if (occurrences === 0) {
        result = `error: old_string not found in ${args.path}`;
      } else if (occurrences > 1) {
        result = `error: old_string matches ${occurrences} times in ${args.path}, must be unique`;
      } else {
        writeFileSync(path, content.replace(oldStr, newStr));
        result = `edited ${args.path}`;
      }
    } else {
      result = `unknown tool: ${name}`;
    }
    return result;
  } catch (e) {
    const errMsg = `error: ${(e as Error).message}`;
    return errMsg;
  }
}
