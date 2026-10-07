import { headers } from "next/headers";
import Link from "next/link";
import { operatorAuthStatus } from "../../../../lib/v2/adminOperator";
import OfferManagement from "./OfferManagement";

export const dynamic = "force-dynamic";

export default async function PartnerOffersPage() {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) {
    throw new Error("V2 operator authorization required.");
  }
  const { listPartnerInviteClaimLocations, listPartnerInvites, listPartnerOfferInviteClaims, listPartnerOffers } = await import("../../../../db/v2/services/partnerOfferAdmin");
  const data = await listPartnerOffers();
  const [offerInviteData, claimLocations] = await Promise.all([
    Promise.all(data.partners.flatMap(({ offers }) => offers.map(async (offer) => {
      const [invites, claims] = await Promise.all([listPartnerInvites(offer.id), listPartnerOfferInviteClaims(offer.id)]);
      return [offer.id, { invites, claims }] as const;
    }))),
    listPartnerInviteClaimLocations(),
  ]);
  const inviteDataByOffer = new Map(offerInviteData);
  const safeClaimLocations = claimLocations.map((location) => ({ ...location }));
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
      invites: (inviteDataByOffer.get(offer.id)?.invites ?? []).map((invite) => ({
        id: invite.id,
        createdAt: invite.createdAt.toISOString(),
        expiresAt: invite.expiresAt?.toISOString() ?? null,
        maxClaims: invite.maxClaims,
        claimCount: invite.claimCount,
        status: invite.status,
        claims: (inviteDataByOffer.get(offer.id)?.claims ?? []).filter((claim) => claim.inviteId === invite.id).map((claim) => ({
          locationId: claim.locationId,
          organizationName: claim.organizationName,
          locationName: claim.locationName,
          locationSlug: claim.locationSlug,
          claimedAt: claim.claimedAt.toISOString(),
        })),
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
      <div><p className="monitoring-eyebrow">SOUNDSPA V2 · COMMERCIAL</p><h1 className="admin-page-title">Offers &amp; Invites</h1></div>
      <div className="admin-page-nav"><Link href="/admin/ui" className="btn btn-sm">Admin</Link></div>
    </div>
    <p className="text-dim">Manage Partner Offers, Invites, and Invite claims.</p>
    <OfferManagement partners={partners} products={products} claimLocations={safeClaimLocations} />
  </>;
}
