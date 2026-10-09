import { isIP } from "node:net";

type Args = {
  organizationId?: string;
  locationId?: string;
  productIds: string[];
  allProducts: boolean;
  trialProductId?: string;
  trialDurationDays: number;
  reason?: string;
  apply: boolean;
  confirmationPhrase?: string;
  planHash?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { productIds: [], allProducts: false, trialDurationDays: 30, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const result = argv[index + 1];
      if (!result || result.startsWith("--")) throw new Error("invalid_arguments");
      index += 1;
      return result;
    };
    if (arg === "--organization-id") args.organizationId = value();
    else if (arg === "--location-id") args.locationId = value();
    else if (arg === "--product-id") args.productIds.push(value());
    else if (arg === "--all-products") args.allProducts = true;
    else if (arg === "--trial-product-id") args.trialProductId = value();
    else if (arg === "--trial-days") args.trialDurationDays = Number(value());
    else if (arg === "--reason") args.reason = value();
    else if (arg === "--confirm") args.confirmationPhrase = value();
    else if (arg === "--plan-hash") args.planHash = value();
    else if (arg === "--apply") args.apply = true;
    else throw new Error("invalid_arguments");
  }
  if (!args.organizationId || !args.locationId || !args.trialProductId || (!args.allProducts && !args.productIds.length) ||
      (args.allProducts && args.productIds.length > 0) || !args.reason) {
    throw new Error("missing_required_arguments");
  }
  if (args.apply && (!args.confirmationPhrase || !args.planHash)) throw new Error("apply_requires_confirmation_and_plan_hash");
  if (!args.apply && (args.confirmationPhrase || args.planHash)) throw new Error("confirmation_flags_require_apply");
  return args;
}

async function verifyDatabaseIdentity(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  if (parsed.hostname !== "v2-postgres" || (parsed.port && parsed.port !== "5432") || parsed.pathname !== "/soundspa_v2" ||
      decodeURIComponent(parsed.username) !== "soundspa_v2") throw new Error("database_identity_mismatch");
  const { v2Pool } = await import("../../db/v2/client");
  const identity = await v2Pool.query<{ database: string; role: string; address: string | null; port: number }>(
    "SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port",
  );
  const row = identity.rows[0];
  const address = row?.address?.split("/")[0] ?? "";
  const octets = address.split(".").map(Number);
  const privateAddress = isIP(address) === 4 && octets.length === 4 && (
    octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
  if (!row || row.database !== "soundspa_v2" || row.role !== "soundspa_v2" || row.port !== 5432 || !privateAddress) {
    throw new Error("database_identity_mismatch");
  }
  return v2Pool;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.env.V2_DEPLOYMENT_ENV !== "staging" ||
      process.env.V2_PUBLIC_ORIGIN !== "https://test.soundspa.bodhemusic.com" || !process.env.V2_DATABASE_URL ||
      !process.env.V2_ADMIN_USERNAME || !process.env.V2_ADMIN_PASSWORD) throw new Error("staging_operator_configuration_required");
  const pool = await verifyDatabaseIdentity(process.env.V2_DATABASE_URL);
  const authorization = `Basic ${Buffer.from(`${process.env.V2_ADMIN_USERNAME}:${process.env.V2_ADMIN_PASSWORD}`).toString("base64")}`;
  try {
    let productIds = args.productIds;
    if (args.allProducts) {
      const [{ v2Db }, schema] = await Promise.all([import("../../db/v2/client"), import("../../db/v2/schema")]);
      productIds = (await v2Db.select({ id: schema.commercialProducts.id }).from(schema.commercialProducts).orderBy(schema.commercialProducts.id)).map((product) => product.id);
    }
    const service = await import("../../db/v2/services/billingReset");
    const input = {
      organizationId: args.organizationId!, locationId: args.locationId!, productIds,
      trialProductId: args.trialProductId!, trialDurationDays: args.trialDurationDays,
      reason: args.reason!, operatorAuthorization: authorization, includeAllProducts: args.allProducts,
    };
    if (args.apply) {
      const result = await service.applyStagingBillingReset({
        ...input, confirmationPhrase: args.confirmationPhrase!, expectedPlanHash: args.planHash!,
      });
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(JSON.stringify(await service.previewStagingBillingReset(input), null, 2));
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const candidate = error as { code?: unknown; message?: unknown };
  const raw = typeof candidate?.code === "string" ? candidate.code : typeof candidate?.message === "string" ? candidate.message : "billing_reset_failed";
  const code = /^[a-z0-9_-]{1,80}$/.test(raw) ? raw : "billing_reset_failed";
  console.error(JSON.stringify({ ok: false, error: code }));
  process.exitCode = 1;
});
