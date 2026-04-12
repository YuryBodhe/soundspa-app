import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";

import path from "node:path";
const isProd = process.env.NODE_ENV === "production";
const dbFile = (isProd ? process.env.SOUNDSPA_DB_FILE : undefined) ?? path.join(process.cwd(), "soundspa.sqlite");
const sqlite = new Database(dbFile);
export const db = drizzle(sqlite, { schema });

export type Db = typeof db;
