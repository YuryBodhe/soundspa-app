import { headers } from "next/headers";
import Link from "next/link";
import { operatorAuthStatus } from "../../../../lib/v2/adminOperator";
import RegistrationLinksManagement from "./RegistrationLinksManagement";

export const dynamic = "force-dynamic";
export default async function RegistrationLinksPage() {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) throw new Error("V2 operator authorization required.");
  const { listRegistrationLinks } = await import("../../../../db/v2/services/registrationLinks");
  const links = (await listRegistrationLinks()).map((link) => ({
    ...link,
    createdAt: link.createdAt.toISOString(), expiresAt: link.expiresAt?.toISOString() ?? null,
    disabledAt: link.disabledAt?.toISOString() ?? null,
    redemptions: link.redemptions.map((redemption) => ({ ...redemption, redeemedAt: redemption.redeemedAt.toISOString() })),
    events: link.events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  }));
  return <>
    <div className="admin-page-header"><div><p className="monitoring-eyebrow">SOUNDSPA V2 · COMMERCIAL</p><h1 className="admin-page-title">Registration Links</h1></div><div className="admin-page-nav"><Link href="/admin/ui" className="btn btn-sm">Admin</Link><Link href="/admin/ui/spaquatoria-promos" className="btn btn-sm">Spaquatoria Promo Codes</Link></div></div>
    <p className="text-dim">Divnitsa onboarding links are for new Organizations. Revoking a link prevents future redemptions; completed access is retained.</p>
    <RegistrationLinksManagement links={links} />
  </>;
}
