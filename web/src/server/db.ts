import { PrismaClient } from "@prisma/client";
import { SCHEMA_SQL } from "@/server/schema-sql";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; dbInited?: boolean };

let initPromise: Promise<void> | null = null;

async function createPrismaClient(): Promise<PrismaClient> {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();

  if (tursoUrl && tursoToken) {
    const { PrismaLibSQL } = await import("@prisma/adapter-libsql");
    const adapter = new PrismaLibSQL({ url: tursoUrl, authToken: tursoToken });
    return new PrismaClient({
      adapter: adapter as never,
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

async function getClient(): Promise<PrismaClient> {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = await createPrismaClient();
  }
  return globalForPrisma.prisma;
}

export async function ensureDatabase(): Promise<void> {
  if (globalForPrisma.dbInited) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const client = await getClient();
    try {
      await client.$queryRaw`SELECT 1 FROM Session LIMIT 1`;
      globalForPrisma.dbInited = true;
      return;
    } catch {
      // Need to create tables.
    }

    const stmts = SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      try {
        await client.$executeRawUnsafe(`${stmt};`);
      } catch {
        // May already exist.
      }
    }
    globalForPrisma.dbInited = true;
  })();

  return initPromise;
}

// For direct use in API routes: const db = await getDb();
export async function getDb(): Promise<PrismaClient> {
  await ensureDatabase();
  return getClient();
}

// Synchronous export for existing code. Backed by lazy init — the first
// actual method call on this proxy will auto-init the database.
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop: string) {
    if (prop === "then") return undefined; // avoid thenable confusion

    // Return a Proxy that lazily resolves the real client on method invocation.
    // target must be callable so the `apply` trap fires for db.$transaction() etc.
    const target = (() => {}) as object;
    return new Proxy(target, {
      get(_nested, method: string) {
        return (...args: unknown[]) =>
          getDb().then((client) => {
            const delegate = (client as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[prop];
            return delegate[method](...args);
          });
      },
      apply(_fn, _thisArg, args: unknown[]) {
        return getDb().then((client) => {
          const fn = (client as unknown as Record<string, (...a: unknown[]) => unknown>)[prop];
          return fn.apply(client, args);
        });
      },
    });
  },
}) as PrismaClient;
