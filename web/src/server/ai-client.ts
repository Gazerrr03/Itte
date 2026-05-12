// Direct AI API client — replaces child_process.spawn("itte").
// Ported from the itte bash script: lib/api.sh system prompts + call_chat_completion.
import type { MessageRole } from "@prisma/client";

let ITTE_API_BASE = process.env.ITTE_API_BASE ?? "";
let ITTE_API_KEY = process.env.ITTE_API_KEY ?? "";
let ITTE_MODEL = process.env.ITTE_MODEL ?? "";

function resolveApiUrl(): string {
  if (!ITTE_API_BASE) {
    throw new Error("ITTE_API_BASE is not set.");
  }
  const base = ITTE_API_BASE.replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

export function reloadApiConfig(): void {
  ITTE_API_BASE = process.env.ITTE_API_BASE ?? "";
  ITTE_API_KEY = process.env.ITTE_API_KEY ?? "";
  ITTE_MODEL = process.env.ITTE_MODEL ?? "";
}

function systemPromptNormal(): string {
  return `You are Itte, an English speaking practice companion.

Product policy:
- Default to English.
- Do not behave like a strict teacher.
- Prioritize understanding and conversation continuity.
- Do not auto-correct unless user explicitly asks.
- If user meaning is ambiguous, ask ONE minimal clarification question.
- If user clearly struggles to express, scaffold gently:
  1) identify intended meaning
  2) offer one usable sentence
  3) offer one optional alternative
  4) ask a follow-up question
- Keep replies concise and warm.
- If user explicitly asks for Chinese explanation, provide brief Chinese support then continue in English.

You should internally handle:
- S1 clear expression -> acknowledge + continue topic
- S2 understandable but unnatural -> continue topic, no correction lecture
- S3 ambiguous meaning -> minimal clarification
- S4 expression breakdown -> scaffold and continue`;
}

function systemPromptOptimize(): string {
  return `You are Itte in optimize mode.
The user asked /optimize and wants expression polish.

Required output structure:
1) "I understand you mean ..."
2) "A more natural way to say it is: ..."
3) Optional simpler version (if useful)
4) One follow-up question that returns to conversation

Rules:
- Default English.
- Keep it concise.
- No long grammar lecture.
- Preserve original meaning.`;
}

function systemPromptHelp(inputKind: "english" | "chinese"): string {
  const base = `You are Itte in /help mode.

You MUST return STRICT JSON only (no markdown, no prose outside JSON):
{
  "translation_logic": {
    "en": "string",
    "zh": "string"
  },
  "continue_topic": {
    "en": "string",
    "zh": "string"
  }
}

Global rules:
- Keep wording simple enough for a 5-year-old learner.
- Be warm, practical, and non-judgmental.
- In continue_topic.en, keep the conversation moving with one follow-up question.
- Keep every value concise and directly usable.

Language rules:
- Always fill translation_logic.en and continue_topic.en.
- Bilingual assist is OFF. Set both zh values to empty strings.`;

  const kindHint =
    inputKind === "chinese"
      ? `\n\nChinese-input behavior:
- The user text after /help is Chinese (or mixed with Chinese).
- Explain how to translate it into natural English:
  - what the key meaning is
  - why the chosen wording sounds natural
  - one clear natural English sentence to use`
      : `\n\nEnglish-input behavior:
- The user text after /help is English.
- Evaluate expression quality explicitly (natural / awkward / incorrect).
- If awkward or incorrect, explain what is wrong and how to improve it.
- Include one improved sentence that the user can directly use.`;

  return base + kindHint;
}

function systemPromptVibe(): string {
  return `You are Itte in /vibe mode.

The user gives a scenario idea and you generate one concise scene opener.
You MUST return STRICT JSON only (no markdown, no prose outside JSON):
{
  "scene_setup": {
    "en": "string",
    "zh": "string"
  },
  "dialogue": {
    "en": "string",
    "zh": "string"
  }
}

Rules:
- Keep it practical and conversational, not literary.
- In dialogue.en, choose a clear role in the scene (for example project lead, teammate, manager) and speak in first person.
- dialogue.en must be one sentence only and should sound like a real line someone can reply to immediately.
- scene_setup.en should be 2-4 short sentences.

Language rules:
- Always fill scene_setup.en and dialogue.en.
- Bilingual assist is OFF. Set both zh values to empty strings.`;
}

function systemPromptSummary(): string {
  return `You generate concise session summaries for an English practice CLI.

Return STRICT JSON only (no markdown, no explanation) with this schema:
{
  "scene": "string",
  "intents": ["string", "string", "string"],
  "useful_expressions": ["string", "string", "string"],
  "try_next_time": "string"
}

Rules:
- Use English text.
- Keep intents 1-3 items.
- Keep useful_expressions 1-3 items and reusable.
- try_next_time must be one concrete sentence.`;
}

function isKimiK25Model(): boolean {
  return ITTE_MODEL.toLowerCase().includes("kimi-k2.5");
}

function containsCjk(text: string): boolean {
  return /[一-鿿㐀-䶿]/.test(text);
}

type ChatMessageV1 = { role: "user" | "assistant" | "system"; content: string };

function toApiMessages(history: ChatMessageV1[]): { role: string; content: string }[] {
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-40);
}

