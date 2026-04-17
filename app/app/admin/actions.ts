"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db.pg";
import { eq, and, max } from "drizzle-orm";
import { tenants, channels, tenantChannels, users } from "@/db";

// ── TENANT ACTIONS ────────────────────────────

export async function updateTenant(
  tenantId: number,
  data: { brandName: string; paidTill: string },
) {
  const paidTillStr = data.paidTill || null;

  await db
    .update(tenants)
    .set({
      brandName: data.brandName,
      paidTill: paidTillStr,
    })
    .where(eq(tenants.id, tenantId));

  revalidatePath("/app/admin");
  revalidatePath(`/app/admin/tenants/${tenantId}`);
}

export async function deleteTenant(tenantId: number) {
  // Protect template tenant Spaquatoria
  if (tenantId === 1) {
    throw new Error("Cannot delete template tenant #1");
  }

  await db.delete(tenants).where(eq(tenants.id, tenantId));

  revalidatePath("/app/admin");
  revalidatePath(`/app/admin/tenants/${tenantId}`);
}

// ── TENANT-CHANNEL ACTIONS ────────────────────

export async function updateTenantChannel(
  tenantId: number,
  channelId: number,
  data: { order: number; isNew: boolean },
) {
  await db
    .update(tenantChannels)
    .set({
      order: data.order,
    })
    .where(
      and(
        eq(tenantChannels.tenantId, tenantId),
        eq(tenantChannels.channelId, channelId),
      ),
    );

  // isNew — глобальное поле канала, обновляем в channels
  await db
    .update(channels)
    .set({
      isNew: data.isNew,
    })
    .where(eq(channels.id, channelId));

  revalidatePath(`/app/admin/tenants/${tenantId}`);
}

export async function addChannelToTenant(tenantId: number, channelId: number) {
  // Берём max order для этого тенанта
  const result = await db
    .select({
      maxOrder: max(tenantChannels.order),
    })
    .from(tenantChannels)
    .where(eq(tenantChannels.tenantId, tenantId));

  const nextOrder = (result[0]?.maxOrder ?? 0) + 1;

  await db
    .insert(tenantChannels)
    .values({ tenantId, channelId, order: nextOrder })
    .onConflictDoNothing();

  revalidatePath(`/app/admin/tenants/${tenantId}`);
}

export async function removeChannelFromTenant(
  tenantId: number,
  channelId: number,
) {
  await db
    .delete(tenantChannels)
    .where(
      and(
        eq(tenantChannels.tenantId, tenantId),
        eq(tenantChannels.channelId, channelId),
      ),
    );

  revalidatePath(`/app/admin/tenants/${tenantId}`);
}

// ── CHANNEL ACTIONS ───────────────────────────

export async function createChannel(data: {
  code: string;
  slug: string;
  displayName: string;
  mood: string;
  streamUrl: string;
  image: string;
  order: number;
  kind: string;
  isNew: boolean;
}) {
  await db.insert(channels).values(data);
  revalidatePath("/app/admin/channels");
}

export async function updateChannel(
  channelId: number,
  data: {
    displayName: string;
    mood: string;
    streamUrl: string;
    image: string;
    order: number;
    kind: string;
    isNew: boolean;
  },
) {
  await db.update(channels).set(data).where(eq(channels.id, channelId));

  revalidatePath("/app/admin/channels");
}
export async function deleteChannel(channelId: number) {
  // 1. Сначала удаляем все связи этого канала с салонами (тенантами)
  // Это критично, чтобы не нарушить целостность базы данных
  await db
    .delete(tenantChannels)
    .where(eq(tenantChannels.channelId, channelId));

  // 2. Теперь удаляем сам канал
  await db
    .delete(channels)
    .where(eq(channels.id, channelId));

  // 3. Обновляем пути, чтобы изменения сразу отразились в админке
  revalidatePath("/app/admin/channels");
  // Также стоит обновить админку тенантов, так как список доступных каналов там изменится
  revalidatePath("/app/admin/tenants/[id]", "page");
}

// ── USER ACTIONS ──────────────────────────────

export async function createUser(data: {
  email: string;
  password: string;
  tenantId: number;
}): Promise<{ error?: string }> {
  try {
    await db.insert(users).values({
      email: data.email,
      password: data.password,
      tenantId: data.tenantId,
    });
    revalidatePath("/app/admin/users");
    return {};
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err?.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return { error: `Email "${data.email}" already exists` };
    }
    return { error: "Failed to create user" };
  }
}