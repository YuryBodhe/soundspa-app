import { getAnalyticsReport } from "../../db/v2/queries/analyticsReport";
import { v2Pool } from "../../db/v2/client";

/** Read-only staging smoke command for the canonical report query. */
async function main() {
  try {
    const report = await getAnalyticsReport({ scope: { type: "all" }, period: "24h" });
    console.log(JSON.stringify({
      metadata: report.metadata,
      summary: report.summary,
      locations: report.locations.map(({ organizationName, locationName, playerActiveSeconds, musicSeconds, ambientSeconds, deviceCount, onlineDeviceCount }) => ({
        organizationName, locationName, playerActiveSeconds, musicSeconds, ambientSeconds, deviceCount, onlineDeviceCount,
      })),
      musicUsage: report.musicUsage,
      ambientUsage: report.ambientUsage,
      reliability: report.reliability,
      lifecycle: report.lifecycle,
      dataQuality: report.dataQuality,
    }, null, 2));
  } catch {
    console.error("Analytics report smoke query failed (details suppressed).");
    process.exitCode = 1;
  } finally {
    await v2Pool.end();
  }
}

void main();
