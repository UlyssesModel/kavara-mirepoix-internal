# @mirepoix/ai

Mirepoix provider abstraction.

Responsibilities (per ADR-001):

- Issue tool-using inference requests against an OpenAI-compatible endpoint.
- Normalize tool calls across wire formats (Qwen-via-Ollama emits JSON-in-content;
  OpenAI emits a tool_calls array). The normalization layer was prototyped in the
  Phase Zero spike's tryParseToolCallsFromContent rehydration helper.
- Expose a single typed surface to @mirepoix/core.

## Phase One status

Scaffold only. Implementation lands in subsequent sub-phases per IMPLEMENTATION-PLAN.md.
