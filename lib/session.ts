import { cookies } from 'next/headers';
import { z } from 'zod';

const SESSION_SECRET = process.env.SESSION_SECRET || 'soundspa_fallback_secret';

// Схема payload сессии
const SessionPayloadSchema = z.object({
  userId: z.number(),
  tenantId: z.number(),
  tenantSlug: z.string(),
  iat: z.number()
});

type SessionPayload = z.infer<typeof SessionPayloadSchema>;

export function createSessionToken(payload: SessionPayload): string {
  // Простая base64 сериализация для совместимости
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function verifySessionToken(token: string): SessionPayload {
  try {
    const payload = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf-8')
    );
    return SessionPayloadSchema.parse(payload);
  } catch (error) {
    console.error('Session verification failed:', error);
    throw new Error('Invalid session token');
  }
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('soundspa_session')?.value;

  if (!token) return null;

  try {
    return verifySessionToken(token);
  } catch {
    return null;
  }
}