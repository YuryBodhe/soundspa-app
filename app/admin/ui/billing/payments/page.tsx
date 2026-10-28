import { headers } from "next/headers";
import Link from "next/link";
import { operatorAuthStatus } from "../../../../../lib/v2/adminOperator";
import { listManualBillingAdminData } from "../../../../../db/v2/services/manualBillingAdmin";
import PaymentsManagement from "./PaymentsManagement";

export const dynamic = "force-dynamic";
export default async function PaymentsPage() {
  const authorization = (await headers()).get("authorization");
  if (operatorAuthStatus(authorization) !== 200) throw new Error("V2 operator authorization required.");
  const data = await listManualBillingAdminData(authorization);
  return <>
    <div className="admin-page-header"><div><p className="monitoring-eyebrow">SOUNDSPA V2 · BILLING</p><h1 className="admin-page-title">Payments</h1></div><div className="admin-page-nav"><Link href="/admin/ui" className="btn btn-sm">Admin</Link><Link href="/admin/ui/billing/subscriptions" className="btn btn-sm">Subscriptions</Link></div></div>
    <p className="text-dim">Create organization invoices for manual bank transfer and record full payments after matching the bank statement. Creating an invoice does not change access.</p>
    <PaymentsManagement organizations={data.organizations} orders={data.orders} />
  </>;
}
