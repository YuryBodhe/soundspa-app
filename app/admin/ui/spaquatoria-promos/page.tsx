import { headers } from "next/headers";
import Link from "next/link";
import { operatorAuthStatus } from "../../../../lib/v2/adminOperator";
import PromoCodeManagement from "./PromoCodeManagement";

export const dynamic = "force-dynamic";
export default async function SpaquatoriaPromoCodesPage() {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) throw new Error("V2 operator authorization required.");
  const { listSpaquatoriaPromoCodes } = await import("../../../../db/v2/services/spaquatoriaPromoCodes");
  const promoCodes = (await listSpaquatoriaPromoCodes()).map((promo) => ({
    ...promo,
    createdAt: promo.createdAt.toISOString(), expiresAt: promo.expiresAt?.toISOString() ?? null,
    revokedAt: promo.revokedAt?.toISOString() ?? null,
    redemptions: promo.redemptions.map((redemption) => ({ ...redemption, redeemedAt: redemption.redeemedAt.toISOString() })),
    events: promo.events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  }));
  return <>
    <div className="admin-page-header"><div><p className="monitoring-eyebrow">SOUNDSPA V2 · COMMERCIAL</p><h1 className="admin-page-title">Spaquatoria Promo Codes</h1></div><div className="admin-page-nav"><Link href="/admin/ui" className="btn btn-sm">Admin</Link><Link href="/admin/ui/offers" className="btn btn-sm">Offers &amp; Invites</Link></div></div>
    <p className="text-dim">SoundSpa operators issue shared codes for finite Spaquatoria access. Revoking a code blocks future redemptions and leaves existing access unchanged.</p>
    <PromoCodeManagement promoCodes={promoCodes} />
  </>;
}
