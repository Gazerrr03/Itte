-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WebSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "streaming" BOOLEAN NOT NULL DEFAULT true,
    "model" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_WebSetting" ("createdAt", "id", "model", "streaming", "updatedAt")
SELECT "createdAt", "id", "model", "streaming", "updatedAt" FROM "WebSetting";
DROP TABLE "WebSetting";
ALTER TABLE "new_WebSetting" RENAME TO "WebSetting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
