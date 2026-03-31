import { MessageRole } from "@prisma/client";

import { db } from "@/server/db";

type InteractionPrefs = {
  prefersMoreGuidance: boolean;
  prefersShortFeedback: boolean;
  dailyEngagement: "low" | "medium" | "high";
};

type LanguageTrend = {
  estimatedLevel: "A2-B1" | "B1-B2" | "B2+";
  averageUserLength: number;
  chineseRatio: number;
  helpUsageRatio: number;
};

type SourceStats = {
  totalUserTurns: number;
  totalSessions: number;
  optimizeCount: number;
  helpCount: number;
  dailyCount: number;
};

export type PersonaSnapshot = {
  topicInterests: string[];
  interactionPrefs: InteractionPrefs;
  languageTrend: LanguageTrend;
  recentFocus: string[];
  sourceStats: SourceStats;
};

const TOKEN_RE = /[a-zA-Z][a-zA-Z'-]{2,}/g;
const CJK_RE = /[\u4e00-\u9fff]/g;
const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "being",
  "between",
  "could",
  "dont",
  "from",
  "have",
  "just",
  "like",
  "maybe",
  "more",
  "need",
  "only",
  "really",
  "should",
  "some",
  "still",
  "than",
  "that",
  "them",
  "they",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

function defaultPersona(): PersonaSnapshot {
  return {
    topicInterests: ["daily life", "work", "learning"],
    interactionPrefs: {
      prefersMoreGuidance: true,
      prefersShortFeedback: true,
      dailyEngagement: "low",
    },
    languageTrend: {
      estimatedLevel: "A2-B1",
      averageUserLength: 0,
      chineseRatio: 0,
      helpUsageRatio: 0,
    },
    recentFocus: [],
    sourceStats: {
      totalUserTurns: 0,
      totalSessions: 0,
      optimizeCount: 0,
      helpCount: 0,
      dailyCount: 0,
    },
  };
}

function tokenize(text: string) {
  const matches = text.toLowerCase().match(TOKEN_RE) ?? [];
  return matches.filter((word) => !STOP_WORDS.has(word));
}

function topTerms(texts: string[], limit: number) {
  const counter = new Map<string, number>();
  for (const text of texts) {
    for (const token of tokenize(text)) {
      counter.set(token, (counter.get(token) ?? 0) + 1);
    }
  }

  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term);
}

function countChineseChars(text: string) {
  return (text.match(CJK_RE) ?? []).length;
}

function estimateLevel(params: { chineseRatio: number; avgLength: number; helpUsageRatio: number }): LanguageTrend["estimatedLevel"] {
  const { chineseRatio, avgLength, helpUsageRatio } = params;
  if (helpUsageRatio > 0.35 || chineseRatio > 0.28) {
    return "A2-B1";
  }
  if (avgLength >= 120 && helpUsageRatio < 0.2 && chineseRatio < 0.12) {
    return "B2+";
  }
  return "B1-B2";
}

function deriveDailyEngagement(dailyCount: number, totalSessions: number): InteractionPrefs["dailyEngagement"] {
  if (totalSessions <= 0) {
    return "low";
  }

  const ratio = dailyCount / totalSessions;
  if (ratio >= 0.7) {
    return "high";
  }
  if (ratio >= 0.35) {
    return "medium";
  }
  return "low";
}

function normalizeRecentFocus(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 140);
}

function asPersona(row: {
  topicInterests: unknown;
  interactionPrefs: unknown;
  languageTrend: unknown;
  recentFocus: unknown;
  sourceStats: unknown;
}): PersonaSnapshot {
  return {
    topicInterests: Array.isArray(row.topicInterests) ? (row.topicInterests as string[]) : [],
    interactionPrefs: row.interactionPrefs as InteractionPrefs,
    languageTrend: row.languageTrend as LanguageTrend,
    recentFocus: Array.isArray(row.recentFocus) ? (row.recentFocus as string[]) : [],
    sourceStats: row.sourceStats as SourceStats,
  };
}

export async function buildPersonaSnapshot(): Promise<PersonaSnapshot> {
  const messages = await db.message.findMany({
    where: { role: MessageRole.USER },
    orderBy: { createdAt: "asc" },
    select: {
      content: true,
      rawInput: true,
    },
  });

  if (messages.length === 0) {
    return defaultPersona();
  }

  let optimizeCount = 0;
  let helpCount = 0;
  let dailyCount = 0;
  let chineseChars = 0;
  let totalChars = 0;

  const plainMessages: string[] = [];
  for (const row of messages) {
    const raw = row.rawInput?.trim() ?? "";

    if (raw.startsWith("/optimize")) {
      optimizeCount += 1;
    } else if (raw.startsWith("/help")) {
      helpCount += 1;
    } else if (raw.startsWith("/daily")) {
      dailyCount += 1;
    } else if (row.content.trim()) {
      plainMessages.push(row.content.trim());
    }

    totalChars += row.content.length;
    chineseChars += countChineseChars(row.content);
  }

  const sessionCount = await db.session.count();
  const avgLength = totalChars > 0 ? Math.round(totalChars / messages.length) : 0;
  const chineseRatio = totalChars > 0 ? Number((chineseChars / totalChars).toFixed(3)) : 0;
  const helpUsageRatio = messages.length > 0 ? Number((helpCount / messages.length).toFixed(3)) : 0;

  const topicInterests = topTerms(plainMessages, 8);
  const recentFocus = plainMessages.slice(-5).map(normalizeRecentFocus).filter(Boolean);

  const snapshot: PersonaSnapshot = {
    topicInterests: topicInterests.length > 0 ? topicInterests : defaultPersona().topicInterests,
    interactionPrefs: {
      prefersMoreGuidance: helpCount >= optimizeCount,
      prefersShortFeedback: avgLength <= 120,
      dailyEngagement: deriveDailyEngagement(dailyCount, sessionCount),
    },
    languageTrend: {
      estimatedLevel: estimateLevel({
        chineseRatio,
        avgLength,
        helpUsageRatio,
      }),
      averageUserLength: avgLength,
      chineseRatio,
      helpUsageRatio,
    },
    recentFocus,
    sourceStats: {
      totalUserTurns: messages.length,
      totalSessions: sessionCount,
      optimizeCount,
      helpCount,
      dailyCount,
    },
  };

  return snapshot;
}

export async function refreshUserPersona() {
  const snapshot = await buildPersonaSnapshot();

  const row = await db.userPersona.upsert({
    where: { id: "default" },
    update: {
      topicInterests: snapshot.topicInterests,
      interactionPrefs: snapshot.interactionPrefs,
      languageTrend: snapshot.languageTrend,
      recentFocus: snapshot.recentFocus,
      sourceStats: snapshot.sourceStats,
    },
    create: {
      id: "default",
      topicInterests: snapshot.topicInterests,
      interactionPrefs: snapshot.interactionPrefs,
      languageTrend: snapshot.languageTrend,
      recentFocus: snapshot.recentFocus,
      sourceStats: snapshot.sourceStats,
    },
  });

  return asPersona(row);
}

export async function getUserPersona() {
  const row = await db.userPersona.findUnique({ where: { id: "default" } });
  if (!row) {
    return refreshUserPersona();
  }
  return asPersona(row);
}
