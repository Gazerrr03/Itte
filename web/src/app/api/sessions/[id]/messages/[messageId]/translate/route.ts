import { MessageRole } from "@prisma/client";
import { NextResponse } from "next/server";

import { parseAssistantOutputSpecFromStreamMeta } from "@/lib/assistant-output-spec";
import { formatAssistantText } from "@/lib/assistant-format";
import { db } from "@/server/db";

export const runtime = "nodejs";

type DeeplResponse = {
  translations?: Array<{
    text?: string;
  }>;
  message?: string;
};

type SourceBlock = {
  key: "translation_logic" | "continue_topic" | "scene_setup" | "dialogue" | "guidance" | "meta";
  content: string;
};

type TranslatedSection = {
  key: SourceBlock["key"];
  content: string;
};

function toSourceKey(role: "scene_setup" | "guidance" | "dialogue" | "meta"): SourceBlock["key"] {
  if (role === "scene_setup") {
    return "scene_setup";
  }
  if (role === "dialogue") {
    return "dialogue";
  }
  if (role === "meta") {
    return "meta";
  }
  return "guidance";
}

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
      streamMeta: true,
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

  const spec = parseAssistantOutputSpecFromStreamMeta(message.streamMeta);
  const sourceBlocks: SourceBlock[] = spec
    ? spec.blocks
        .map((block) => ({
          key: toSourceKey(block.role),
          content: block.text.trim(),
        }))
        .filter((block) => Boolean(block.content))
    : (() => {
        const formatted = formatAssistantText(sourceText);
        if (formatted.sections.length > 0) {
          return formatted.sections
            .map((section) => ({
              key: section.key,
              content: section.content.trim(),
            }))
            .filter((section) => Boolean(section.content));
        }
        return [
          {
            key: "continue_topic" as const,
            content: formatted.display.trim() || sourceText,
          },
        ];
      })();

  const apiKey = process.env.DEEPL_API_KEY?.trim();
  const apiUrl = resolveDeeplEndpoint(process.env.DEEPL_API_URL ?? "");
  if (!apiKey || !apiUrl) {
    return NextResponse.json(
      { error: "DeepL is not configured. Please set DEEPL_API_KEY and DEEPL_API_URL." },
      { status: 500 },
    );
  }

  const body = new URLSearchParams();
  for (const block of sourceBlocks) {
    body.append("text", block.content);
  }
  body.set("target_lang", "ZH");
  body.set("preserve_formatting", "1");

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
      signal: AbortSignal.timeout(10_000),
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

  const translatedSections: TranslatedSection[] =
    payload.translations
      ?.map((entry, index) => ({
        key: sourceBlocks[index]?.key ?? "guidance",
        content: entry.text?.trim() ?? "",
      }))
      .filter((section) => Boolean(section.content)) ?? [];
  const translation = translatedSections.map((section) => section.content).join("\n\n").trim();
  if (!translation) {
    return NextResponse.json({ error: "DeepL returned an empty translation." }, { status: 502 });
  }

  return NextResponse.json({
    translation,
    sections: translatedSections,
    provider: "deepl",
    targetLang: "ZH",
  });
}
