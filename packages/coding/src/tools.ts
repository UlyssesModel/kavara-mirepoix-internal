// The four base tool definitions (ADR-002): bash, read, write, edit.
// Extracted byte-equivalent from phase-zero-spike/mirepoix-spike.ts
// (lines 101-160). The wire format is what matters for the provider;
// inferred type from the literal is intentional.

export const tools = [
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Run a shell command in the working directory. Returns stdout, stderr, and exit code.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "Shell command to execute" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description: "Read a file from disk and return its contents.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "File path (absolute or relative)" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write",
      description:
        "Write content to a file path. Creates the file if it does not exist; overwrites if it does.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit",
      description:
        "Replace old_string with new_string in a file. old_string must match exactly and uniquely.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
];
