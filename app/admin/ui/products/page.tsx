import { headers } from "next/headers";
import Link from "next/link";
import { operatorAuthStatus } from "../../../../lib/v2/adminOperator";
import ProductManagement from "./ProductManagement";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) {
    throw new Error("V2 operator authorization required.");
  }
  const { listProductManagementData } = await import("../../../../db/v2/services/productAdmin");
  const data = await listProductManagementData();
  return <>
    <div className="admin-page-header product-page-header">
      <div><p className="monitoring-eyebrow">SOUNDSPA V2 · COMMERCIAL</p><h1 className="admin-page-title">Products</h1></div>
      <div className="admin-page-nav product-page-nav"><Link href="/admin/ui" className="btn btn-sm">Admin</Link><Link href="/admin/ui/offers" className="btn btn-sm">Offers &amp; Invites</Link></div>
    </div>
    <p className="text-dim">Products define which Channels are included in a customer access package.</p>
    <ProductManagement products={data.products} channels={data.channels} />
  </>;
}
