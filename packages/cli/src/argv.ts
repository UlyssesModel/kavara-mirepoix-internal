// argv parsing for @mirepoix/cli (FR-008 step 1).
//
// Mirrors the shape of `phase-zero-spike/mirepoix-spike.ts` lines 62-74:
// recognized flags `--system-prompt-file=PATH` and `--cwd=PATH`; all other
// tokens are concatenated with " " as the positional prompt. No commander /
// yargs / oclif dependency (NFR-004).

export interface ParsedArgs {
  systemPromptFile: string | null;
  workingDir: string | null;
  userPrompt: string;
}

const SYSTEM_PROMPT_FILE_FLAG = "--system-prompt-file=";
const CWD_FLAG = "--cwd=";

export function parseArgv(argv: string[]): ParsedArgs {
  let systemPromptFile: string | null = null;
  let workingDir: string | null = null;
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith(SYSTEM_PROMPT_FILE_FLAG)) {
      systemPromptFile = arg.slice(SYSTEM_PROMPT_FILE_FLAG.length);
    } else if (arg.startsWith(CWD_FLAG)) {
      workingDir = arg.slice(CWD_FLAG.length);
    } else {
      positional.push(arg);
    }
  }
  return {
    systemPromptFile,
    workingDir,
    userPrompt: positional.join(" "),
  };
}

export const USAGE = "usage: mirepoix [--system-prompt-file=PATH] [--cwd=PATH] <prompt>";
