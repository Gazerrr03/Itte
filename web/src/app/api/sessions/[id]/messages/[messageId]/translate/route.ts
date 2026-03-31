import { MessageRole } from "@prisma/client";
import { NextResponse } from "next/server";

import { db } from "@/server/db";

export const runtime = "nodejs";

type DeeplResponse = {
  translations?: Array<{
    text?: string;
  }>;
  message?: string;
};

function resolveDeeplEndpoint(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.endsWith("/translate") ? trimmed : `${trimmed.replace(/\/+$/, "")}/translate`;
}

export async function POST(_: Request, context: { params: Promise<{ id: string; messageId: string }> }) {
  const { id: sessionId, messageId } = await context.params;

  const message = await db.message.findFirst({
    where: {
      id: messageId,
      sessionId,
    },
    select: {
      role: true,
      content: true,
    },
  });

  if (!message) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  if (message.role !== MessageRole.ASSISTANT) {
    return NextResponse.json({ error: "Only assistant messages can be translated." }, { status: 400 });
  }

  const sourceText = message.content.trim();
  if (!sourceText) {
    return NextResponse.json({ error: "Message content is empty." }, { status: 400 });
  }

  const apiKey = process.env.DEEPL_API_KEY?.trim();
  const apiUrl = resolveDeeplEndpoint(process.env.DEEPL_API_URL ?? "");
  if (!apiKey || !apiUrl) {
    return NextResponse.json(
      { error: "DeepL is not configured. Please set DEEPL_API_KEY and DEEPL_API_URL." },
      { status: 500 },
    );
  }

  const body = new URLSearchParams();
  body.set("text", sourceText);
  body.set("target_lang", "ZH");

  let deeplResponse: Response;
  try {
    deeplResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "DeepL request failed." }, { status: 502 });
  }

  let payload: DeeplResponse;
  try {
    payload = (await deeplResponse.json()) as DeeplResponse;
  } catch {
    payload = {};
  }

  if (!deeplResponse.ok) {
    const upstream = payload.message?.trim() || "DeepL returned an error.";
    return NextResponse.json({ error: upstream }, { status: 502 });
  }

  const translation = payload.translations?.[0]?.text?.trim();
  if (!translation) {
    return NextResponse.json({ error: "DeepL returned an empty translation." }, { status: 502 });
  }

  return NextResponse.json({
    translation,
    provider: "deepl",
    targetLang: "ZH",
  });
}
