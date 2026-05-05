import { NextResponse } from "next/server";
import { db } from "@/lib/db.pg";
import { tenants, users, invites, loginTokens, tenantChannels, channels } from "@/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendMagicLinkEmail } from "@/lib/agentmail";
import { sendTelegramMessage } from "@/lib/notifications/telegram";

const TRIAL_DAYS = 30;


function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toIso(date: Date): string {
  return date.toISOString();
}

const cyrillicMap: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function slugify(name: string): string {
  const lower = name.toLowerCase().trim();
  let translit = "";

  for (const char of lower) {
    if (cyrillicMap[char]) {
      translit += cyrillicMap[char];
    } else {
      translit += char;
    }
  }

  return translit
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "tenant";
}

async function generateUniqueSlug(baseName: string) {
  let base = slugify(baseName);
  if (!base) base = "tenant";

  // Проверяем, свободен ли базовый slug
  const existing = await db.query.tenants.findFirst({
    where: eq(tenants.slug, base),
  });

  if (!existing) return base;

  // Если занят, добавляем суффикс -2, -3, ...
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    const found = await db.query.tenants.findFirst({
      where: eq(tenants.slug, candidate),
    });
    if (!found) return candidate;
  }

  // Фоллбек: случайный суффикс
  return `${base}-${randomBytes(3).toString("hex")}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = (body.email as string | undefined)?.trim().toLowerCase();
    const salonName = (body.salonName as string | undefined)?.trim();
    const inviteCode = (body.inviteCode as string | undefined)?.trim();

    if (!email || !salonName || !inviteCode) {
      return NextResponse.json(
        { error: "Заполните email, название салона и инвайт-код" },
        { status: 400 }
      );
    }

    // 1) Проверяем инвайт
    const invite = await db.query.invites.findFirst({
      where: eq(invites.code, inviteCode),
    });

    if (!invite) {
      return NextResponse.json(
        { error: "Неверный инвайт-код" },
        { status: 400 }
      );
    }

    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "Срок действия инвайт-кода истёк" },
        { status: 400 }
      );
    }

    if (
      invite.maxUses !== null &&
      invite.maxUses !== undefined &&
      invite.usedCount >= invite.maxUses
    ) {
      return NextResponse.json(
        { error: "Инвайт-код уже исчерпал количество использований" },
        { status: 400 }
      );
    }

    // 2) Проверяем, что email ещё не зарегистрирован
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Пользователь с таким email уже зарегистрирован" },
        { status: 400 }
      );
    }

    // 3) Создаём tenant + user в транзакции
    const now = new Date();
    const trialEnds = addDays(now, TRIAL_DAYS);

    const slug = await generateUniqueSlug(salonName);

    const result = await db.transaction(async (tx) => {
      // Создаём tenant и читаем его id через RETURNING
      const [tenantRow] = await tx
        .insert(tenants)
        .values({
          name: salonName,
          brandName: salonName,
          slug,
          trialStartedAt: now.toISOString(),
          trialEndsAt: trialEnds.toISOString(),
          paidTill: null,
        })
        .returning({ id: tenants.id });

      if (!tenantRow) {
        throw new Error("Failed to insert tenant");
      }

      const tenantId = tenantRow.id;

      // Создаём user
      const [userRow] = await tx
        .insert(users)
        .values({
          email,
          // В новой модели пароль не используется, но поле NOT NULL,
          // поэтому кладём техническое значение.
          password: "magic-link-only",
          tenantId,
        })
        .returning({ id: users.id });

      if (!userRow) {
        throw new Error("Failed to insert user");
      }

      const userId = userRow.id;

      // Подхватываем все музыкальные и шумовые каналы (кроме divnitsa)
      const baseChannels = await tx
        .select({
          id: channels.id,
          code: channels.code,
          slug: channels.slug,
          kind: channels.kind,
          defaultOrder: channels.order,
        })
        .from(channels)
        .where(
          and(
            inArray(channels.kind, ["music", "noise", "ambient"]),
            sql`${channels.slug} != 'divnitsa'`,
          ),
        )
        .orderBy(channels.order);

      let orderCounter = 1;
      for (const ch of baseChannels) {
        await tx.insert(tenantChannels).values({
          tenantId,
          channelId: ch.id,
          order: orderCounter++,
        });
      }

      // Обновляем счётчик использования инвайта
      await tx
        .update(invites)
        .set({ usedCount: (invite.usedCount ?? 0) + 1 })
        .where(eq(invites.id, invite.id));

      return { tenantId, userId };
    });

    // 4) Создаём login-token для magic link
    const token = randomBytes(32).toString("hex");
    const tokenExpires = addDays(now, 1); // токен живёт 1 день

    await db.insert(loginTokens).values({
      token,
      userId: result.userId,
      expiresAt: toIso(tokenExpires),
    });

    const magicLink = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/login?token=${token}`;

    // Отправляем письмо с magic link через AgentMail
    try {
      await sendMagicLinkEmail({
        to: email,
        magicLink,
        salonName,
        context: "signup",
      });
    } catch (e) {
      console.error("🚨 Failed to send signup magic link email", e);
      return NextResponse.json(
        {
          ok: false,
          error:
            "Кабинет создан, но не удалось отправить письмо со ссылкой для входа. Свяжитесь с поддержкой Sound Spa.",
        },
        { status: 500 }
      );
    }

    // Telegram уведомление о новой регистрации (не блокирует ответ)
    sendTelegramMessage(
      [
        `🆕 *Новая регистрация*`,
        `Салон: ${salonName}`,
        `Email: ${email}`,
        `Tenant ID: ${result.tenantId}`,
        `Trial до: ${trialEnds.toISOString().slice(0, 10)}`,
      ].join("\n"),
    ).catch((err) => console.error("Failed to send Telegram signup notify", err));

    return NextResponse.json({
      ok: true,
      message:
        "Кабинет создан. Мы отправили письмо со ссылкой для входа на указанный email.",
      // В dev-режиме можно оставить ссылку в ответе для удобства
      ...(process.env.NODE_ENV !== "production" ? { magicLink } : {}),
    });
  } catch (error) {
    console.error("🚨 Signup error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
