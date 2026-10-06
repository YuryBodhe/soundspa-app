import { headers } from "next/headers";
import Link from "next/link";
import { operatorAuthStatus } from "../../../../lib/v2/adminOperator";
import OfferManagement from "./OfferManagement";

export const dynamic = "force-dynamic";

export default async function PartnerOffersPage() {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) {
    throw new Error("V2 operator authorization required.");
  }
  const { listPartnerInvites, listPartnerOffers } = await import("../../../../db/v2/services/partnerOfferAdmin");
  const data = await listPartnerOffers();
  const inviteLists = await Promise.all(data.partners.flatMap(({ offers }) => offers.map(async (offer) => [offer.id, await listPartnerInvites(offer.id)] as const)));
  const invitesByOffer = new Map(inviteLists);
  const partners = data.partners.map(({ partner, offers }) => ({
    id: partner.id,
    name: partner.name,
    code: partner.code,
    isActive: partner.isActive,
    offers: offers.map((offer) => ({
      id: offer.id,
      code: offer.code,
      name: offer.name,
      isActive: offer.isActive,
      inviteCount: offer.inviteCount,
      grantsLocked: offer.grantsLocked,
      invites: (invitesByOffer.get(offer.id) ?? []).map((invite) => ({
        id: invite.id,
        createdAt: invite.createdAt.toISOString(),
        expiresAt: invite.expiresAt?.toISOString() ?? null,
        maxClaims: invite.maxClaims,
        claimCount: invite.claimCount,
        status: invite.status,
      })),
      grants: offer.grants.map(({ grant, product }) => ({
        id: grant.id,
        productId: product.id,
        productName: product.name,
        productKind: product.kind,
        productActive: product.isActive,
        grantType: grant.grantType,
        durationDays: grant.durationDays,
      })),
    })),
  }));
  const products = data.products.map(({ id, code, name, kind, isActive }) => ({ id, code, name, kind, isActive }));

  return <>
    <div className="admin-page-header">
      <div><p className="monitoring-eyebrow">SOUNDSPA V2 · COMMERCIAL</p><h1 className="admin-page-title">Offers &amp; Grants</h1></div>
      <div className="admin-page-nav"><Link href="/admin/ui" className="btn btn-sm">Admin</Link></div>
    </div>
    <p className="text-dim">Manage Partner Offers and the Product grants they define. Invite creation and claims are managed separately.</p>
    <OfferManagement partners={partners} products={products} />
  </>;
}
