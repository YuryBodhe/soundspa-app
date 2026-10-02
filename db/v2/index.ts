export { v2Db, v2Pool } from "./client";
export { authenticateDeviceCredential } from "./queries/devices";
export { getAnalyticsReport, AnalyticsReportNotFoundError } from "./queries/analyticsReport";
export type { AnalyticsPeriod, AnalyticsScope, AnalyticsReportV1 } from "./queries/analyticsReport";
export { getMonitoringSnapshot } from "./queries/monitoringSnapshot";
export type { MonitoringSnapshotV1 } from "./monitoringSnapshotModel";
export type V2Db = typeof import("./client").v2Db;
