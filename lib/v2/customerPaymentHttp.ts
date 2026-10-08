import "server-only";
import { CUSTOMER_SESSION_COOKIE } from "./customerAuthCore";

function customerToken(request: Request): string | null {
  const pair = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${CUSTOMER_SESSION_COOKIE}=`));
  if (!pair) return null;
  try { return decodeURIComponent(pair.slice(CUSTOMER_SESSION_COOKIE.length + 1)); } catch { return null; }
}

export async function getVerifiedCustomerPaymentSession(request: Request) {
  const token = customerToken(request);
  if (!token) return null;
  const { getCustomerSession } = await import("@/db/v2/services/customerAuth");
  const session = await getCustomerSession(token);
  return session?.user.emailVerifiedAt ? session : null;
}
