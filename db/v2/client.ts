import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { getV2DatabaseUrl } from "./connectionConfig";

if (typeof window !== "undefined") throw new Error("V2 DB client is server-only.");

type V2Db = ReturnType<typeof createDb>;
type V2ClientGlobal = typeof globalThis & { soundspaV2Pool?: Pool };

const processGlobal = globalThis as V2ClientGlobal;
let pool: Pool | undefined;
let db: V2Db | undefined;

function createDb() {
  return drizzle(getPool(), { schema });
}

function getPool(): Pool {
  if (!pool) {
    // Keep environment validation at the actual DB-use boundary. Next.js may
    // import server modules while collecting page configuration at build time.
    const connectionString = getV2DatabaseUrl();
    pool = processGlobal.soundspaV2Pool ?? new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    if (process.env.NODE_ENV !== "production") processGlobal.soundspaV2Pool = pool;
  }
  return pool;
}

function getDb(): V2Db {
  db ??= createDb();
  return db;
}

function lazyProxy<T extends object>(resolve: () => T): T {
  const overrides = {} as T;
  return new Proxy(overrides, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      const instance = resolve();
      const value = Reflect.get(instance, property, instance) as unknown;
      return typeof value === "function" ? value.bind(instance) : value;
    },
    set(target, property, value, receiver) {
      return Reflect.set(target, property, value, receiver);
    },
    has(target, property) {
      return Reflect.has(target, property) || Reflect.has(resolve(), property);
    },
  });
}

export const v2Pool = lazyProxy(() => getPool()) as Pool;
export const v2Db = lazyProxy(() => getDb()) as V2Db;
