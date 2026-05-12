import { DailyRunType, type Prisma } from "@prisma/client";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { stripHtmlToText } from "@/lib/html-text";
import { db } from "@/server/db";
import { getUserPersona, refreshUserPersona, type PersonaSnapshot } from "@/server/services/persona-service";

type TopicCandidate = {
  source: string;
  title: string;
  url?: string;
  summary?: string;
  publishedAt?: Date;
  score?: number;
  fallback?: boolean;
  meta?: Prisma.InputJsonObject;
};

type ProviderResult = {
  provider: string;
  candidates: TopicCandidate[];
};

export type DailyTopicResult = {
  message: string;
  title: string;
  source: string;
  url: string | null;
  fallbackUsed: boolean;
  runId: string;
};

type GenerateDailyTopicParams = {
  runType: DailyRunType;
  requestKey: string;
  sessionId?: string;
  eventId?: string;
};

type DailyTopicMock = {
  topic_id?: string;
  scene?: string;
  title?: string;
  intro?: string;
  prompt?: string;
};

const HN_ENDPOINT = "https://hn.algolia.com/api/v1/search";
const MAX_CANDIDATES = 12;

function resolveProjectRoot() {
  const cwd = process.cwd();
  return path.basename(cwd) === "web" ? path.resolve(cwd, "..") : cwd;
}

function fallbackTopicsPath() {
  return path.resolve(resolveProjectRoot(), "daily_topics.json");
}

function toIsoDay(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizeText(text: string) {
  return stripHtmlToText(text).replace(/\s+/g, " ").trim();
}

function uniqueByTitle(items: TopicCandidate[]) {
  const seen = new Set<string>();
  const result: TopicCandidate[] = [];

  for (const item of items) {
    const key = normalizeText(`${item.title}|${item.url ?? ""}`).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }

  return result;
}

function splitPersonaTerms(persona: PersonaSnapshot) {
  const fromTopics = persona.topicInterests.map((item) => item.toLowerCase());
  const fromRecent = persona.recentFocus
    .flatMap((line) => line.toLowerCase().split(/[^a-zA-Z]+/))
    .filter((word) => word.length >= 4)
    .slice(0, 8);

  const merged = [...fromTopics, ...fromRecent];
  return Array.from(new Set(merged)).slice(0, 8);
}

function buildQueries(persona: PersonaSnapshot) {
  const terms = splitPersonaTerms(persona);
  if (terms.length === 0) {
    return ["ai", "work", "learning"];
  }

  const compact = terms.slice(0, 6);
  const queries = [
    compact.slice(0, 2).join(" "),
    compact.slice(2, 4).join(" "),
    compact.slice(4, 6).join(" "),
  ]
    .map((query) => normalizeText(query))
    .filter(Boolean);

  return queries.length > 0 ? queries : ["ai", "work", "learning"];
}

async function fetchHNCandidates(queries: string[]): Promise<ProviderResult> {
  const all: TopicCandidate[] = [];

  for (const query of queries.slice(0, 3)) {
    const params = new URLSearchParams({
      tags: "story",
      hitsPerPage: "16",
      query,
    });

    let response: Response;
    try {
      response = await fetch(`${HN_ENDPOINT}?${params.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(4500),
      });
    } catch {
      continue;
    }

    if (!response.ok) {
      continue;
    }

    const payload = (await response.json().catch(() => ({}))) as {
      hits?: Array<{
        title?: string;
        url?: string;
        story_text?: string;
        points?: number;
        created_at?: string;
        objectID?: string;
      }>;
    };

    for (const hit of payload.hits ?? []) {
      const title = normalizeText(hit.title ?? "");
      if (!title) {
        continue;
      }

      all.push({
        source: "hackernews",
        title,
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID ?? ""}`,
        summary: normalizeText(hit.story_text ?? "").slice(0, 280) || undefined,
        publishedAt: hit.created_at ? new Date(hit.created_at) : undefined,
        score: typeof hit.points === "number" ? hit.points : 0,
        meta: { query },
      });
    }
  }

  return {
    provider: "hackernews",
    candidates: uniqueByTitle(all).slice(0, MAX_CANDIDATES),
  };
}

function scoreCandidate(candidate: TopicCandidate, persona: PersonaSnapshot) {
  const terms = splitPersonaTerms(persona);
  const haystack = `${candidate.title} ${candidate.summary ?? ""}`.toLowerCase();

  let score = candidate.score ?? 0;
  for (const term of terms) {
    if (term.length < 3) {
      continue;
    }
    if (haystack.includes(term)) {
      score += 6;
    }
  }

  if (candidate.publishedAt) {
    const ageMs = Date.now() - candidate.publishedAt.getTime();
    const day = 24 * 60 * 60 * 1000;
    if (ageMs <= day) {
      score += 4;
    } else if (ageMs <= 7 * day) {
      score += 2;
    } else if (ageMs <= 30 * day) {
      score += 1;
    }
  }

  score += Math.random();
  return score;
}

