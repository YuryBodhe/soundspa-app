import { NextRequest, NextResponse } from "next/server";
import { operatorAuthResponse, operatorAuthStatus } from "./lib/v2/adminOperator";

export function proxy(request: NextRequest) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  return status === 200 ? NextResponse.next() : operatorAuthResponse(status);
}

export const config = { matcher: ["/app/admin/channels/v2/:path*", "/api/v2/admin/content/:path*"] };
