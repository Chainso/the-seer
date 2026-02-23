# Assistant Patterns

Reusable Assistant UI primitives for Phase E consolidation.

## Included primitives

- `AssistantSafeModeToggle`: safe-mode control with redaction status semantics.
- `AssistantConversationThreadRail`: threaded conversation navigation with active-state handling.
- `AssistantConversationTranscript`: message timeline renderer with accessible live-region behavior.
- `AssistantConversationComposer`: keyboard-friendly composer with optional quick prompts.
- `AssistantGuidedShortcuts`: module-context links targeting Guided Investigation (`/insights`).

## Supporting hooks/utilities

Use `src/lib/assistant/*` for:

- safe-mode redaction against AI summary/evidence/caveat/next-action envelopes,
- localStorage-backed assistant preferences and thread persistence,
- typed thread update helpers,
- ontology/process/root-cause shortcut href generation for guided orchestration.
