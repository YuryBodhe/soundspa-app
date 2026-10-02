import { AnalyticsReportNotFoundError, validateAnalyticsScope, type AnalyticsPeriod, type AnalyticsReportV1, type AnalyticsScope } from "../../db/v2/analyticsReportModel";
import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "./adminOperator";

const NO_STORE = { "Cache-Control": "no-store" };
const PERIODS = new Set<AnalyticsPeriod>(["1h", "24h", "7d", "30d"]);

export class AdminAnalyticsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminAnalyticsInputError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function parseAnalyticsReportRequest(value: unknown): { scope: AnalyticsScope; period: AnalyticsPeriod } {
  if (!isRecord(value) || !exactKeys(value, ["scope", "period"])) throw new AdminAnalyticsInputError("A scope and period are required.");
  if (typeof value.period !== "string" || !PERIODS.has(value.period as AnalyticsPeriod)) {
    throw new AdminAnalyticsInputError("Select a supported report period.");
  }
  if (!isRecord(value.scope) || typeof value.scope.type !== "string") {
    throw new AdminAnalyticsInputError("Select a valid report scope.");
  }

  let scope: AnalyticsScope;
  if (value.scope.type === "all" && exactKeys(value.scope, ["type"])) {
    scope = { type: "all" };
  } else if (value.scope.type === "organization" && exactKeys(value.scope, ["type", "organizationId"]) && typeof value.scope.organizationId === "string") {
    scope = { type: "organization", organizationId: value.scope.organizationId };
  } else if (value.scope.type === "location" && exactKeys(value.scope, ["type", "locationId"]) && typeof value.scope.locationId === "string") {
    scope = { type: "location", locationId: value.scope.locationId };
  } else {
    throw new AdminAnalyticsInputError("Select a valid report scope.");
  }

  try {
    validateAnalyticsScope(scope);
  } catch {
    throw new AdminAnalyticsInputError("The selected scope ID is invalid.");
  }
  return { scope, period: value.period as AnalyticsPeriod };
}

export async function handleAdminAnalyticsPost(
  request: Request,
  getReport: (options: { scope: AnalyticsScope; period: AnalyticsPeriod }) => Promise<AnalyticsReportV1>,
): Promise<Response> {
  const authStatus = operatorAuthStatus(request.headers.get("authorization"));
  if (authStatus !== 200) return operatorAuthResponse(authStatus);
  if (!isSameOriginMutation(request)) {
    return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: NO_STORE });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return Response.json({ ok: false, code: "unsupported_media_type", message: "A JSON report request is required." }, { status: 400, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, code: "invalid_json", message: "A valid report request is required." }, { status: 400, headers: NO_STORE });
  }

  let options: { scope: AnalyticsScope; period: AnalyticsPeriod };
  try {
    options = parseAnalyticsReportRequest(body);
  } catch (error) {
    const message = error instanceof AdminAnalyticsInputError ? error.message : "The report request is invalid.";
    return Response.json({ ok: false, code: "invalid_request", message }, { status: 400, headers: NO_STORE });
  }

  try {
    return Response.json(await getReport(options), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AnalyticsReportNotFoundError) {
      const code = error.code.toLowerCase();
      return Response.json({ ok: false, code, message: error.message }, { status: 404, headers: NO_STORE });
    }
    console.error("[V2 analytics] Canonical report query failed.");
    return Response.json({ ok: false, code: "analytics_unavailable", message: "The analytics report is unavailable." }, { status: 500, headers: NO_STORE });
  }
}
