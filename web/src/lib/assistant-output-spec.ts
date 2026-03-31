import { cleanMetadata, formatAssistantText, paragraphize } from "./assistant-format.ts";

export type SlashCommand = "/optimize" | "/help" | "/vibe" | "/daily";

export type AssistantOutputBlockRole = "scene_setup" | "guidance" | "dialogue" | "meta";
export type AssistantOutputBlockStyle = "mono" | "main";

export type AssistantOutputBlock = {
  role: AssistantOutputBlockRole;
  text: string;
  style: AssistantOutputBlockStyle;
  speak: boolean;
};

export type AssistantOutputSpecV1 = {
  command: SlashCommand;
  raw: string;
  blocks: AssistantOutputBlock[];
};

const SLASH_COMMANDS: SlashCommand[] = ["/optimize", "/help", "/vibe", "/daily"];
const SLASH_COMMAND_SET = new Set<string>(SLASH_COMMANDS);
const SECTION_LABEL_PATTERN = /^\s*(scene setup|dialogue|translation logic|continue(?:\s+the)?\s+topic)\s*:\s*/i;
const SENTENCE_PATTERN = /[^.!?。！？]+[.!?。！？]?["”’）】」』]*/g;
const ENGLISH_CHAR_PATTERN = /[A-Za-z]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripDecorativeSymbols(raw: string) {
  return raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) =>
      line
        .replace(SECTION_LABEL_PATTERN, "")
        .replace(/^\s*[*•\-]+\s+/, "")
        .replace(/^\s*\d+[.)]\s+/, "")
        .replace(/^\s*["“”'‘’]+\s*/, "")
        .replace(/\s*["“”'‘’]+\s*$/, ""),
    )
    .join("\n");
}

function normalizeText(raw: string) {
  return paragraphize(cleanMetadata(stripDecorativeSymbols(raw))).trim();
}

function splitParagraphs(raw: string) {
  return raw
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitSentences(raw: string) {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }
  const matched = normalized.match(SENTENCE_PATTERN) ?? [];
  return matched.map((entry) => entry.trim()).filter(Boolean);
}

function containsEnglish(text: string) {
  return ENGLISH_CHAR_PATTERN.test(text);
}

function pickLastEnglishSentence(raw: string) {
  const sentences = splitSentences(raw);
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index];
    if (containsEnglish(sentence)) {
      return sentence;
    }
  }
  return "";
}

function pickDialogueFromText(raw: string) {
  const paragraphs = splitParagraphs(raw);
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const paragraph = paragraphs[index];
    const englishSentence = pickLastEnglishSentence(paragraph);
    if (englishSentence) {
      return englishSentence;
    }
    if (/[?？]/.test(paragraph)) {
      const sentences = splitSentences(paragraph);
      for (let sentenceIndex = sentences.length - 1; sentenceIndex >= 0; sentenceIndex -= 1) {
        if (/[?？]/.test(sentences[sentenceIndex])) {
          return sentences[sentenceIndex];
        }
      }
      return paragraph;
    }
  }

  const trailingEnglishSentence = pickLastEnglishSentence(raw);
  if (trailingEnglishSentence) {
    return trailingEnglishSentence;
  }

  const sentences = splitSentences(raw);
  if (sentences.length > 0) {
    for (let index = sentences.length - 1; index >= 0; index -= 1) {
      if (/[?？]/.test(sentences[index])) {
        return sentences[index];
      }
    }
    return sentences[sentences.length - 1];
  }

  return paragraphs[paragraphs.length - 1] ?? "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeDialogueFromText(raw: string, dialogue: string) {
  const source = raw.trim();
  const target = dialogue.trim();
  if (!source || !target) {
    return source;
  }
  if (source === target) {
    return "";
  }
  if (source.endsWith(target)) {
    return source.slice(0, source.length - target.length).trim();
  }

  const paragraphs = splitParagraphs(source);
  if (paragraphs.length > 1 && paragraphs[paragraphs.length - 1] === target) {
    return paragraphs.slice(0, -1).join("\n\n").trim();
  }

  const withoutLineLevelMatch = source
    .split("\n")
    .filter((line) => line.trim() !== target)
    .join("\n")
    .trim();
  if (withoutLineLevelMatch && withoutLineLevelMatch !== source) {
    return withoutLineLevelMatch;
  }

  const escapedTarget = escapeRegExp(target);
  return source.replace(new RegExp(`\\s*${escapedTarget}\\s*`, "g"), " ").replace(/\s{2,}/g, " ").trim();
}

function buildBlock(role: AssistantOutputBlockRole, text: string, style: AssistantOutputBlockStyle, speak: boolean) {
  return {
    role,
    text: normalizeText(text),
    style,
    speak,
  };
}

function isSlashCommand(value: unknown): value is SlashCommand {
  return typeof value === "string" && SLASH_COMMAND_SET.has(value);
}

