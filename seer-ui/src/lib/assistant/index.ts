export {
  buildGuidedInvestigationShortcutHref,
  buildModuleGuidedShortcuts,
  buildOntologyGuidedShortcut,
  buildProcessGuidedShortcut,
  buildRootCauseGuidedShortcut,
} from "@/lib/assistant/guided-shortcuts";

export {
  REDACTION_TOKEN,
  redactAssistantPanelContent,
  redactEvidenceItems,
  redactSensitiveText,
  redactStringList,
} from "@/lib/assistant/redaction";

export {
  createAssistantThread,
  buildAssistantThreadTitle,
  makeAssistantMessageId,
  makeAssistantThreadId,
  parseStoredAssistantThreads,
  resolveAssistantActiveThreadId,
  sortAssistantThreads,
  updateAssistantThreadMessages,
} from "@/lib/assistant/threads";

export {
  readPersistedBoolean,
  readPersistedJson,
  readPersistedString,
  writePersistedBoolean,
  writePersistedJson,
  writePersistedString,
} from "@/lib/assistant/persistence";

export { useAssistantSafeMode } from "@/lib/assistant/use-assistant-safe-mode";
export { useAssistantThreads } from "@/lib/assistant/use-assistant-threads";

export type {
  AssistantMessage,
  AssistantMessageRole,
  AssistantPanelContent,
  AssistantThread,
  GuidedInvestigationShortcutInput,
  GuidedInvestigationShortcutLink,
  GuidedShortcutSource,
} from "@/lib/assistant/types";
