import { NextResponse } from "next/server";
import { db } from "@/lib/db.pg";
import { users } from "@/db";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = "108aura@gmail.com";
const ADMIN_PASSWORD = process.env.SOUNDSPA_ADMIN_PASSWORD || "change-me-admin";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    console.log(`🔐 Admin login attempt: ${email}`);

    if (!email || !password) {
      return NextResponse.json(
        { error: "Укажите email и пароль" },
        { status: 400 },
      );
    }

    if (email.trim().toLowerCase() !== ADMIN_EMAIL) {
      console.log("❌ Invalid admin email");
      return NextResponse.json(
        { error: "Неверные учетные данные" },
        { status: 401 },
      );
    }

    if (password !== ADMIN_PASSWORD) {
      console.log("❌ Invalid admin password");
      return NextResponse.json(
        { error: "Неверные учетные данные" },
        { status: 401 },
      );
    }

    // Дополнительно проверим, что такой пользователь есть в БД (на всякий случай)
    const adminUser = await db.query.users.findFirst({
      where: eq(users.email, ADMIN_EMAIL),
    });

    if (!adminUser) {
      return NextResponse.json(
        { error: "Админский пользователь не найден" },
        { status: 400 },
      );
    }

    const response = NextResponse.json({ ok: true });

    // Ставим admin-сессию
    response.cookies.set("soundspa_admin_session", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, // 1 день
    });

    console.log("✅ Admin login successful");
    return response;
  } catch (error) {
    console.error("🚨 Admin login server error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 },
    );
  }
}
