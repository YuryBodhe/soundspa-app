import { NextResponse } from "next/server";
import { db } from "@/lib/db.pg";
import { users, loginTokens } from "@/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendMagicLinkEmail } from "@/lib/agentmail";

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
    const body = await req.json();
    const email = (body.email as string | undefined)?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { error: "Укажите email" },
        { status: 400 }
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    // Если пользователя нет — отвечаем мягко, без утечки информации
    if (!user) {
      return NextResponse.json({
        ok: true,
        message:
          "Если такой email зарегистрирован, мы отправили на него ссылку для входа.",
      });
    }

    const now = new Date();
    const expiresAt = addMinutes(now, TOKEN_TTL_MINUTES);
    const token = randomBytes(32).toString("hex");

    await db.insert(loginTokens).values({
      token,
      userId: user.id,
      expiresAt: toIso(expiresAt),
    });

    const magicLink = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/login?token=${token}`;

    try {
      await sendMagicLinkEmail({
        to: email,
        magicLink,
        context: "login",
      });
    } catch (e) {
      console.error("🚨 Failed to send login magic link email", e);
      return NextResponse.json(
        {
          ok: false,
          error:
            "Мы создали ссылку для входа, но не смогли отправить письмо. Свяжитесь с поддержкой Sound Spa.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message:
        "Если такой email зарегистрирован, мы отправили на него письмо со ссылкой для входа.",
    });
  } catch (error) {
    console.error("🚨 request-magic-link error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
