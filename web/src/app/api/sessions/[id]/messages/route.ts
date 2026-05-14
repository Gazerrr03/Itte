import { NextResponse } from "next/server";
import { DailyRunType, MessageRole } from "@prisma/client";

import { db } from "@/server/db";
import { reloadApiConfig, generateResponse, type GenerateMode, type DbMessage } from "@/server/ai-client";
import { buildDailyRequestKey, generateDailyTopic, refreshPersonaBeforeDaily } from "@/server/services/daily-topic-service";
import { appendConversation, normalizeIncomingInput } from "@/server/services/session-service";
import { getWebSetting } from "@/server/services/settings-service";

type RequestBody = {
  input?: string;
  display?: string;
};

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

function buildHistory(messages: DbMessage[]): ChatMessage[] {
  return messages
    .filter((m) => m.role !== MessageRole.SYSTEM)
    .map((m) => ({
      role: (m.role === MessageRole.ASSISTANT ? "assistant" : "user") as "user" | "assistant",
      content: m.role === MessageRole.USER ? (m.rawInput ?? m.content) : m.content,
    }));
}

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

  reloadApiConfig();

  let normalized: ReturnType<typeof normalizeIncomingInput>;
  try {
    normalized = normalizeIncomingInput(payload.input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid input.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const displayContent = (typeof payload.display === "string" && payload.display.trim()) || normalized.displayContent;

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

        // Query conversation history from DB for AI context.
        const priorMessages = await db.message.findMany({
          where: { sessionId },
          orderBy: { createdAt: "asc" },
          select: { role: true, content: true, rawInput: true },
        });

        const history = buildHistory(priorMessages);

        let mode: GenerateMode = "normal";
        let modeArg: string | undefined;

        if (normalized.command === "/optimize") {
          mode = "optimize";
          modeArg = normalized.rawInput;
        } else if (normalized.command === "/help") {
          mode = "help";
          modeArg = normalized.rawInput;
        } else if (normalized.command === "/vibe") {
          mode = "vibe";
          modeArg = normalized.rawInput;
        }

        const result = await generateResponse({
          mode,
          modeArg,
          history,
          onChunk: (chunk) => {
            assistantOutput += chunk;
            controller.enqueue(encoder.encode(chunk));
          },
        });

        if (!assistantOutput && result.content) {
          assistantOutput = result.content;
          controller.enqueue(encoder.encode(result.content));
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
        const message = error instanceof Error ? error.message : "Unknown error.";
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
