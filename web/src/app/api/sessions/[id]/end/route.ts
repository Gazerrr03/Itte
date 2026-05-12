import { NextResponse } from "next/server";
import { MessageRole } from "@prisma/client";

import { db } from "@/server/db";
import { reloadApiConfig, generateSessionSummary } from "@/server/ai-client";
import { appendSystemSummary, buildFallbackSummary } from "@/server/services/session-service";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await context.params;

  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, createdAt: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  if (session.status !== "ACTIVE") {
    return NextResponse.json({ error: "Session is already ended." }, { status: 400 });
  }

  reloadApiConfig();

  // Query all messages for summary context.
  const rows = await db.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, rawInput: true },
  });

  const history = rows
    .filter((m) => m.role !== MessageRole.SYSTEM)
    .map((m) => ({
      role: (m.role === MessageRole.ASSISTANT ? "assistant" : "user") as "user" | "assistant",
      content: m.role === MessageRole.USER ? (m.rawInput ?? m.content) : m.content,
    }));

  let summary: string;
  try {
    summary = await generateSessionSummary(
      sessionId,
      session.createdAt.toISOString(),
      "General conversation",
      history,
    );
  } catch {
    summary = await buildFallbackSummary(sessionId);
  }

  if (!summary || summary === "Session ended.") {
    summary = await buildFallbackSummary(sessionId);
  }

  await appendSystemSummary(sessionId, summary);

  return NextResponse.json({ summary });
}
