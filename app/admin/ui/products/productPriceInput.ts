/** Convert a major-unit RUB form value to exact integer kopeks without float arithmetic. */
export function productPriceMinorFromInput(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 11 || !/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("Enter a valid RUB amount with up to two decimal places.");
  const [whole, fraction = ""] = normalized.split(".");
  const minor = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (minor <= BigInt(0) || minor > BigInt(2_147_483_647)) throw new Error("Price is outside the supported range.");
  return Number(minor);
}

export function productPriceInputFromMinor(value: number): string {
  const minor = BigInt(value);
  return `${minor / BigInt(100)}.${(minor % BigInt(100)).toString().padStart(2, "0")}`;
}
