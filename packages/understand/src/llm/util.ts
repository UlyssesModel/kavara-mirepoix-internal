// @mirepoix/understand — shared LLM-response helpers.
//
// Hoisted in Commit 6 once a third LLM phase (architecture-analyzer) made the
// duplication unambiguous. Commits 4 and 5 each carried their own copy of
// `extractJsonObject`; the architecture-analyzer needs the same shape plus
// array extraction, so collecting the helpers in one module is now load-bearing
// for two callers and growing.
//
// Why brace-aware (not a regex): nested objects and braces inside strings both
// bite a naive `/\{.*\}/s` match. Why not a JSON.parse-from-start: the model
// often prefixes prose ("Here's the JSON:") even when told not to. The scanner
// finds the first opening delimiter, then walks the body respecting string
// literals + escape sequences until depth returns to zero.

/**
 * Locate a JSON object inside `text` by scanning for the first `{` and finding
 * its matching `}` via a brace-depth counter that respects string literals
 * (so braces inside strings don't break the count).
 */
export function extractJsonObject(text: string): string | null {
  return extractBracketedSpan(text, "{", "}");
}

/**
 * Locate a JSON array inside `text` by scanning for the first `[` and finding
 * its matching `]` via a bracket-depth counter that respects string literals.
 *
 * Used by the architecture-analyzer phase, where the LLM emits an array of
 * layer objects rather than a single object.
 */
export function extractJsonArray(text: string): string | null {
  return extractBracketedSpan(text, "[", "]");
}

function extractBracketedSpan(text: string, openCh: string, closeCh: string): string | null {
  const start = text.indexOf(openCh);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openCh) {
      depth++;
    } else if (ch === closeCh) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
