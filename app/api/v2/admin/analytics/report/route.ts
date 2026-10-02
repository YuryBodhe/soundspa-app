import { handleAdminAnalyticsPost } from "../../../../../../lib/v2/adminAnalyticsHttp";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleAdminAnalyticsPost(request, async (options) => {
    const { getAnalyticsReport } = await import("../../../../../../db/v2/queries/analyticsReport");
    return getAnalyticsReport(options);
  });
}
