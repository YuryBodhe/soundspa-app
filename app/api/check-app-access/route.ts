import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db } from "@/lib/db.pg";
import { loginTokens, users, tenants } from "@/db";
import { eq } from "drizzle-orm";

const SESSION_COOKIE = "soundspa_session";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    
    if (!token) {
      return NextResponse.json({ error: 'No session' }, { status: 401 });
    }

    // 1. Ищем сессию
    const sessionData = await db.query.loginTokens.findFirst({
      where: eq(loginTokens.token, token),
    });

    if (!sessionData) {
      return NextResponse.json({ error: 'No session found' }, { status: 401 });
    }

    // 2. Ищем пользователя и его тенанта отдельным простым запросом
    const userData = await db.query.users.findFirst({
      where: eq(users.id, sessionData.userId),
    });

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, userData.tenantId),
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 401 });
    }

    const userEmail = userData.email;
    const now = new Date();

    // --- МАСТЕР-КЛЮЧ ---
    if (userEmail === '108aura@gmail.com') {
      return NextResponse.json({ ok: true, type: 'admin_bypass' });
    }

    // 2. Проверяем оплату (если есть дата оплаты и она в будущем — всё ок)
    if (tenant.paidTill && new Date(tenant.paidTill) > now) {
      return NextResponse.json({ ok: true, type: 'paid' });
    }

    // 3. Проверяем триал (если дата окончания триала в будущем — всё ок)
    if (tenant.trialEndsAt && new Date(tenant.trialEndsAt) > now) {
      return NextResponse.json({ ok: true, type: 'trial' });
    }

    // 4. Если мы здесь, значит и оплата, и триал истекли
    return NextResponse.json({ 
      error: 'Access expired', 
      reason: 'trial_ended' 
    }, { status: 403 });

  } catch (error) {
    console.error('Check app access error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}