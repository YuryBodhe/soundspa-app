export type PlayerSubscriptionLine = {
  productId: string;
  productName: string;
  kind: "trial" | "active" | "canceled" | "upcoming" | "expired";
  date: string | null;
  startsAt: string | null;
};

type BillingPayload = {
  locations?: unknown;
};

function validDate(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

/** Select only the device's Location and the minimal entitlement fields needed by the player. */
export function playerSubscriptionLines(payload: BillingPayload, locationId: string): PlayerSubscriptionLine[] {
  if (!Array.isArray(payload.locations)) return [];
  const location = payload.locations.find((candidate) => candidate && typeof candidate === "object" &&
    (candidate as { id?: unknown }).id === locationId) as { products?: unknown } | undefined;
  if (!Array.isArray(location?.products)) return [];

  const lines: PlayerSubscriptionLine[] = [];
  for (const candidate of location.products) {
    if (!candidate || typeof candidate !== "object") continue;
    const product = candidate as Record<string, unknown>;
    if (typeof product.productId !== "string" || typeof product.productName !== "string") continue;

    const trialEndsAt = validDate(product.trialEndsAt);
    if (product.trialActive === true && trialEndsAt) {
      lines.push({ productId: product.productId, productName: product.productName, kind: "trial", date: trialEndsAt, startsAt: null });
    }

    const paidThrough = validDate(product.paidThrough);
    const paidStartsAt = validDate(product.paidStartsAt);
    if (product.status === "subscription") {
      lines.push({ productId: product.productId, productName: product.productName,
        kind: product.subscriptionCanceled === true ? "canceled" : "active", date: paidThrough, startsAt: null });
    } else if (product.status === "upcoming" && paidThrough) {
      lines.push({ productId: product.productId, productName: product.productName, kind: "upcoming", date: paidThrough, startsAt: paidStartsAt });
    } else if (product.status === "expired" && paidThrough) {
      lines.push({ productId: product.productId, productName: product.productName, kind: "expired", date: paidThrough, startsAt: null });
    }
  }
  return lines;
}