export type StreamChunkCallback = (chunk: string) => void;

type CompletionResult = {
  content: string;
  streamed: boolean;
};

async function callChatCompletion(params: {
  systemPrompt: string;
  messagesJson: string;
  temperature: number;
  maxTokens: number;
  stream: boolean;
  onChunk?: StreamChunkCallback;
}): Promise<CompletionResult> {
  const { systemPrompt, messagesJson, temperature, maxTokens, stream, onChunk } = params;
  const apiUrl = resolveApiUrl();
  const apiKey = ITTE_API_KEY;
  const model = ITTE_MODEL;

  let retryReason = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let reqTemp = temperature;
    let thinkingMode = "";

    if (attempt === 2 && retryReason === "invalid_temperature") {
      reqTemp = 1;
    } else if (attempt === 2 && retryReason === "kimi_reasoning_only") {
      reqTemp = 0.6;
      thinkingMode = "disabled";
    }

    const messages = JSON.parse(messagesJson) as { role: string; content: string }[];
    const body: Record<string, unknown> = {
      model,
      temperature: reqTemp,
      max_tokens: maxTokens,
      stream,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    };

    if (thinkingMode) {
      body.thinking = { type: thinkingMode };
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let apiError = "";
      try {
        apiError = (JSON.parse(errorBody) as { error?: { message?: string } }).error?.message ?? "";
      } catch {
        // ignore
      }
      if (attempt === 1 && temperature !== 1 && apiError.includes("invalid temperature")) {
        retryReason = "invalid_temperature";
        continue;
      }
      throw new Error(`API request failed (HTTP ${response.status}). ${apiError}`);
    }

    if (stream && response.body) {
      if (!onChunk) {
        throw new Error("onChunk is required in streaming mode.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let content = "";
      let sawChunk = false;
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const data = trimmed.slice("data:".length).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
              error?: { message?: string };
            };

            if (parsed.error?.message && attempt === 1 && temperature !== 1 && parsed.error.message.includes("invalid temperature")) {
              retryReason = "invalid_temperature";
              break;
            }

            if (parsed.error?.message) {
              throw new Error(`API returned an error: ${parsed.error.message}`);
            }

            const chunk = parsed.choices?.[0]?.delta?.content;
            const reasoning = parsed.choices?.[0]?.delta?.reasoning_content;

            if (chunk) {
              content += chunk;
              sawChunk = true;
              onChunk(chunk);
            }

            if (reasoning) {
              // Kimi K2.5 reasoning_content seen — may retry
            }
          } catch (err) {
            if (err instanceof SyntaxError) continue;
            throw err;
          }
        }
      }

      if (!sawChunk && attempt === 1 && isKimiK25Model()) {
        retryReason = "kimi_reasoning_only";
        continue;
      }

      if (!content) {
        throw new Error("Empty model response.");
      }

      return { content, streamed: true };
    }

    // Non-streaming mode
    const responseText = await response.text();
    let parsed: {
      choices?: Array<{ message?: { content?: string | unknown[] } }>;
      error?: { message?: string };
    };
    try {
      parsed = JSON.parse(responseText) as typeof parsed;
    } catch {
      throw new Error("Failed to parse API response.");
    }

    if (parsed.error?.message && attempt === 1 && temperature !== 1 && parsed.error.message.includes("invalid temperature")) {
      retryReason = "invalid_temperature";
      continue;
    }

    if (parsed.error?.message) {
      throw new Error(`API returned an error: ${parsed.error.message}`);
    }

    let content = "";
    const msgContent = parsed.choices?.[0]?.message?.content;
    if (typeof msgContent === "string") {
      content = msgContent;
    } else if (Array.isArray(msgContent)) {
      content = msgContent
        .filter((part): part is { type: string; text: string } => {
          return typeof part === "object" && part !== null && (part as { type: string }).type === "text";
        })
        .map((part) => part.text)
        .join("\n");
    }

    if (!content) {
      throw new Error("Empty model response.");
    }

    return { content, streamed: false };
  }

  throw new Error("Failed to get a valid response from API.");
}

// ─── Public API ────────────────────────────────────────────────────────

export type GenerateMode = "normal" | "optimize" | "help" | "vibe" | "summary";
export type DbMessage = {
  role: MessageRole;
  content: string;
  rawInput?: string | null;
};

export type GenerateParams = {
  mode: GenerateMode;
  modeArg?: string; // help input kind hint, etc.
  history: ChatMessageV1[];
  onChunk?: StreamChunkCallback;
};

export type GenerateResult = {
  content: string;
  streamed: boolean;
};

