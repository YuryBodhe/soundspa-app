export function currencyMinorDigits(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) return 2;
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return 2; }
}

/** Parses a plain decimal without floating-point arithmetic. */
export function parseMajorAmount(value: string, currency: string): string | null {
  const digits = currencyMinorDigits(currency);
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > digits) return null;
  const fraction = (match[2] ?? "").padEnd(digits, "0");
  const minor = `${match[1]}${fraction}`.replace(/^0+(?=\d)/, "");
  if (!/^[1-9]\d{0,18}$/.test(minor)) return null;
  return minor;
}

export function formatMinorAmount(value: string, currency: string): string {
  if (!/^\d+$/.test(value)) return "";
  const digits = currencyMinorDigits(currency);
  if (!digits) return value;
  const normalized = value.padStart(digits + 1, "0");
  return `${normalized.slice(0, -digits)}.${normalized.slice(-digits)}`;
}
