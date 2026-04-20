// apps/soundspa-app/actions/subscriptions.ts
'use server'

import { db } from "@/db";
import { tenants } from "@/db/schema.pg";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * Продлевает подписку тенанта.
 * @param tenantId - ID салона
 * @param days - на сколько дней продлить (например, 30 или 365)
 */
export async function extendTenantSubscription(tenantId: number, days: number) {
  try {
    if (days <= 0) throw new Error("Количество дней должно быть положительным");

    const result = await db.update(tenants)
      .set({
        // SQL CASE:
        // Если paid_till в будущем (> now()), прибавляем к нему.
        // Если paid_till в прошлом или NULL, прибавляем к текущему моменту.
        paidTill: sql`CASE 
          WHEN ${tenants.paidTill} > now() 
          THEN ${tenants.paidTill} + interval '${sql.raw(days.toString())} days'
          ELSE now() + interval '${sql.raw(days.toString())} days'
        END`
      })
      .where(eq(tenants.id, tenantId))
      .returning({ updatedId: tenants.id });

    if (result.length === 0) {
      return { success: false, error: "Салон не найден" };
    }

    // Заставляем Next.js обновить данные в админке без перезагрузки страницы
    revalidatePath('/admin/subscriptions');
    revalidatePath(`/admin/tenants/${tenantId}`);
    
    return { success: true };
  } catch (error) {
    console.error("Subscription Extension Error:", error);
    return { success: false, error: "Не удалось обновить подписку" };
  }
}