function defaultDialogue(command: SlashCommand) {
  if (command === "/vibe") {
    return "Your turn.";
  }
  return "Tell me your take in one sentence.";
}

function coerceSpec(command: SlashCommand, raw: string, inputBlocks: AssistantOutputBlock[], displayFallback: string) {
  const normalizedRaw = raw.replace(/\r/g, "").trim();
  const baseDisplay = normalizeText(displayFallback || normalizedRaw);
  const mergedDialogueSource = normalizeText(
    inputBlocks
      .filter((block) => block.role === "dialogue")
      .map((block) => block.text)
      .join("\n\n"),
  );
  const dialogue = normalizeText(pickDialogueFromText(mergedDialogueSource || baseDisplay)) || defaultDialogue(command);

  const nonDialogueSource = normalizeText(
    inputBlocks
      .filter((block) => block.role !== "dialogue")
      .map((block) => block.text)
      .join("\n\n"),
  );

  let nonDialogue = normalizeText(removeDialogueFromText(nonDialogueSource, dialogue));
  if (!nonDialogue) {
    nonDialogue = normalizeText(removeDialogueFromText(baseDisplay, dialogue));
  }

  const nonDialogueRole: AssistantOutputBlockRole = command === "/vibe" ? "scene_setup" : "guidance";
  const blocks: AssistantOutputBlock[] = [];
  if (nonDialogue && nonDialogue !== dialogue) {
    blocks.push(buildBlock(nonDialogueRole, nonDialogue, "mono", false));
  }
  blocks.push(buildBlock("dialogue", dialogue, "main", true));

  return {
    command,
    raw: normalizedRaw,
    blocks,
  } satisfies AssistantOutputSpecV1;
}

export function normalizeCommandOutput(command: SlashCommand, raw: string): AssistantOutputSpecV1 {
  const normalizedRaw = raw.replace(/\r/g, "").trim();
  const parsed = formatAssistantText(normalizedRaw);
  const display = normalizeText(parsed.display || normalizedRaw);

  const nonDialogueParts: string[] = [];
  const dialogueParts: string[] = [];

  for (const section of parsed.sections) {
    const text = normalizeText(section.content);
    if (!text) {
      continue;
    }

    if (section.key === "dialogue" || section.key === "continue_topic") {
      dialogueParts.push(text);
      continue;
    }

    nonDialogueParts.push(text);
  }

  const seedBlocks: AssistantOutputBlock[] = [];
  const nonDialogueText = normalizeText(nonDialogueParts.join("\n\n"));
  if (nonDialogueText) {
    seedBlocks.push(buildBlock(command === "/vibe" ? "scene_setup" : "guidance", nonDialogueText, "mono", false));
  }
  const dialogueText = normalizeText(dialogueParts.join("\n\n"));
  if (dialogueText) {
    seedBlocks.push(buildBlock("dialogue", dialogueText, "main", true));
  }

  return coerceSpec(command, normalizedRaw, seedBlocks, display);
}

export function getDialogueTextFromBlocks(blocks: AssistantOutputBlock[] | null | undefined) {
  if (!blocks || blocks.length === 0) {
    return "";
  }

  const explicit = blocks.find((block) => block.role === "dialogue" && block.speak);
  if (explicit?.text?.trim()) {
    return explicit.text.trim();
  }

  const fallback = blocks.find((block) => block.role === "dialogue");
  return fallback?.text?.trim() ?? "";
}

function parseBlocks(value: unknown): AssistantOutputBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isPlainObject(entry)) {
        return null;
      }

      const role = entry.role;
      const style = entry.style;
      const text = typeof entry.text === "string" ? normalizeText(entry.text) : "";
      const speak = entry.speak === true;

      const validRole = role === "scene_setup" || role === "guidance" || role === "dialogue" || role === "meta";
      const validStyle = style === "mono" || style === "main";
      if (!validRole || !validStyle || !text) {
        return null;
      }

      return {
        role,
        text,
        style,
        speak,
      } as AssistantOutputBlock;
    })
    .filter((entry): entry is AssistantOutputBlock => Boolean(entry));
}

export function parseAssistantOutputSpecFromStreamMeta(streamMeta: unknown): AssistantOutputSpecV1 | null {
  if (!isPlainObject(streamMeta)) {
    return null;
  }

  const specValue = streamMeta.spec;
  if (!isPlainObject(specValue)) {
    return null;
  }

  const command = specValue.command;
  if (!isSlashCommand(command)) {
    return null;
  }

  const blocks = parseBlocks(specValue.blocks);
  const raw = typeof specValue.raw === "string" ? specValue.raw.trim() : "";
  const fallbackRaw = raw || blocks.map((block) => block.text).join("\n\n").trim();
  if (!fallbackRaw && blocks.length === 0) {
    return null;
  }

  if (blocks.length === 0) {
    return normalizeCommandOutput(command, fallbackRaw);
  }
  return coerceSpec(command, fallbackRaw, blocks, fallbackRaw);
}
