import { createHash, createHmac } from "node:crypto";

const OPERATION_DOMAIN = "soundspa-v2/current-browser-operation/v1\0";
const CREDENTIAL_DOMAIN = "soundspa-v2/current-browser-device-credential/v1\0";

export class CurrentBrowserDeviceSecretError extends Error {
  constructor() {
    super("Current-browser Device activation is unavailable.");
    this.name = "CurrentBrowserDeviceSecretError";
  }
}

/** Deliberately uses a dedicated secret; session/auth secrets are not fallback keys. */
export function currentBrowserDeviceSecret(value = process.env.V2_DEVICE_ACTIVATION_SECRET): Buffer {
  if (!value || Buffer.byteLength(value, "utf8") < 32 || /REPLACE_|PLACEHOLDER|CHANGE_ME/i.test(value)) {
    throw new CurrentBrowserDeviceSecretError();
  }
  return Buffer.from(value, "utf8");
}

export function currentBrowserOperationHash(operationId: string): string {
  return createHash("sha256").update(OPERATION_DOMAIN, "utf8").update(operationId.toLowerCase(), "utf8").digest("hex");
}

/** Deterministic only within an operation and its authenticated activation context. */
export function deriveCurrentBrowserDeviceCredential(input: {
  secret: Buffer;
  operationId: string;
  authenticatedUserId: string;
  locationId: string;
  deviceId: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(CREDENTIAL_DOMAIN, "utf8")
    .update(input.authenticatedUserId.toLowerCase(), "utf8").update("\0")
    .update(input.locationId.toLowerCase(), "utf8").update("\0")
    .update(input.deviceId.toLowerCase(), "utf8").update("\0")
    .update(currentBrowserOperationHash(input.operationId), "utf8")
    .digest("base64url");
}