export async function generateResponse(params: GenerateParams): Promise<GenerateResult> {
  const { mode, modeArg, history, onChunk } = params;

  const messagesJson = JSON.stringify(toApiMessages(history));
  const temperature = 1;
  const webStream = mode !== "help" && mode !== "vibe" && mode !== "summary";

  let systemPrompt: string;
  let maxTokens: number;

  switch (mode) {
    case "normal":
      systemPrompt = systemPromptNormal();
      maxTokens = 420;
      break;
    case "optimize":
      systemPrompt = systemPromptOptimize();
      maxTokens = 360;
      break;
    case "help":
      systemPrompt = systemPromptHelp(containsCjk(modeArg ?? "") ? "chinese" : "english");
      maxTokens = 360;
      break;
    case "vibe":
      systemPrompt = systemPromptVibe();
      maxTokens = 420;
      break;
    case "summary":
      systemPrompt = systemPromptSummary();
      maxTokens = 320;
      break;
    default:
      throw new Error(`Unknown response mode: ${mode}`);
  }

  return callChatCompletion({
    systemPrompt,
    messagesJson,
    temperature,
    maxTokens,
    stream: webStream,
    onChunk: webStream ? onChunk : undefined,
  });
}

export type SummaryResult = {
  scene: string;
  intents: string[];
  usefulExpressions: string[];
  tryNextTime: string;
};

export async function generateSessionSummary(
  sessionId: string,
  startedAt: string,
  sceneHint: string,
  history: ChatMessageV1[],
): Promise<string> {
  const stats = computeSessionStats(history);

  const contextJson = {
    session_id: sessionId,
    started_at: startedAt,
    now: new Date().toISOString(),
    scene_hint: sceneHint,
    stats,
    recent_history: history.slice(-24),
  };

  const summaryMessages = JSON.stringify([
    {
      role: "user",
      content: `Create session summary from this JSON context:\n${JSON.stringify(contextJson)}`,
    },
  ]);

  try {
    const result = await callChatCompletion({
      systemPrompt: systemPromptSummary(),
      messagesJson: summaryMessages,
      temperature: 1,
      maxTokens: 320,
      stream: false,
    });

    const parsed = parseSummaryJson(result.content);
    if (!parsed) {
      return formatFallbackSummary(history, sceneHint);
    }

    return formatSummaryText(parsed);
  } catch {
    return formatFallbackSummary(history, sceneHint);
  }
}

function parseSummaryJson(raw: string): SummaryResult | null {
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned) as {
      scene?: string;
      intents?: string[];
      useful_expressions?: string[];
      try_next_time?: string;
    };

    return {
      scene: parsed.scene ?? "General conversation",
      intents: (parsed.intents ?? []).map(String).filter(Boolean).slice(0, 3),
      usefulExpressions: (parsed.useful_expressions ?? []).map(String).filter(Boolean).slice(0, 3),
      tryNextTime: parsed.try_next_time ?? "Keep practicing.",
    };
  } catch {
    return null;
  }
}

function computeSessionStats(history: ChatMessageV1[]) {
  let userTurns = 0;
  let assistantTurns = 0;
  let totalUserChars = 0;
  let optimizeCount = 0;
  let helpCount = 0;
  let dailyCount = 0;

  for (const msg of history) {
    if (msg.role === "user") {
      userTurns++;
      totalUserChars += msg.content.length;
      if (msg.content.startsWith("/optimize")) optimizeCount++;
      if (msg.content.startsWith("/help")) helpCount++;
      if (msg.content.startsWith("/daily")) dailyCount++;
    } else if (msg.role === "assistant") {
      assistantTurns++;
    }
  }

  return {
    user_turns: userTurns,
    assistant_turns: assistantTurns,
    optimize_count: optimizeCount,
    help_count: helpCount,
    daily_count: dailyCount,
    avg_user_chars: userTurns > 0 ? Math.floor(totalUserChars / userTurns) : 0,
  };
}

function formatFallbackSummary(history: ChatMessageV1[], sceneHint: string): string {
  const scene = sceneHint === "Daily practice" ? "Daily practice" : "General conversation";
  let intents = "[\"sharing opinions\"]";
  let usefulExpressions = '["I can see the benefits, but I still feel a little uneasy about it.","In my experience, the biggest issue is ...","Could you help me say this more naturally?"]';
  let tryNext = "I can see both sides, but I still have some concerns.";

  const summary = { scene, intents: JSON.parse(intents) as string[], usefulExpressions: JSON.parse(usefulExpressions) as string[], tryNextTime: tryNext };
  return formatSummaryText(summary);
}

function formatSummaryText(summary: SummaryResult): string {
  return `Session Summary

Scene: ${summary.scene}

Key intents:
${summary.intents.map((i) => `- ${i}`).join("\n")}

Useful expressions:
${summary.usefulExpressions.map((e) => `- ${e}`).join("\n")}

Try next time:
${summary.tryNextTime}`;
}
