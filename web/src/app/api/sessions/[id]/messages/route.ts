import { NextResponse } from "next/server";
import { DailyRunType } from "@prisma/client";

import { db } from "@/server/db";
import { sessionProcessManager } from "@/server/session-process-manager";
import { buildDailyRequestKey, generateDailyTopic, refreshPersonaBeforeDaily } from "@/server/services/daily-topic-service";
import {
  appendConversation,
  getReplayInputs,
  normalizeIncomingInput,
} from "@/server/services/session-service";
import { getWebSetting } from "@/server/services/settings-service";

export const runtime = "nodejs";

type RequestBody = {
  input?: string;
  display?: string;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await context.params;

  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  if (session.status !== "ACTIVE") {
    return NextResponse.json({ error: "Session is ended." }, { status: 400 });
  }

  let payload: RequestBody;
  try {
    payload = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof payload.input !== "string") {
    return NextResponse.json({ error: "input is required." }, { status: 400 });
  }

  let normalized: ReturnType<typeof normalizeIncomingInput>;
  try {
    normalized = normalizeIncomingInput(payload.input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid input.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const displayContent = (typeof payload.display === "string" && payload.display.trim()) || normalized.displayContent;

  const setting = normalized.command === "/daily" ? null : await getWebSetting();
  const replayInputs =
    normalized.command === "/daily" ? [] : sessionProcessManager.hasSession(sessionId) ? [] : await getReplayInputs(sessionId);

  if (normalized.command !== "/daily") {
    try {
      await sessionProcessManager.ensureSessionProcess(sessionId, {
        runtime: setting!,
        replayInputs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to boot session process.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantOutput = "";

      try {
        if (normalized.command === "/daily") {
          await refreshPersonaBeforeDaily();
          const topic = await generateDailyTopic({
            runType: DailyRunType.MANUAL,
            requestKey: buildDailyRequestKey("manual"),
            sessionId,
          });
          assistantOutput = topic.message;
          controller.enqueue(encoder.encode(assistantOutput));

          await appendConversation({
            sessionId,
            userContent: displayContent,
            rawInput: normalized.rawInput,
            command: normalized.command,
            assistantContent: assistantOutput,
            streamMeta: {
              source: topic.source,
              fallbackUsed: topic.fallbackUsed,
              runId: topic.runId,
            },
          });

          controller.close();
          return;
        }

        const runOnce = () =>
          sessionProcessManager.sendLine(sessionId, normalized.rawInput, {
            timeoutMs: 45000,
            onChunk: (chunk) => {
              if (!chunk) {
                return;
              }
              assistantOutput += chunk;
              controller.enqueue(encoder.encode(chunk));
            },
          });

        let finalOutput: string;
        try {
          finalOutput = await runOnce();
        } catch (error) {
          // Retry once when no data has reached UI yet to avoid duplicated streamed chunks.
          if (assistantOutput.length > 0) {
            throw error;
          }

          sessionProcessManager.disposeSession(sessionId);
          await sessionProcessManager.ensureSessionProcess(sessionId, {
            runtime: setting!,
            replayInputs: await getReplayInputs(sessionId),
          });
          finalOutput = await runOnce();
        }

        if (!assistantOutput) {
          assistantOutput = finalOutput;
          controller.enqueue(encoder.encode(finalOutput));
        }

        await appendConversation({
          sessionId,
          userContent: displayContent,
          rawInput: normalized.rawInput,
          command: normalized.command,
          assistantContent: assistantOutput,
        });

        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown process error.";
        controller.enqueue(encoder.encode(`\n[Error] ${message}`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
