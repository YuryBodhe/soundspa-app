import "dotenv/config";
import { db } from "@/lib/db.pg"; // Проверь этот путь, в новом проекте может быть @/db
import { monitoringLogs } from "@/db/schema/monitoring";
import { monitoringReports } from "@/db/schema/monitoring"; // Наша новая таблица
import { lt, sql } from "drizzle-orm";

const BATCH_SIZE = Number(process.env.CLEANUP_BATCH_SIZE ?? 10000);
const BATCH_PAUSE_MS = Number(process.env.CLEANUP_BATCH_PAUSE_MS ?? 200);

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

  let totalDeleted = 0;
  let batch = 0;

  while (true) {
    batch += 1;
    const deletion = await db.execute<{ count: number }>(sql`
      WITH to_delete AS (
        SELECT "id"
        FROM ${monitoringLogs}
        WHERE "created_at" < ${cutoff}
        ORDER BY "created_at"
        LIMIT ${BATCH_SIZE}
      )
      DELETE FROM ${monitoringLogs}
      WHERE "id" IN (SELECT "id" FROM to_delete)
      RETURNING 1;
    `);

    const deleted = deletion.rows?.length ?? 0;
    totalDeleted += deleted;

    console.log(
      `🧹 Cleanup batch #${batch}: deleted ${deleted} rows (total ${totalDeleted}/${candidates}).`,
    );

    if (deleted < BATCH_SIZE) {
      break; // меньше batch size — больше нечего удалять
    }

    if (BATCH_PAUSE_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
    }
  }

  // ЛОГИРУЕМ В ТАБЛИЦУ ОТЧЕТОВ
  await db.insert(monitoringReports).values({
    agentName: "System Cleaner",
    status: "ok",
    content: `Очистка логов (батчи). Удалено строк: ${totalDeleted}. Глубина хранения: ${keepDays} дней.`,
  });

  return { success: true, deleted: totalDeleted, message: `Deleted ${totalDeleted} rows.` };
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