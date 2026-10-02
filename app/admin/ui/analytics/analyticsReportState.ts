import type { AnalyticsReportV1 } from "../../../../db/v2/analyticsReportModel";

export type AnalyticsReportState = { report: AnalyticsReportV1 | null; error: string | null };
export type AnalyticsReportAction =
  | { type: "generate-started" }
  | { type: "generated"; report: AnalyticsReportV1 }
  | { type: "generation-failed"; error: string };

export const INITIAL_ANALYTICS_REPORT_STATE: AnalyticsReportState = { report: null, error: null };

export function analyticsReportStateReducer(_state: AnalyticsReportState, action: AnalyticsReportAction): AnalyticsReportState {
  if (action.type === "generate-started") return { report: null, error: null };
  if (action.type === "generated") return { report: action.report, error: null };
  return { report: null, error: action.error };
}
