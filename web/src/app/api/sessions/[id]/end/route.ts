import { NextResponse } from "next/server";

import { db } from "@/server/db";
import { sessionProcessManager } from "@/server/session-process-manager";
import { appendSystemSummary, buildFallbackSummary, deriveSummaryText } from "@/server/services/session-service";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await context.params;

  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  if (session.status !== "ACTIVE") {
    return NextResponse.json({ error: "Session is already ended." }, { status: 400 });
  }

  let summary = "Session ended.";

  if (sessionProcessManager.hasSession(sessionId)) {
    try {
      const rawOutput = await sessionProcessManager.endSession(sessionId);
      const parsed = deriveSummaryText(rawOutput);
      if (parsed) {
        summary = parsed;
      }
    } catch {
      sessionProcessManager.disposeSession(sessionId);
    }
  } else {
    sessionProcessManager.disposeSession(sessionId);
  }

  if (summary === "Session ended.") {
    summary = await buildFallbackSummary(sessionId);
  }

  await appendSystemSummary(sessionId, summary);

  return NextResponse.json({ summary });
}
