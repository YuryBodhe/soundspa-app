import { and, eq, inArray } from "drizzle-orm";
import { v2Db } from "../client";
import { channelTranslations } from "../schema";

export type LocalizedTitles = Record<string, string>;
export async function getChannelLocalizedTitles(channelIds: string[], db: Pick<typeof v2Db, "select"> = v2Db) {
  const result = new Map<string, LocalizedTitles>();
  if (!channelIds.length) return result;
  const rows = await db.select().from(channelTranslations).where(inArray(channelTranslations.channelId, channelIds));
  for (const row of rows) { const titles = result.get(row.channelId) ?? {}; titles[row.locale] = row.title.trim(); result.set(row.channelId, titles); }
  return result;
}
export async function saveChannelTranslation(channelId: string, locale: string, title: string, db: Pick<typeof v2Db, "insert" | "delete"> = v2Db) {
  const value = title.trim();
  if (!value) return db.delete(channelTranslations).where(and(eq(channelTranslations.channelId, channelId), eq(channelTranslations.locale, locale)));
  return db.insert(channelTranslations).values({ channelId, locale, title: value }).onConflictDoUpdate({ target: [channelTranslations.channelId, channelTranslations.locale], set: { title: value, updatedAt: new Date() } });
}
