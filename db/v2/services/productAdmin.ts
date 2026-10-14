import { asc, eq, inArray } from "drizzle-orm";
import { v2Db } from "../client";
import { channels, commercialProductChannels, commercialProducts, commercialProductVisibilityEvents } from "../schema";
import {
  ProductAdminError,
  validateCreateProductInput,
  validateUpdateProductInput,
} from "./productAdminValidation";
export { ProductAdminError, type ProductAdminErrorCode, type ProductKind } from "./productAdminValidation";

type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type TransactionRunner = <T>(operation: (tx: V2Transaction) => Promise<T>) => Promise<T>;
const defaultTransaction: TransactionRunner = (operation) => v2Db.transaction(operation);

function postgresCode(error: unknown): string | undefined {
  const seen = new Set<object>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

async function assertChannelsExist(tx: V2Transaction, channelIds: string[]) {
  if (!channelIds.length) return;
  const rows = await tx.select({ id: channels.id }).from(channels).where(inArray(channels.id, channelIds));
  if (rows.length !== channelIds.length) throw new ProductAdminError("CHANNEL_NOT_FOUND");
}

export async function listProductManagementData() {
  const [productRows, channelRows, compositionRows, visibilityRows] = await Promise.all([
    v2Db.select({ id: commercialProducts.id, code: commercialProducts.code, name: commercialProducts.name, kind: commercialProducts.kind, priceMinor: commercialProducts.priceMinor, currency: commercialProducts.currency, billingIntervalMonths: commercialProducts.billingIntervalMonths, isActive: commercialProducts.isActive, visibility: commercialProducts.visibility })
      .from(commercialProducts).orderBy(asc(commercialProducts.name), asc(commercialProducts.code), asc(commercialProducts.id)),
    v2Db.select({ id: channels.id, name: channels.displayName, kind: channels.kind, isPublished: channels.isPublished, archivedAt: channels.archivedAt })
      .from(channels).orderBy(asc(channels.kind), asc(channels.sortOrder), asc(channels.displayName), asc(channels.id)),
    v2Db.select({ productId: commercialProductChannels.productId, channelId: channels.id, channelName: channels.displayName, channelKind: channels.kind })
      .from(commercialProductChannels).innerJoin(channels, eq(channels.id, commercialProductChannels.channelId)),
    v2Db.select({ productId: commercialProductVisibilityEvents.productId, previousVisibility: commercialProductVisibilityEvents.previousVisibility,
      newVisibility: commercialProductVisibilityEvents.newVisibility, operator: commercialProductVisibilityEvents.operator,
      reason: commercialProductVisibilityEvents.reason, changedAt: commercialProductVisibilityEvents.changedAt })
      .from(commercialProductVisibilityEvents).orderBy(asc(commercialProductVisibilityEvents.changedAt)),
  ]);

  const channelsByProduct = new Map<string, typeof compositionRows>();
  for (const row of compositionRows) channelsByProduct.set(row.productId, [...(channelsByProduct.get(row.productId) ?? []), row]);
  const visibilityHistoryByProduct = new Map<string, typeof visibilityRows>();
  for (const row of visibilityRows) visibilityHistoryByProduct.set(row.productId, [...(visibilityHistoryByProduct.get(row.productId) ?? []), row]);
  return {
    products: productRows.map((product) => ({
      ...product,
      channelIds: (channelsByProduct.get(product.id) ?? []).map((channel) => channel.channelId),
      channels: (channelsByProduct.get(product.id) ?? []).map(({ channelId, channelName, channelKind }) => ({ id: channelId, name: channelName, kind: channelKind })),
      visibilityHistory: visibilityHistoryByProduct.get(product.id) ?? [],
    })),
    channels: channelRows.map(({ archivedAt, ...channel }) => ({ ...channel, isArchived: archivedAt !== null })),
  };
}

export async function createProduct(
  input: { name: unknown; code: unknown; kind?: unknown; isActive: unknown; channelIds: unknown; priceMinor: unknown; currency: unknown; billingIntervalMonths: unknown },
  runInTransaction: TransactionRunner = defaultTransaction,
) {
  const values = validateCreateProductInput(input);
  return runInTransaction(async (tx) => {
    await assertChannelsExist(tx, values.channelIds);
    try {
      const [product] = await tx.insert(commercialProducts).values({
        code: values.code,
        name: values.name,
        kind: values.kind,
        priceMinor: values.priceMinor,
        currency: values.currency,
        billingIntervalMonths: values.billingIntervalMonths,
        isActive: values.isActive,
      }).returning({ id: commercialProducts.id, code: commercialProducts.code, name: commercialProducts.name, kind: commercialProducts.kind, priceMinor: commercialProducts.priceMinor, currency: commercialProducts.currency, billingIntervalMonths: commercialProducts.billingIntervalMonths, isActive: commercialProducts.isActive });
      if (values.channelIds.length) {
        await tx.insert(commercialProductChannels).values(values.channelIds.map((channelId) => ({ productId: product.id, channelId })));
      }
      return product;
    } catch (error) {
      if (postgresCode(error) === "23505") throw new ProductAdminError("PRODUCT_CODE_EXISTS");
      throw error;
    }
  });
}

export async function updateProduct(
  productId: string,
  input: { name: unknown; isActive: unknown; channelIds: unknown; priceMinor?: unknown; currency?: unknown; billingIntervalMonths?: unknown },
  runInTransaction: TransactionRunner = defaultTransaction,
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
    throw new ProductAdminError("INVALID_INPUT");
  }
  const values = validateUpdateProductInput(input);
  return runInTransaction(async (tx) => {
    const [existing] = await tx.select({ id: commercialProducts.id, priceMinor: commercialProducts.priceMinor,
      currency: commercialProducts.currency, billingIntervalMonths: commercialProducts.billingIntervalMonths }).from(commercialProducts)
      .where(eq(commercialProducts.id, productId)).for("update");
    if (!existing) throw new ProductAdminError("PRODUCT_NOT_FOUND");
    if (values.price === null && (existing.priceMinor !== null || existing.currency !== null || existing.billingIntervalMonths !== null)) {
      throw new ProductAdminError("INVALID_INPUT");
    }
    await assertChannelsExist(tx, values.channelIds);

    const [product] = await tx.update(commercialProducts).set({
      name: values.name,
      isActive: values.isActive,
      ...(values.price === undefined ? {} : {
        priceMinor: values.price?.priceMinor ?? null,
        currency: values.price?.currency ?? null,
        billingIntervalMonths: values.price?.billingIntervalMonths ?? null,
      }),
      updatedAt: new Date(),
    }).where(eq(commercialProducts.id, productId))
      .returning({ id: commercialProducts.id, code: commercialProducts.code, name: commercialProducts.name, kind: commercialProducts.kind, priceMinor: commercialProducts.priceMinor, currency: commercialProducts.currency, billingIntervalMonths: commercialProducts.billingIntervalMonths, isActive: commercialProducts.isActive });

    await tx.delete(commercialProductChannels).where(eq(commercialProductChannels.productId, productId));
    if (values.channelIds.length) {
      await tx.insert(commercialProductChannels).values(values.channelIds.map((channelId) => ({ productId, channelId })));
    }
    return product;
  });
}
