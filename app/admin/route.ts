import { operatorAuthResponse, operatorAuthStatus } from "../../lib/v2/adminOperator";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { const status = operatorAuthStatus(request.headers.get("authorization")); if (status !== 200) return operatorAuthResponse(status); return new Response(null, { status: 307, headers: { Location: "/admin/ui", "Cache-Control": "no-store" } }); }
