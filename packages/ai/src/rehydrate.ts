// Some models (notably Qwen2.5-Coder via Ollama) emit tool calls as JSON
// objects inside the assistant `content` field rather than via the
// OpenAI-shaped `tool_calls` array. We detect that shape and rehydrate it
// into proper tool_calls so the rest of the loop is format-agnostic.

export function extractJsonObjects(text: string): unknown[] {
  const results: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1);
        try {
          results.push(JSON.parse(candidate));
        } catch {
          // skip non-JSON
        }
        start = -1;
      }
    }
  }
  return results;
}

export function tryParseToolCallsFromContent(
  content: string,
): Array<{ name: string; arguments: Record<string, unknown> }> {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const cleaned = content
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const objects = extractJsonObjects(cleaned);
  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;
    const o = obj as Record<string, unknown>;
    if (typeof o.name !== "string") continue;
    const args = (o.arguments ?? o.parameters ?? {}) as unknown;
    if (typeof args === "object" && args !== null) {
      calls.push({ name: o.name, arguments: args as Record<string, unknown> });
    }
  }
  return calls;
}
