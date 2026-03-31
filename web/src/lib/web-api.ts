import { ChatMessage, SessionListItem, WebSetting } from "@/types/chat";

type SessionResponse = {
  session: {
    id: string;
    title: string;
    status: "ACTIVE" | "ENDED";
    summary: string | null;
    updatedAt: string;
    messages: {
      id: string;
      role: "USER" | "ASSISTANT" | "SYSTEM";
      content: string;
      createdAt: string;
    }[];
  };
};

function mapRole(role: "USER" | "ASSISTANT" | "SYSTEM"): ChatMessage["role"] {
  if (role === "USER") {
    return "user";
  }
  if (role === "ASSISTANT") {
    return "assistant";
  }
  return "system";
}

function mapMessages(response: SessionResponse["session"]["messages"]): ChatMessage[] {
  return response.map((message) => ({
    id: message.id,
    role: mapRole(message.role),
    content: message.content,
    createdAt: message.createdAt,
  }));
}

export async function fetchSessions(): Promise<SessionListItem[]> {
  const response = await fetch("/api/sessions", { cache: "no-store" });
  const data = (await response.json()) as { sessions?: SessionListItem[]; error?: string };
  if (!response.ok || !data.sessions) {
    throw new Error(data.error || "Failed to load sessions.");
  }
  return data.sessions;
}

export async function createSession(): Promise<SessionListItem> {
  const response = await fetch("/api/sessions", { method: "POST" });
  const data = (await response.json()) as { session?: SessionListItem; error?: string };
  if (!response.ok || !data.session) {
    throw new Error(data.error || "Failed to create session.");
  }
  return data.session;
}

export async function fetchSessionDetail(sessionId: string): Promise<{
  id: string;
  status: "ACTIVE" | "ENDED";
  summary: string | null;
  messages: ChatMessage[];
}> {
  const response = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
  const data = (await response.json()) as SessionResponse & { error?: string };
  if (!response.ok || !data.session) {
    throw new Error(data.error || "Failed to load session detail.");
  }

  return {
    id: data.session.id,
    status: data.session.status,
    summary: data.session.summary,
    messages: mapMessages(data.session.messages),
  };
}

export async function renameSession(sessionId: string, title: string) {
  const response = await fetch(`/api/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const data = (await response.json()) as { session?: SessionListItem; error?: string };
  if (!response.ok || !data.session) {
    throw new Error(data.error || "Failed to rename session.");
  }
  return data.session;
}

export async function deleteSession(sessionId: string) {
  const response = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
  const data = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Failed to delete session.");
  }
}

export async function fetchSettings(): Promise<WebSetting> {
  const response = await fetch("/api/settings", { cache: "no-store" });
  const data = (await response.json()) as { setting?: WebSetting; error?: string };
  if (!response.ok || !data.setting) {
    throw new Error(data.error || "Failed to load settings.");
  }
  return data.setting;
}

export async function patchSettings(setting: WebSetting): Promise<WebSetting> {
  const response = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(setting),
  });
  const data = (await response.json()) as { setting?: WebSetting; error?: string };
  if (!response.ok || !data.setting) {
    throw new Error(data.error || "Failed to save settings.");
  }
  return data.setting;
}

export async function pollProactiveDaily(): Promise<{
  triggered: boolean;
  session: SessionListItem | null;
  skippedCount: number;
}> {
  const response = await fetch("/api/proactive/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const data = (await response.json()) as {
    triggered?: boolean;
    session?: SessionListItem | null;
    skippedCount?: number;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || "Failed to poll proactive daily.");
  }

  return {
    triggered: data.triggered === true,
    session: data.session ?? null,
    skippedCount: typeof data.skippedCount === "number" ? data.skippedCount : 0,
  };
}

export async function streamMessage(params: {
  sessionId: string;
  input: string;
  display?: string;
  onChunk: (chunk: string) => void;
}) {
  const response = await fetch(`/api/sessions/${params.sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: params.input, display: params.display }),
  });

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({ error: "Failed to send message." }))) as {
      error?: string;
    };
    throw new Error(payload.error || "Failed to send message.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) {
      params.onChunk(chunk);
    }
  }
}

export async function endSession(sessionId: string): Promise<string> {
  const response = await fetch(`/api/sessions/${sessionId}/end`, { method: "POST" });
  const data = (await response.json()) as { summary?: string; error?: string };
  if (!response.ok || typeof data.summary !== "string") {
    throw new Error(data.error || "Failed to end session.");
  }
  return data.summary;
}

export async function translateAssistantMessage(params: { sessionId: string; messageId: string }) {
  const response = await fetch(`/api/sessions/${params.sessionId}/messages/${params.messageId}/translate`, {
    method: "POST",
  });
  const data = (await response.json()) as {
    translation?: string;
    provider?: "deepl";
    targetLang?: "ZH";
    error?: string;
  };

  if (!response.ok || typeof data.translation !== "string") {
    throw new Error(data.error || "Failed to translate message.");
  }

  return {
    translation: data.translation,
    provider: data.provider ?? "deepl",
    targetLang: data.targetLang ?? "ZH",
  };
}
