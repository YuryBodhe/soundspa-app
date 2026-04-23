import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db.pg";
import { monitoringCurrent, monitoringLogs } from "@/db/schema/monitoring";

export async function POST(req: NextRequest) {
  try {
    const { tenantId, status, metadata } = await req.json();

    if (tenantId === undefined || tenantId === null || tenantId === "") {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    const tId = Number(tenantId);
    if (!Number.isInteger(tId) || tId <= 0) {
      return NextResponse.json({ error: "Invalid tenantId" }, { status: 400 });
    }

    const currentStatus = status || "online";

    // 1. Обновляем мгновенный статус
    await db
      .insert(monitoringCurrent)
      .values({
        tenantId: tId,
        status: currentStatus,
        lastPing: new Date(),
        metadata: metadata || {},
      })
      .onConflictDoUpdate({
        target: monitoringCurrent.tenantId,
        set: {
          status: currentStatus,
          lastPing: new Date(),
          metadata: metadata || {},
        },
      });

    // 2. Пишем в историю для ИИ-аналитики
    // Мы сохраняем metadata как строку в details, чтобы агент мог её прочитать
    await db.insert(monitoringLogs).values({
      tenantId: tId,
      event: "ping",
      level: currentStatus === "offline" ? "warn" : "info",
      details: metadata ? JSON.stringify(metadata) : "No extra data",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Ping error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}