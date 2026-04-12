import { NextResponse } from "next/server";
import { db } from "@/lib/db.pg";
import { users, tenants } from "@/db";
import { eq } from 'drizzle-orm';
import { createSessionToken } from '@/lib/session';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    console.log(`🔐 Login attempt: ${email}`);

    // Найти пользователя по email и паролю
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
      with: {
        tenant: true
      }
    });

    if (!user || user.password !== password) {
      console.log("❌ Invalid credentials");
      return NextResponse.json(
        { error: "Неверный логин или пароль" }, 
        { status: 401 }
      );
    }

    // Создаем токен сессии
    const sessionToken = createSessionToken({
      userId: user.id,
      tenantId: user.tenantId,
      tenantSlug: user.tenant.slug,
      iat: Date.now()
    });

    const response = NextResponse.json({ 
      ok: true, 
      message: "Login successful",
      tenantSlug: user.tenant.slug
    });

    // Устанавливаем куку с токеном сессии
    response.cookies.set("soundspa_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30  // 30 дней
    });

    console.log(`✅ Login successful for user ${user.id}`);
    return response;

  } catch (error) {
    console.error("🚨 Server error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" }, 
      { status: 500 }
    );
  }
}