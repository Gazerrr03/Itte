import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { SCHEMA_SQL } from "@/server/schema-sql";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; dbInited?: boolean };

let initPromise: Promise<void> | null = null;

async function ensureDatabase(client: PrismaClient): Promise<void> {
  if (globalForPrisma.dbInited) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await client.$queryRaw`SELECT 1 FROM Session LIMIT 1`;
      globalForPrisma.dbInited = true;
    } catch {
      const stmts = SCHEMA_SQL
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);

      for (const stmt of stmts) {
        try {
          await client.$executeRawUnsafe(`${stmt};`);
        } catch {
          // May already exist from concurrent init.
        }
      }
      globalForPrisma.dbInited = true;
    }
  })();

  return initPromise;
}

function createPrismaClient(): PrismaClient {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();

  if (tursoUrl && tursoToken) {
    const adapter = new PrismaLibSQL({ url: tursoUrl, authToken: tursoToken });
    return new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function wrapWithInit<T extends object>(target: T): T {
  return new Proxy(target, {
    get(_target, prop, receiver) {
      const value = Reflect.get(_target, prop, receiver);
      if (typeof value === "function") {
        return new Proxy(value, {
          apply(fnTarget, thisArg, args) {
            return ensureDatabase(_target as unknown as PrismaClient).then(() =>
              Reflect.apply(fnTarget, thisArg, args),
            );
          },
        });
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return wrapWithInit(value as object);
      }
      return value;
    },
  }) as T;
}

const rawClient = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = rawClient;
}

export const db = wrapWithInit(rawClient) as PrismaClient;
