import { NextResponse } from 'next/server';

export async function GET() {
// ВРЕМЕННАЯ заглушка:
// Старый формат сессии и схема tenants сейчас меняются,
// поэтому этот endpoint временно отключён, чтобы не ломать сборку.
return NextResponse.json(
{ error: 'app-data endpoint temporarily disabled' },
{ status: 503 }
);
}