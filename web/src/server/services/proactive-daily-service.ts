import { DailyRunType, ProactiveEventStatus } from "@prisma/client";

import { db, getDb } from "@/server/db";
import { buildDailyRequestKey, generateDailyTopic, refreshPersonaBeforeDaily } from "@/server/services/daily-topic-service";
import { getWebSetting } from "@/server/services/settings-service";
import { createAssistantInitiatedSession, listSessions } from "@/server/services/session-service";

export type ProactiveDispatchResult = {
  triggered: boolean;
  sessionId: string | null;
  skippedCount: number;
};

function dayBounds(base: Date) {
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function randomTimeBetween(from: Date, to: Date) {
  const min = from.getTime();
  const max = to.getTime();
  const random = min + Math.floor(Math.random() * Math.max(1, max - min));
  return new Date(random);
}

function buildRandomDailyTimes(base: Date, count: number) {
  const { start, end } = dayBounds(base);
  const set = new Set<number>();

  while (set.size < count) {
    set.add(randomTimeBetween(start, end).getTime());
  }

  return Array.from(set)
    .sort((a, b) => a - b)
    .map((value) => new Date(value));
}

async function ensureTodaySchedule(now: Date) {
  const { start, end } = dayBounds(now);
  const existing = await db.proactiveDailyEvent.count({
    where: {
      scheduledFor: {
        gte: start,
        lt: end,
      },
      status: {
        not: ProactiveEventStatus.CANCELED,
      },
    },
  });

  if (existing > 0) {
    return;
  }

  const dailyCount = 3 + Math.floor(Math.random() * 3);
  const scheduledTimes = buildRandomDailyTimes(now, dailyCount);

  await db.proactiveDailyEvent.createMany({
    data: scheduledTimes.map((scheduledFor) => ({
      scheduledFor,
      status: ProactiveEventStatus.PENDING,
    })),
  });
}

async function markOlderDueEventsSkipped(now: Date, keepEventId: string) {
  const updated = await db.proactiveDailyEvent.updateMany({
    where: {
      id: { not: keepEventId },
      status: ProactiveEventStatus.PENDING,
      scheduledFor: { lte: now },
    },
    data: {
      status: ProactiveEventStatus.SKIPPED_OFFLINE,
      processedAt: now,
      skipReason: "offline_catchup_kept_latest",
    },
  });

  return updated.count;
}

async function claimLatestDueEvent(now: Date) {
  const latestDue = await db.proactiveDailyEvent.findFirst({
    where: {
      status: ProactiveEventStatus.PENDING,
      scheduledFor: { lte: now },
    },
    orderBy: { scheduledFor: "desc" },
  });

  if (!latestDue) {
    return null;
  }

  const claimed = await db.proactiveDailyEvent.updateMany({
    where: {
      id: latestDue.id,
      status: ProactiveEventStatus.PENDING,
    },
    data: {
      status: ProactiveEventStatus.PROCESSING,
    },
  });

  if (claimed.count === 0) {
    return null;
  }

  return latestDue;
}

export async function pollAndDispatchProactiveDaily(now = new Date()): Promise<ProactiveDispatchResult> {
  const setting = await getWebSetting();
  if (!setting.proactiveDailyEnabled) {
    return { triggered: false, sessionId: null, skippedCount: 0 };
  }

  await refreshPersonaBeforeDaily();
  await ensureTodaySchedule(now);

  const dueCount = await db.proactiveDailyEvent.count({
    where: {
      status: ProactiveEventStatus.PENDING,
      scheduledFor: { lte: now },
    },
  });

  if (dueCount <= 0) {
    return { triggered: false, sessionId: null, skippedCount: 0 };
  }

  const latestDue = await claimLatestDueEvent(now);
  if (!latestDue) {
    return { triggered: false, sessionId: null, skippedCount: 0 };
  }

  const skippedCount = await markOlderDueEventsSkipped(now, latestDue.id);

  try {
    const topic = await generateDailyTopic({
      runType: DailyRunType.PROACTIVE,
      requestKey: buildDailyRequestKey("proactive"),
      eventId: latestDue.id,
    });

    const session = await createAssistantInitiatedSession({
      title: `Daily: ${topic.title}`,
      assistantContent: topic.message,
      streamMeta: {
        command: "/daily",
        source: topic.source,
        proactive: true,
        runId: topic.runId,
      },
    });

    const client = await getDb();
    await client.$transaction([
      client.dailyTopicRun.update({
        where: { id: topic.runId },
        data: { sessionId: session.id },
      }),
      client.proactiveDailyEvent.update({
        where: { id: latestDue.id },
        data: {
          status: ProactiveEventStatus.DELIVERED,
          processedAt: now,
          sessionId: session.id,
          skipReason: skippedCount > 0 ? `offline_skipped_${skippedCount}` : null,
        },
      }),
    ]);

    return {
      triggered: true,
      sessionId: session.id,
      skippedCount,
    };
  } catch (error) {
    await db.proactiveDailyEvent.update({
      where: { id: latestDue.id },
      data: {
        status: ProactiveEventStatus.CANCELED,
        processedAt: now,
        skipReason: error instanceof Error ? `delivery_error:${error.message.slice(0, 120)}` : "delivery_error",
      },
    });

    throw error;
  }
}

export async function pollProactiveForClient() {
  const dispatch = await pollAndDispatchProactiveDaily();
  if (!dispatch.triggered) {
    return {
      triggered: false,
      session: null,
      skippedCount: dispatch.skippedCount,
    };
  }

  const sessions = await listSessions();
  const created = sessions.find((session) => session.id === dispatch.sessionId) ?? null;

  return {
    triggered: true,
    session: created,
    skippedCount: dispatch.skippedCount,
  };
}
