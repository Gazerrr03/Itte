export type AssistantSectionKey = "translation_logic" | "continue_topic" | "scene_setup" | "dialogue";

export type AssistantSection = {
  key: AssistantSectionKey;
  content: string;
  variant: "main" | "mono";
};

export type FormattedAssistantText = {
  display: string;
  preview: string;
  sections: AssistantSection[];
};

const SECTION_LINE_PATTERN =
  /^\s*(?:[-*]\s*)?(?:\*\*)?\s*(scene setup|dialogue|translation logic|continue(?:\s+the)?\s+topic)\s*:\s*(.*?)(?:\*\*)?\s*$/i;
const LABEL_CANDIDATE_PATTERN =
  /^\s*(?:[-*]\s*)?(?:\d+[.)]\s*)?([A-Za-z\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff\s/_-]{0,24})\s*[:：]\s*(.*)$/;
const OPTIMIZE_PREFIX_PATTERN = /^\s*i understand you mean\b/i;
const OPTIMIZE_NATURAL_PATTERN = /more natural way to say(?:\s+it)?\s+is/i;
const QUESTION_HINT_PATTERN = /[?？]/;

function stripMarkdown(raw: string) {
  return raw.replace(/\r/g, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}

function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function joinLanguageValue(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const withPair = value as { en?: unknown; zh?: unknown };
  const en = typeof withPair.en === "string" ? withPair.en.trim() : "";
  const zh = typeof withPair.zh === "string" ? withPair.zh.trim() : "";

  if (en && zh) {
    return `${en}\n\n${zh}`;
  }
  return en || zh || "";
}

function isShortLabel(label: string) {
  const compact = label.trim().replace(/\s+/g, " ");
  if (!compact) {
    return false;
  }

  const words = compact.split(" ").filter(Boolean).length;
  return compact.length <= 14 && words <= 3;
}

export function cleanMetadata(raw: string) {
  const lines = stripMarkdown(raw).split("\n");
  const candidates = lines
    .map((line, index) => {
      const matched = line.match(LABEL_CANDIDATE_PATTERN);
      if (!matched) {
        return null;
      }
      return {
        index,
        line,
        label: matched[1].trim(),
        body: matched[2].trim(),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const labelOnlyCount = candidates.filter((entry) => !entry.body).length;
  const inlineShortCount = candidates.filter((entry) => entry.body && isShortLabel(entry.label)).length;
  const metadataContext = labelOnlyCount > 0 || inlineShortCount >= 2;

  const cleaned = lines
    .map((line) => {
      const matched = line.match(LABEL_CANDIDATE_PATTERN);
      if (!matched) {
        return line;
      }

      const label = matched[1].trim();
      const body = matched[2].trim();

      if (!body) {
        return "";
      }
      if (metadataContext && isShortLabel(label)) {
        return body;
      }
      return line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

function splitSentences(paragraph: string) {
  const normalized = paragraph.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const matched = normalized.match(/[^.!?。！？]+[.!?。！？]?["”’）】」』]*/g) ?? [];
  return matched.map((entry) => entry.trim()).filter(Boolean);
}

export function paragraphize(raw: string) {
  const paragraphs = raw
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const output: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= 180) {
      output.push(paragraph);
      continue;
    }

    const sentences = splitSentences(paragraph);
    if (sentences.length <= 1) {
      output.push(paragraph);
      continue;
    }

    let buffer = "";
    let sentenceCount = 0;
    const chunks: string[] = [];

    for (const sentence of sentences) {
      if (!buffer) {
        buffer = sentence;
        sentenceCount = 1;
        continue;
      }

      const candidate = `${buffer} ${sentence}`.trim();
      if (sentenceCount >= 2 || candidate.length > 180) {
        chunks.push(buffer);
        buffer = sentence;
        sentenceCount = 1;
      } else {
        buffer = candidate;
        sentenceCount += 1;
      }
    }

    if (buffer) {
      chunks.push(buffer);
    }

    output.push(chunks.join("\n\n"));
  }

  return output.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function parseLegacySections(raw: string): AssistantSection[] {
  const content = raw.replace(/\r/g, "");
  const sections = new Map<string, string[]>();
  let activeSection: string | null = null;

  for (const line of content.split("\n")) {
    const matched = line.match(SECTION_LINE_PATTERN);
    if (matched) {
      activeSection = matched[1].toLowerCase().replace(/\s+/g, " ").trim();
      if (!sections.has(activeSection)) {
        sections.set(activeSection, []);
      }
      const inlineText = matched[2]?.trim();
      if (inlineText) {
        sections.get(activeSection)!.push(inlineText);
      }
      continue;
    }

    const key = activeSection ?? "__root__";
    if (!sections.has(key)) {
      sections.set(key, []);
    }
    sections.get(key)!.push(line);
  }

  const scene = sections.get("scene setup")?.join("\n").trim() ?? "";
  const dialogue = sections.get("dialogue")?.join("\n").trim() ?? "";
  const logic = sections.get("translation logic")?.join("\n").trim() ?? "";
  const continueTopic =
    sections.get("continue the topic")?.join("\n").trim() ?? sections.get("continue topic")?.join("\n").trim() ?? "";
  const root = sections.get("__root__")?.join("\n").trim() ?? "";

  if (scene || dialogue) {
    const sections: AssistantSection[] = [];
    if (scene) {
      sections.push({ key: "scene_setup", content: scene, variant: "mono" });
    }
    if (dialogue) {
      sections.push({ key: "dialogue", content: dialogue, variant: "main" });
    }
    return sections;
  }

  if (logic || continueTopic) {
    const sections: AssistantSection[] = [];
    if (logic) {
      sections.push({ key: "translation_logic", content: logic, variant: "mono" });
    }
    if (continueTopic) {
      sections.push({ key: "continue_topic", content: continueTopic, variant: "mono" });
    }
    return sections;
  }

  const optimizeSections = parseOptimizeSections(root);
  if (optimizeSections.length > 0) {
    return optimizeSections;
  }

  if (root) {
    return [{ key: "dialogue", content: root, variant: "main" }];
  }

  return [];
}

function parseOptimizeSections(raw: string): AssistantSection[] {
  if (!raw) {
    return [];
  }

  const normalized = raw.replace(/\r/g, "").replace(/\*\*/g, "").trim();
  if (!normalized) {
    return [];
  }

  if (!OPTIMIZE_PREFIX_PATTERN.test(normalized) || !OPTIMIZE_NATURAL_PATTERN.test(normalized)) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length < 2) {
    return [];
  }

  let continueIndex = -1;
  for (let index = paragraphs.length - 1; index >= 1; index -= 1) {
    if (QUESTION_HINT_PATTERN.test(paragraphs[index])) {
      continueIndex = index;
      break;
    }
  }

  if (continueIndex <= 0) {
    return [];
  }

  const guidance = paragraphs.slice(0, continueIndex).join("\n\n").trim();
  const continueTopic = paragraphs.slice(continueIndex).join("\n\n").trim();
  if (!guidance || !continueTopic) {
    return [];
  }

  return [
    { key: "translation_logic", content: guidance, variant: "mono" },
    { key: "dialogue", content: continueTopic, variant: "main" },
  ];
}

function parseStructuredSections(raw: string): AssistantSection[] {
  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const payload = parsed as Record<string, unknown>;
  const hasHelp = "translation_logic" in payload || "continue_topic" in payload;
  const hasVibe = "scene_setup" in payload || "dialogue" in payload;
  if (!hasHelp && !hasVibe) {
    return [];
  }

  const sections: AssistantSection[] = [];

  const logic = joinLanguageValue(payload.translation_logic);
  const continueTopic = joinLanguageValue(payload.continue_topic);
  const scene = joinLanguageValue(payload.scene_setup);
  const dialogue = joinLanguageValue(payload.dialogue);

  if (logic) {
    sections.push({ key: "translation_logic", content: logic, variant: "mono" });
  }
  if (continueTopic) {
    sections.push({ key: "continue_topic", content: continueTopic, variant: "mono" });
  }
  if (scene) {
    sections.push({ key: "scene_setup", content: scene, variant: "mono" });
  }
  if (dialogue) {
    sections.push({ key: "dialogue", content: dialogue, variant: "main" });
  }

  return sections;
}

export function formatAssistantText(raw: string): FormattedAssistantText {
  const sections = parseStructuredSections(raw);
  const fallbackSections = sections.length > 0 ? sections : parseLegacySections(raw);
  const normalizedSections = fallbackSections.map((section) => ({
    ...section,
    content: paragraphize(cleanMetadata(section.content)),
  }));

  if (normalizedSections.length > 0) {
    const display = normalizedSections.map((section) => section.content).join("\n\n").trim();
    return {
      display,
      preview: display.replace(/\s+/g, " ").trim().slice(0, 140),
      sections: normalizedSections,
    };
  }

  const display = paragraphize(cleanMetadata(raw));
  return {
    display,
    preview: display.replace(/\s+/g, " ").trim().slice(0, 140),
    sections: [],
  };
}
