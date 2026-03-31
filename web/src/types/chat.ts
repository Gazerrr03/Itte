export type ChatRole = "assistant" | "user" | "system";

export type ChatTone = "hero" | "reflection" | "quote" | "standard" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  rawContent?: string;
  tone?: ChatTone;
  createdAt?: string;
  isThinking?: boolean;
};

export type ToolAction = {
  key: "optimize" | "help" | "vibe" | "daily";
  label: string;
  icon: string;
  enabled: boolean;
};

export type SessionStatus = "ACTIVE" | "ENDED";

export type SessionListItem = {
  id: string;
  title: string;
  status: SessionStatus;
  lastPreview: string | null;
  updatedAt: string;
};

export type WebSetting = {
  streaming: boolean;
  model: string | null;
  ttsEnabled: boolean;
  autoReadAssistant: boolean;
  ttsEngine: "browser" | "cloud";
  ttsVoice: string | null;
  ttsRate: number;
};

export type MessageTranslationState = {
  text: string | null;
  expanded: boolean;
  loading: boolean;
  error: string | null;
};