function selectBestCandidate(candidates: TopicCandidate[], persona: PersonaSnapshot) {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      rank: scoreCandidate(candidate, persona),
    }))
    .sort((a, b) => b.rank - a.rank);

  return {
    chosen: ranked[0]?.candidate,
    ranked,
  };
}

async function loadFallbackCandidates(): Promise<TopicCandidate[]> {
  const raw = await readFile(fallbackTopicsPath(), "utf8").catch(() => "[]");
  const parsed = (JSON.parse(raw) as DailyTopicMock[]).filter(Boolean);

  return parsed.map((topic, index) => ({
    source: "local_fallback",
    title: normalizeText(topic.title ?? `Daily topic ${index + 1}`),
    summary: normalizeText(topic.intro ?? "") || undefined,
    fallback: true,
    meta: {
      topicId: topic.topic_id ?? null,
      scene: topic.scene ?? null,
      prompt: topic.prompt ?? null,
    },
  }));
}

function formatNewsMessage(candidate: TopicCandidate, persona: PersonaSnapshot) {
  const focusHint = persona.topicInterests[0] ?? "your daily life";
  const intro = candidate.summary
    ? candidate.summary
    : "I found a news story that seems close to your recent interests.";

  const question = `What is your view on this story, and how could it affect ${focusHint}?`;
  const sourceLine = candidate.url ? `\n\nSource: ${candidate.url}` : "";

  return `Today's topic: ${candidate.title}\n\n${intro}\n\n${question}${sourceLine}`;
}

function formatFallbackMessage(candidate: TopicCandidate) {
  const intro = normalizeText(candidate.summary ?? "");
  const promptFromMeta = typeof candidate.meta?.prompt === "string" ? normalizeText(candidate.meta.prompt) : "";
  const prompt =
    promptFromMeta ||
    "Tell me your opinion in 2-3 sentences, and I will help you make it sound natural.";

  return `Today's topic: ${candidate.title}\n\n${intro || "Let us do one quick daily speaking practice."}\n\n${prompt}`;
}

export async function generateDailyTopic(params: GenerateDailyTopicParams): Promise<DailyTopicResult> {
  const persona = await getUserPersona();
  const queryKeywords = buildQueries(persona);

  let providerResult = await fetchHNCandidates(queryKeywords);
  let fallbackUsed = false;

  if (providerResult.candidates.length === 0) {
    fallbackUsed = true;
    providerResult = {
      provider: "local_fallback",
      candidates: await loadFallbackCandidates(),
    };
  }

  if (providerResult.candidates.length === 0) {
    providerResult = {
      provider: "local_fallback",
      candidates: [
        {
          source: "local_fallback",
          title: "A small win from today",
          summary: "Think of one small thing you did well today.",
          fallback: true,
        },
      ],
    };
    fallbackUsed = true;
  }

  const { chosen, ranked } = selectBestCandidate(providerResult.candidates, persona);
  const selected = chosen ?? providerResult.candidates[0];

  const message = selected.fallback ? formatFallbackMessage(selected) : formatNewsMessage(selected, persona);

  const run = await db.dailyTopicRun.create({
    data: {
      requestKey: params.requestKey,
      runType: params.runType,
      provider: providerResult.provider,
      fallbackUsed: fallbackUsed || Boolean(selected.fallback),
      selectedTitle: selected.title,
      selectedUrl: selected.url ?? null,
      selectedSummary: selected.summary ?? null,
      queryKeywords,
      personaSnapshot: persona,
      sessionId: params.sessionId,
      eventId: params.eventId,
      candidates: {
        create: ranked.slice(0, MAX_CANDIDATES).map(({ candidate, rank }) => ({
          source: candidate.source,
          title: candidate.title,
          url: candidate.url,
          summary: candidate.summary,
          publishedAt: candidate.publishedAt,
          score: rank,
          selected: candidate.title === selected.title && candidate.url === selected.url,
          fallback: Boolean(candidate.fallback),
          meta: candidate.meta,
        })),
      },
    },
  });

  return {
    message,
    title: selected.title,
    source: selected.source,
    url: selected.url ?? null,
    fallbackUsed: run.fallbackUsed,
    runId: run.id,
  };
}

export async function refreshPersonaBeforeDaily() {
  return refreshUserPersona();
}

export function buildDailyRequestKey(prefix: "manual" | "proactive") {
  return `${prefix}_${toIsoDay(new Date())}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}
