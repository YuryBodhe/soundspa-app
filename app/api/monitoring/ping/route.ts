import { NextRequest, NextResponse } from "next/server";
import { logMonitoringEvent, upsertMonitoringCurrent } from "@/lib/monitoring/current";

export async function POST(req: NextRequest) {
  try {
    const {
      tenantId,
      status,
      metadata = {},
      device,
      channelId,
      noiseId,
      sessionId,
      eventType = "player_heartbeat",
      userAgent,
      clientType,
      details,
    } = await req.json();

    if (tenantId === undefined || tenantId === null || tenantId === "") {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    const tId = Number(tenantId);
    if (!Number.isInteger(tId) || tId <= 0) {
      return NextResponse.json({ error: "Invalid tenantId" }, { status: 400 });
    }

    const currentStatus = status || "online";

    const enrichedMetadata = {
      ...metadata,
      device,
      channelId,
      noiseId,
      sessionId,
      eventType,
    };

    await upsertMonitoringCurrent({
      tenantId: tId,
      status: currentStatus,
      metadata: enrichedMetadata,
    });

    await logMonitoringEvent({
      tenantId: tId,
      event: "ping",
      eventType,
      sessionId,
      channelId: channelId ? Number(channelId) : null,
      metadata: enrichedMetadata,
      level: currentStatus === "offline" ? "warn" : "info",
      details,
      userAgent,
      clientType,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Ping error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}