import { NextResponse } from "next/server";
import { db } from "@/lib/db.pg";
import { loginTokens, users } from "@/db";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = "108aura@gmail.com";

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
    });

    if (!user || user.email !== ADMIN_EMAIL) {
      return NextResponse.json(
        { error: "Недействительный admin-токен" },
        { status: 400 }
      );
    }

    // Помечаем токен использованным
    await db
      .update(loginTokens)
      .set({ usedAt: new Date().toISOString() })
      .where(eq(loginTokens.id, record.id));

    const response = NextResponse.json({ ok: true });

    // Ставим отдельную admin-сессию
    response.cookies.set("soundspa_admin_session", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, // 1 день
    });

    return response;
  } catch (error) {
    console.error("🚨 consume-admin-magic-link error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
