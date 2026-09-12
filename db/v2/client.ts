import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { getV2DatabaseUrl } from "./connectionConfig";

if (typeof window !== "undefined") throw new Error("V2 DB client is server-only.");

const connectionString = getV2DatabaseUrl();
const processGlobal = globalThis as typeof globalThis & { soundspaV2Pool?: Pool };
// One pool per process, including Next development hot reload.
export const v2Pool = processGlobal.soundspaV2Pool ?? new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
if (process.env.NODE_ENV !== "production") processGlobal.soundspaV2Pool = v2Pool;

export const v2Db = drizzle(v2Pool, { schema });
