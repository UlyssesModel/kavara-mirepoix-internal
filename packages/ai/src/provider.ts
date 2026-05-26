// Provider call (OpenAI-compatible /chat/completions) and assistant-message
// normalization. Extracted from phase-zero-spike/mirepoix-spike.ts (lines
// 296-350). Provider URL and model name are passed in via ProviderConfig;
// the package does not read environment variables — that responsibility
// stays with callers (CLI / core) per ADR-001 leaf-package discipline.

import { tryParseToolCallsFromContent } from "./rehydrate";

export interface ProviderConfig {
  url: string;
  model: string;
}

export interface AssistantMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments: string } }>;
}

export async function callProvider(
  messages: Array<Record<string, unknown>>,
  tools: unknown[],
  config: ProviderConfig,
): Promise<AssistantMessage> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const apiKey =
    typeof process !== "undefined"
      ? process.env.MIREPOIX_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.GEMINI_API_KEY
      : undefined;

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const body = {
    model: config.model,
    messages,
    tools,
    tool_choice: "auto",
    temperature: 0.2,
  };

  const res = await fetch(`${config.url}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`provider error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    choices: Array<{
      message: AssistantMessage;
    }>;
  };

  return data.choices[0].message;
}

export function normalizeAssistantMessage(
  msg: AssistantMessage,
  turn: number,
): {
  content: string | null;
  toolCalls: Array<{ id: string; type?: string; function: { name: string; arguments: string } }> | undefined;
  rehydrated: boolean;
} {
  let toolCalls = msg.tool_calls;
  let assistantContent = msg.content;
  let rehydrated = false;
  if ((!toolCalls || toolCalls.length === 0) && typeof msg.content === "string") {
    const parsed = tryParseToolCallsFromContent(msg.content);
    if (parsed.length > 0) {
      toolCalls = parsed.map((p, i) => ({
        id: `call_${turn}_${i}`,
        type: "function",
        function: { name: p.name, arguments: JSON.stringify(p.arguments) },
      }));
      assistantContent = null;
      rehydrated = true;
    }
  }
  return { content: assistantContent, toolCalls, rehydrated };
}
