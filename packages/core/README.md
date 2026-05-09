# @mirepoix/core

Mirepoix kernel.

Responsibilities (per ADR-001 / ADR-004 / ADR-005):

- Run the tool-calling loop. Drive turns until the model is done.
- Emit typed events to an in-process event bus on every state transition
  (provider request/response, tool start/end, session start/end). Never
  hook-spawn-process per ADR-004.
- Persist all events to JSONL session log (append-only, source of truth)
  per ADR-005. Full context visibility, no silent injection, no auto-pruning.

## Phase One status

Scaffold only. Implementation lands in subsequent sub-phases per IMPLEMENTATION-PLAN.md.
