import { NextResponse } from "next/server";
import { db } from "@/lib/db.pg";
import { users, tenants } from "@/db";
import { eq } from 'drizzle-orm';
import { createSessionToken } from '@/lib/session';
import { monitoringLogs } from "@/db/schema/monitoring"; 

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    console.log(`🔐 Login attempt: ${email}`);

    // 1. Поиск пользователя
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

    // 2. Создание токена сессии
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

    // 3. Установка кук
    response.cookies.set("soundspa_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30 
    });

    console.log(`✅ Login successful for user ${user.id}`);

    // 4. БЕЗОПАСНАЯ ЗАПИСЬ В БАЗУ ДЛЯ ВОРКЕРА
    try {
      const tenantName = user.tenant?.name || user.tenant?.slug || "Unknown Tenant";
      
      await db.insert(monitoringLogs).values({
        tenantId: user.tenantId,
        eventType: "auth_login",
        event: `Пользователь *${user.email}* вошел в салон *${tenantName}*`,
        level: "info",
        details: `ID Пользователя: ${user.id} | Tenant ID: ${user.tenantId}`,
      });
      console.log(`📝 Logged auth_login event for user ${user.id} to monitoring_logs`);
    } catch (dbLogError) {
      console.error("⚠️ Failed to write login log to DB:", dbLogError);
    }

    // 5. Возвращаем ответ клиенту
    return response;

  } catch (error) {
    console.error("🚨 Server error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" }, 
      { status: 500 }
    );
  }
}