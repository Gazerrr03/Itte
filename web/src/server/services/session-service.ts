import { MessageRole, SessionStatus } from "@prisma/client";

import { formatAssistantText } from "@/lib/assistant-format";
import { db } from "@/server/db";
import { refreshUserPersona } from "@/server/services/persona-service";

const TITLE_MAX = 60;
const PREVIEW_MAX = 140;

export const ALLOWED_COMMANDS = new Set(["/optimize", "/help", "/daily", "/vibe"]);

export type SessionListItem = {
  id: string;
  title: string;
  status: SessionStatus;
  lastPreview: string | null;
  updatedAt: string;
};

export type SessionWithMessages = {
  id: string;
  title: string;
  status: SessionStatus;
  summary: string | null;
  updatedAt: string;
  messages: {
    id: string;
    role: MessageRole;
    content: string;
    createdAt: string;
  }[];
};

function toPreview(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, PREVIEW_MAX);
}

function toTitle(text: string) {
  const normalized = text.replace(/^\/[a-z]+\s*/i, "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    if (/^\/daily\b/i.test(text.trim())) {
      return "Daily practice";
    }
    return "New Chat";
  }
  return normalized.slice(0, TITLE_MAX);
}

export function normalizeAssistantOutput(text: string) {
  return text.replace(/^\n+/, "").trimEnd();
}

export function normalizeDailyOutput(text: string) {
  return normalizeAssistantOutput(text);
}

export function normalizeIncomingInput(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Message is empty.");
  }

  if (!trimmed.startsWith("/")) {
    return {
      rawInput: trimmed,
      displayContent: trimmed,
      command: null as string | null,
    };
  }

  const [head] = trimmed.split(/\s+/, 1);
  if (!ALLOWED_COMMANDS.has(head)) {
    throw new Error(`Command ${head} is not allowed in web mode.`);
  }

  const arg = trimmed.slice(head.length).trim();
  if ((head === "/optimize" || head === "/help" || head === "/vibe") && !arg) {
    throw new Error(`${head} requires text.`);
  }

  const displayContent = head === "/daily" ? "Daily practice" : arg || trimmed;

  return {
    rawInput: trimmed,
    displayContent,
    command: head,
  };
}

export function deriveSummaryText(rawEndOutput: string) {
  const cleaned = rawEndOutput.trim();
  if (!cleaned) {
    return "";
  }

  if (/^unknown command\./i.test(cleaned)) {
    return "";
  }

  const marker = "Session Summary";
  const idx = cleaned.indexOf(marker);
  if (idx >= 0) {
    return cleaned.slice(idx).trim();
  }
  return cleaned;
}

export async function buildFallbackSummary(sessionId: string) {
  const rows = await db.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      content: true,
      rawInput: true,
    },
  });

  const userMessages = rows.filter((row) => row.role === MessageRole.USER);
  const assistantCount = rows.filter((row) => row.role === MessageRole.ASSISTANT).length;
  const commandUsage = new Map<string, number>();

  for (const row of userMessages) {
    const raw = row.rawInput?.trim();
    if (!raw || !raw.startsWith("/")) {
      continue;
    }
    const [head] = raw.split(/\s+/, 1);
    if (!ALLOWED_COMMANDS.has(head)) {
      continue;
    }
    commandUsage.set(head, (commandUsage.get(head) ?? 0) + 1);
  }

  const commandLine =
    commandUsage.size === 0
      ? "none"
      : Array.from(commandUsage.entries())
          .map(([command, count]) => `${command} x${count}`)
          .join(", ");

  const latestUser = [...userMessages]
    .reverse()
    .find((row) => row.content.trim().length > 0)
    ?.content.trim()
    .slice(0, 160);

  const lines = [
    "Session Summary",
    "",
    `- User turns: ${userMessages.length}`,
    `- Assistant turns: ${assistantCount}`,
    `- Commands used: ${commandLine}`,
  ];

  if (latestUser) {
    lines.push(`- Latest focus: ${latestUser}`);
  }

  return lines.join("\n");
}

export async function listSessions(): Promise<SessionListItem[]> {
  const sessions = await db.session.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      lastPreview: true,
      updatedAt: true,
    },
  });

  return sessions.map((session) => ({
    ...session,
    updatedAt: session.updatedAt.toISOString(),
  }));
}

