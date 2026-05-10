# @mirepoix/ai

Provider abstraction and tool-call rehydration for Mirepoix. This package
issues inference requests against an OpenAI-compatible endpoint and normalizes
the two wire shapes that OpenAI-compatible models emit for tool calls: the
standard `tool_calls` array and the Qwen-via-Ollama pattern of embedding JSON
objects directly in the `content` string. It is intentionally narrow: no event
bus, no agent loop, no session model — those are `@mirepoix/core` concerns
landing in sub-phase C.

## Public surface

### `PACKAGE_NAME`

```ts
export const PACKAGE_NAME = "@mirepoix/ai" as const;
// value: "@mirepoix/ai"
```

Identity sentinel. Useful for log prefixes and diagnostic assertions.

---

### `callProvider(messages, tools, config) → Promise<AssistantMessage>`

```ts
export async function callProvider(
  messages: Array<Record<string, unknown>>,
  tools: unknown[],
  config: ProviderConfig,
): Promise<AssistantMessage>;
```

POSTs to `${config.url}/chat/completions` with the body shape
`{ model, messages, tools, tool_choice: "auto", temperature: 0.2 }` and
returns `choices[0].message`. Throws `Error("provider error ${status}: ${body}")`
on any non-2xx response — callers decide how to handle (the Phase Zero spike
called `process.exit(1)`; a library must not).

`ProviderConfig`:
```ts
export interface ProviderConfig {
  url: string;   // e.g. "http://127.0.0.1:11434/v1"
  model: string; // e.g. "qwen2.5-coder:32b-instruct"
}
```

---

### `normalizeAssistantMessage(msg, turn) → { content, toolCalls, rehydrated }`

```ts
export function normalizeAssistantMessage(
  msg: AssistantMessage,
  turn: number,
): {
  content: string | null;
  toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> | undefined;
  rehydrated: boolean;
};
```

Normalizes the two valid shapes a provider message can have after a
`callProvider` call:

- If `msg.tool_calls` is present and non-empty, returns it as `toolCalls`
  unchanged, `content` as-is, `rehydrated: false`.
- If `msg.tool_calls` is absent or empty and `msg.content` is a string,
  calls `tryParseToolCallsFromContent` on it. When that yields at least one
  call, returns `toolCalls` synthesized as
  `{ id: "call_${turn}_${i}", function: { name, arguments: JSON.stringify(args) } }`,
  `content: null`, `rehydrated: true`.
- Otherwise returns `{ content, toolCalls: undefined, rehydrated: false }`.

`turn` is the current zero-based loop index; it is embedded in synthesized
call IDs so they are unique across turns.

---

### `tryParseToolCallsFromContent(content)`

```ts
export function tryParseToolCallsFromContent(
  content: string,
): Array<{ name: string; arguments: Record<string, unknown> }>;
```

Strips ` ```json ` and ` ``` ` fences from `content`, then calls
`extractJsonObjects` on the result. For each returned object that has a
`name: string` field and an `arguments` or `parameters` object, appends
`{ name, arguments }` to the result array. Returns an empty array when
nothing matches.

---

### `extractJsonObjects(text)`

```ts
export function extractJsonObjects(text: string): unknown[];
```

Finds all top-level JSON objects in `text` using a brace-matching state
machine with `depth`, `start`, `inString`, and `escape` tracking. A regex
like `/\{[^}]*\}/g` is wrong for this use case: the first tool call object in
the two-call fragment below contains a nested `}` from the `arguments` value,
which a greedy or lazy `[^}]*` pattern would split incorrectly. The state
machine handles arbitrary nesting and correctly handles `"` inside strings and
`\"` escape sequences. Each balanced candidate is passed through `JSON.parse`
inside a `try/catch`; non-parseable fragments are silently skipped.

Acceptance example (FR-003):
```
{"name": "write", "arguments": {"path": "/tmp/foo", "content": "bar"}}
{"name": "read", "arguments": {"path": "/tmp/foo"}}
```
Returns exactly two objects with `.name` values `["write", "read"]`.

---

### Type re-exports

```ts
export type { ProviderConfig, AssistantMessage } from "./provider";
```

`AssistantMessage` is the shape `callProvider` returns:
```ts
export interface AssistantMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}
```

## Why provider config is a parameter

The Phase Zero spike reads `OLLAMA_URL` and `MIREPOIX_MODEL` from environment
variables at module top-level because it is a one-shot CLI script. A library
package must not hide configuration in side-effect globals: it becomes
untestable, and it violates ADR-001's leaf-package discipline (env reads belong
in `@mirepoix/cli`, sub-phase D). `callProvider` therefore accepts a
`ProviderConfig` parameter and reads nothing from `process.env`. Callers own
the environment bridge.

## Source of truth

This package is a mechanical extraction from the Phase Zero spike. The
canonical provenance for each module is:

| File | Spike lines |
|------|-------------|
| `src/rehydrate.ts` | 175-238 (comment 175-178; `extractJsonObjects` 179-217; `tryParseToolCallsFromContent` 219-238) |
| `src/provider.ts` (`callProvider`) | 297-330 |
| `src/provider.ts` (`normalizeAssistantMessage`) | 336-350 |

The spike lives at `phase-zero-spike/mirepoix-spike.ts` and remains the
working harness through sub-phase D. It must not be modified.

## Stability

Sub-phase B surface. The exports listed above are stable for sub-phase C.
The surface is expected to grow when `@mirepoix/core` introduces the typed
event bus (ADR-004) and the agent loop — neither is in scope here.
