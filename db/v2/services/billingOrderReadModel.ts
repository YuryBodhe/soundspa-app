export type BillingOrderState = "draft" | "quoted" | "pending" | "paid" | "expired" | "canceled" | "failed";

/** Derives elapsed pending expiry at read time without changing financial rows. */
export function resolveBillingOrderState(input: {
  orderStatus: string;
  expiresAt: Date | null;
  paymentStatus: string | null;
}, now = new Date()): BillingOrderState {
  if (input.orderStatus === "paid" || input.paymentStatus === "succeeded") return "paid";
  if (input.orderStatus === "canceled" || input.paymentStatus === "canceled") return "canceled";
  if (input.orderStatus === "failed" || input.paymentStatus === "failed") return "failed";
  if (input.orderStatus === "expired" || (input.orderStatus === "pending" && input.expiresAt && input.expiresAt <= now)) return "expired";
  if (input.orderStatus === "draft" || input.orderStatus === "quoted" || input.orderStatus === "pending") return input.orderStatus;
  throw new Error("unknown_billing_order_state");
}
