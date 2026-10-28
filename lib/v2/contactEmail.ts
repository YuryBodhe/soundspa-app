export class ContactEmailValidationError extends Error {
  constructor() {
    super("Enter a valid contact email address.");
    this.name = "ContactEmailValidationError";
  }
}

export function normalizeContactEmail(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ContactEmailValidationError();
  const email = value.trim();
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ContactEmailValidationError();
  return email;
}
