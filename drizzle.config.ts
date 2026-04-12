import type { Config } from "drizzle-kit";

const isProd = process.env.NODE_ENV === "production";

const dbUrl =
  (isProd ? process.env.SOUNDSPA_DB_FILE : undefined) ?? "./soundspa.sqlite";

export default {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbUrl,
  },
} satisfies Config;
