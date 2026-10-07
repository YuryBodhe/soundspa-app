export function createLocationSlug(name: string, suffix: string): string {
  const base = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "") || "location";
  return `${base}-${suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "new"}`;
}

export function trialCountdown(input: { status: string; startsAt: Date | string; endsAt: Date | string }, now = Date.now()): { key: "trialEnded" | "trialActive" | "trialLessThanDay" | "trialDays"; days?: number } {
  if (input.status !== "active") return { key: "trialEnded" };
  if (new Date(input.startsAt).getTime() > now) return { key: "trialActive" };
  const endsAt = input.endsAt;
  const remaining = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return { key: "trialEnded" };
  if (remaining < 24 * 60 * 60 * 1000) return { key: "trialLessThanDay" };
  return { key: "trialDays", days: Math.ceil(remaining / (24 * 60 * 60 * 1000)) };
}

export function trialDaysMessageKey(locale: "en" | "ru" | "vi" | "th", days: number): "trialDays" | "trialDaysOne" | "trialDaysFew" | "trialDaysMany" {
  const category = new Intl.PluralRules(locale).select(days);
  if (category === "one") return "trialDaysOne";
  if (category === "few") return "trialDaysFew";
  if (category === "many") return "trialDaysMany";
  return "trialDays";
}
