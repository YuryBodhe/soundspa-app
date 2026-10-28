import { headers } from "next/headers";
import Link from "next/link";
import { operatorAuthStatus } from "../../../../../lib/v2/adminOperator";
import { listManualSubscriptionOverview } from "../../../../../db/v2/services/manualBillingAdmin";

export const dynamic = "force-dynamic";
export default async function BillingSubscriptionsPage() {
  const authorization = (await headers()).get("authorization");
  if (operatorAuthStatus(authorization) !== 200) throw new Error("V2 operator authorization required.");
  const subscriptions = await listManualSubscriptionOverview(authorization);
  return <>
    <div className="admin-page-header"><div><p className="monitoring-eyebrow">SOUNDSPA V2 · BILLING</p><h1 className="admin-page-title">Subscriptions</h1></div><div className="admin-page-nav"><Link href="/admin/ui" className="btn btn-sm">Admin</Link><Link href="/admin/ui/billing/payments" className="btn btn-sm">Payments</Link></div></div>
    <p className="text-dim">Read-only view of current and upcoming Location + Product subscription periods. These subscriptions remain the source of truth for access.</p>
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Organization</th><th>Salon</th><th>Product</th><th>Period starts</th><th>Paid through</th><th>Status</th></tr></thead><tbody>
      {subscriptions.map((subscription) => <tr key={subscription.id}><td>{subscription.organizationName}</td><td>{subscription.locationName}</td><td>{subscription.productName}</td><td>{new Date(subscription.startsAt).toLocaleDateString()}</td><td>{subscription.paidThroughAt ? new Date(subscription.paidThroughAt).toLocaleDateString() : "No end date"}</td><td>{subscription.status}</td></tr>)}
      {!subscriptions.length && <tr><td colSpan={6} className="text-dim">No active or upcoming subscription periods.</td></tr>}
    </tbody></table></div>
  </>;
}
