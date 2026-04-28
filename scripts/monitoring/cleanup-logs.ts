import "dotenv/config";
import { db } from "@/lib/db.pg"; // Проверь этот путь, в новом проекте может быть @/db
import { monitoringLogs } from "@/db/schema/monitoring";
import { monitoringReports } from "@/db/schema/monitoring"; // Наша новая таблица
import { lt, sql } from "drizzle-orm";

export async function runCleanup(keepDays: number = 14, dryRun: boolean = false) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - keepDays * msPerDay);

  console.log(`🧹 Cleanup: keeping last ${keepDays} days (>= ${cutoff.toISOString()})`);

  // Считаем кандидатов
  const [{ count: candidates }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(monitoringLogs)
    .where(lt(monitoringLogs.createdAt, cutoff));

  if (dryRun) {
    return { success: true, deleted: 0, message: `Dry run: ${candidates} rows found.` };
  }

  if (candidates === 0) {
    return { success: true, deleted: 0, message: "Nothing to delete." };
  }

  // Удаляем
  const deletion = await db.execute<{ count: number }>(sql`
    WITH deleted AS (
      DELETE FROM ${monitoringLogs}
      WHERE "created_at" < ${cutoff}
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM deleted;
  `);

  const deleted = deletion.rows?.[0]?.count ?? 0;

  // ЛОГИРУЕМ В ТАБЛИЦУ ОТЧЕТОВ
  await db.insert(monitoringReports).values({
    agentName: "System Cleaner",
    status: "ok",
    content: `Успешная очистка логов. Удалено строк: ${deleted}. Глубина хранения: ${keepDays} дней.`,
  });

  return { success: true, deleted, message: `Deleted ${deleted} rows.` };
}

// Позволяет запускать файл напрямую через npx tsx
if (require.main === module) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((part) => part.replace(/^--/, "").split("="))
  );
  const days = Number(args.keepDays ?? 14);
  runCleanup(days, args.dryRun === "true")
    .then((res) => console.log(res.message))
    .catch(console.error);
}