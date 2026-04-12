import { NextResponse } from "next/server";
import { db } from "@/lib/db.pg";
import { loginTokens, users, tenants } from "@/db";
import { eq } from "drizzle-orm";
import { createSessionToken } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token = (body.token as string | undefined)?.trim();

    if (!token) {
      return NextResponse.json(
        { error: "Токен не передан" },
        { status: 400 }
      );
    }

    const record = await db.query.loginTokens.findFirst({
      where: eq(loginTokens.token, token),
    });

    if (!record) {
      return NextResponse.json(
        { error: "Недействительная или устаревшая ссылка" },
        { status: 400 }
      );
    }

    if (record.usedAt) {
      return NextResponse.json(
        { error: "Эта ссылка уже была использована. Запросите новую." },
        { status: 400 }
      );
    }

    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "Срок действия ссылки истёк. Запросите новую." },
        { status: 400 }
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, record.userId),
      with: {
        tenant: true,
      },
    });

    if (!user || !user.tenant) {
      return NextResponse.json(
        { error: "Пользователь или кабинет не найдены" },
        { status: 400 }
      );
    }

    // Помечаем токен использованным
    await db
      .update(loginTokens)
      .set({ usedAt: new Date().toISOString() })
      .where(eq(loginTokens.id, record.id));

    const sessionToken = createSessionToken({
      userId: user.id,
      tenantId: user.tenantId,
      tenantSlug: user.tenant.slug,
      iat: Date.now(),
    });

    const response = NextResponse.json({
      ok: true,
      tenantSlug: user.tenant.slug,
    });

    response.cookies.set("soundspa_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (error) {
    console.error("🚨 consume-magic-link error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
