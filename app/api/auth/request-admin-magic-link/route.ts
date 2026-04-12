import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db.pg";
import { users, loginTokens } from "@/db";
import { eq } from "drizzle-orm";
import { sendMagicLinkEmail } from "@/lib/agentmail";

const ADMIN_EMAIL = "108aura@gmail.com";
const TOKEN_TTL_MINUTES = 30;

function addMinutes(date: Date, minutes: number): Date {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function toIso(date: Date): string {
  return date.toISOString();
}

export async function POST(req: Request) {
  try {
    // Поддерживаем как JSON-запросы, так и form-POST с admin-login страницы
    let email: string | undefined;

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await req.json();
      email = (body.email as string | undefined)?.trim().toLowerCase();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      email = (form.get("email") as string | null)?.trim().toLowerCase() ?? undefined;
    }

    if (!email) {
      return NextResponse.json(
        { error: "Укажите email" },
        { status: 400 }
      );
    }

    if (email !== ADMIN_EMAIL) {
      // Мягкий ответ, без утечки того, что админский email другой
      return NextResponse.json({
        ok: true,
        message: "Если такой email зарегистрирован как админ, мы отправили на него ссылку для входа.",
      });
    }

    const adminUser = await db.query.users.findFirst({
      where: eq(users.email, ADMIN_EMAIL),
    });

    if (!adminUser) {
      return NextResponse.json(
        { error: "Админский пользователь не найден" },
        { status: 400 }
      );
    }

    const now = new Date();
    const expiresAt = addMinutes(now, TOKEN_TTL_MINUTES);
    const token = randomBytes(32).toString("hex");

    await db.insert(loginTokens).values({
      token,
      userId: adminUser.id,
      expiresAt: toIso(expiresAt),
    });

    const magicLink = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/admin-login/consume?token=${token}`;

    try {
      await sendMagicLinkEmail({
        to: ADMIN_EMAIL,
        magicLink,
        context: "admin-login",
      });
    } catch (e) {
      console.error("🚨 Failed to send admin magic link email", e);
      return NextResponse.json(
        {
          ok: false,
          error:
            "Мы создали ссылку для входа в админку, но не смогли отправить письмо. Свяжитесь с поддержкой Sound Spa.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Мы отправили admin magic link на указанный email.",
      ...(process.env.NODE_ENV !== "production" ? { magicLink } : {}),
    });
  } catch (error) {
    console.error("🚨 request-admin-magic-link error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
