-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WebSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "streaming" BOOLEAN NOT NULL DEFAULT true,
    "model" TEXT,
    "ttsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoReadAssistant" BOOLEAN NOT NULL DEFAULT true,
    "ttsEngine" TEXT NOT NULL DEFAULT 'browser',
    "ttsVoice" TEXT,
    "ttsRate" REAL NOT NULL DEFAULT 1,
    "proactiveDailyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_WebSetting" ("createdAt", "id", "model", "streaming", "updatedAt")
SELECT "createdAt", "id", "model", "streaming", "updatedAt" FROM "WebSetting";
DROP TABLE "WebSetting";
ALTER TABLE "new_WebSetting" RENAME TO "WebSetting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable
CREATE TABLE "UserPersona" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "topicInterests" JSONB NOT NULL,
    "interactionPrefs" JSONB NOT NULL,
    "languageTrend" JSONB NOT NULL,
    "recentFocus" JSONB NOT NULL,
    "sourceStats" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProactiveDailyEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduledFor" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "processedAt" DATETIME,
    "sessionId" TEXT,
    "skipReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProactiveDailyEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyTopicRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestKey" TEXT NOT NULL,
    "runType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "selectedTitle" TEXT NOT NULL,
    "selectedUrl" TEXT,
    "selectedSummary" TEXT,
    "queryKeywords" JSONB NOT NULL,
    "personaSnapshot" JSONB NOT NULL,
    "sessionId" TEXT,
    "eventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyTopicRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DailyTopicRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ProactiveDailyEvent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyTopicCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "summary" TEXT,
    "publishedAt" DATETIME,
    "score" REAL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyTopicCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DailyTopicRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyTopicRun_requestKey_key" ON "DailyTopicRun"("requestKey");

-- CreateIndex
CREATE INDEX "DailyTopicRun_runType_createdAt_idx" ON "DailyTopicRun"("runType", "createdAt");

-- CreateIndex
CREATE INDEX "DailyTopicRun_sessionId_idx" ON "DailyTopicRun"("sessionId");

-- CreateIndex
CREATE INDEX "DailyTopicRun_eventId_idx" ON "DailyTopicRun"("eventId");

-- CreateIndex
CREATE INDEX "DailyTopicCandidate_runId_score_idx" ON "DailyTopicCandidate"("runId", "score");

-- CreateIndex
CREATE INDEX "ProactiveDailyEvent_status_scheduledFor_idx" ON "ProactiveDailyEvent"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "ProactiveDailyEvent_sessionId_idx" ON "ProactiveDailyEvent"("sessionId");
