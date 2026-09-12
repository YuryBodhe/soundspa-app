import { defineConfig } from "drizzle-kit";
import { getV2DatabaseUrl } from "./db/v2/connectionConfig";

// No implicit .env loading, no V1 schema/client imports.
export default defineConfig({
  schema: "./db/v2/schema/index.ts",
  out: "./drizzle/v2",
  dialect: "postgresql",
  dbCredentials: { url: getV2DatabaseUrl() },
  migrations: { schema: "drizzle_v2", table: "__drizzle_migrations" },
});