export async function getSession(sessionId: string): Promise<SessionWithMessages | null> {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  return {
    id: session.id,
    title: session.title,
    status: session.status,
    summary: session.summary,
    updatedAt: session.updatedAt.toISOString(),
    messages: session.messages.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

export async function createSession() {
  const session = await db.session.create({
    data: {
      title: "New Chat",
      status: SessionStatus.ACTIVE,
    },
    select: {
      id: true,
      title: true,
      status: true,
      lastPreview: true,
      updatedAt: true,
    },
  });

  return {
    ...session,
    updatedAt: session.updatedAt.toISOString(),
  };
}

export async function renameSession(sessionId: string, title: string) {
  const nextTitle = title.trim().slice(0, TITLE_MAX);
  if (!nextTitle) {
    throw new Error("Title is empty.");
  }

  const updated = await db.session.update({
    where: { id: sessionId },
    data: { title: nextTitle },
    select: {
      id: true,
      title: true,
      status: true,
      lastPreview: true,
      updatedAt: true,
    },
  });

  return {
    ...updated,
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function deleteSession(sessionId: string) {
  await db.session.delete({ where: { id: sessionId } });
}

export async function getReplayInputs(sessionId: string) {
  const rows = await db.message.findMany({
    where: {
      sessionId,
    },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      rawInput: true,
      streamMeta: true,
    },
  });

  const replayInputs = rows
    .filter((row) => row.role === MessageRole.USER && typeof row.rawInput === "string" && row.rawInput.trim().length > 0)
    .map((row) => row.rawInput!.trim());

  if (replayInputs.length > 0) {
    return replayInputs;
  }

  const hasAssistantDailySeed = rows.some((row) => {
    if (row.role !== MessageRole.ASSISTANT || !row.streamMeta || typeof row.streamMeta !== "object") {
      return false;
    }
    const meta = row.streamMeta as Record<string, unknown>;
    return meta.command === "/daily" || meta.proactive === true;
  });

  if (hasAssistantDailySeed) {
    return ["/daily"];
  }

  return [];
}

export async function appendConversation(params: {
  sessionId: string;
  userContent: string;
  rawInput: string;
  command: string | null;
  assistantContent: string;
  streamMeta?: Record<string, unknown>;
}) {
  const { sessionId, userContent, rawInput, command, assistantContent, streamMeta } = params;

  const normalizedAssistant =
    command === "/daily" ? normalizeDailyOutput(assistantContent) : normalizeAssistantOutput(assistantContent);
  const assistantPreviewSource = normalizedAssistant
    ? formatAssistantText(normalizedAssistant).preview
    : toPreview(userContent);
  const assistantPreview = toPreview(assistantPreviewSource || userContent);

  const existingCount = await db.message.count({
    where: { sessionId, role: MessageRole.USER },
  });

  await db.$transaction([
    db.message.create({
      data: {
        sessionId,
        role: MessageRole.USER,
        content: userContent,
        rawInput,
        streamMeta: command ? { command, ...(streamMeta ?? {}) } : streamMeta ?? undefined,
      },
    }),
    db.message.create({
      data: {
        sessionId,
        role: MessageRole.ASSISTANT,
        content: normalizedAssistant,
      },
    }),
    db.session.update({
      where: { id: sessionId },
      data: {
        title: existingCount === 0 ? toTitle(userContent) : undefined,
        lastPreview: assistantPreview,
      },
    }),
  ]);

  // Keep a lightweight persona snapshot in sync for daily topic recommendation.
  await refreshUserPersona().catch(() => null);
}

export async function createAssistantInitiatedSession(params: {
  title: string;
  assistantContent: string;
  streamMeta?: Record<string, unknown>;
}) {
  const formatted = formatAssistantText(params.assistantContent);
  const preview = toPreview(formatted.preview || params.assistantContent);

  const session = await db.session.create({
    data: {
      title: params.title.slice(0, TITLE_MAX) || "Daily practice",
      status: SessionStatus.ACTIVE,
      lastPreview: preview,
      messages: {
        create: {
          role: MessageRole.ASSISTANT,
          content: params.assistantContent,
          streamMeta: params.streamMeta,
        },
      },
    },
    select: {
      id: true,
      title: true,
      status: true,
      lastPreview: true,
      updatedAt: true,
    },
  });

  return {
    ...session,
    updatedAt: session.updatedAt.toISOString(),
  };
}

export async function appendSystemSummary(sessionId: string, summaryText: string) {
  const preview = toPreview(summaryText || "Session ended.");

  await db.$transaction([
    db.message.create({
      data: {
        sessionId,
        role: MessageRole.SYSTEM,
        content: summaryText,
      },
    }),
    db.session.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.ENDED,
        endedAt: new Date(),
        summary: summaryText,
        lastPreview: preview,
      },
    }),
  ]);
}
