import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const SESSION_COOKIE = "soundspa_session";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(SESSION_COOKIE)?.value;
    
    if (!session) {
      return NextResponse.json({ error: 'No session' }, { status: 401 });
    }
    
    return NextResponse.json({ ok: true, hasSession: true });
  } catch (error) {
    console.error('Check app access error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}