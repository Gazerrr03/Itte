export type ChatRole = "assistant" | "user" | "system";

export type ChatTone = "hero" | "reflection" | "quote" | "standard" | "system";

export type SlashCommand = "/optimize" | "/help" | "/vibe" | "/daily";

export type AssistantOutputBlockRole = "scene_setup" | "guidance" | "dialogue" | "meta";
export type AssistantOutputBlockStyle = "mono" | "main";

export type AssistantOutputBlock = {
  role: AssistantOutputBlockRole;
  text: string;
  style: AssistantOutputBlockStyle;
  speak: boolean;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  rawContent?: string;
  blocks?: AssistantOutputBlock[];
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
  proactiveDailyEnabled: boolean;
};

export type MessageTranslationState = {
  text: string | null;
  sections?: Array<{
    key: "translation_logic" | "continue_topic" | "scene_setup" | "dialogue" | "guidance" | "meta";
    content: string;
  }>;
  expanded: boolean;
  loading: boolean;
  error: string | null;
};
