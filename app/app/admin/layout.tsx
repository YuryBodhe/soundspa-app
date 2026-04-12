import "./admin.css";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <main className="admin-root">
          <header className="admin-header">
            <Link href="/app/admin" className="admin-home-link">← Admin Home</Link>
          </header>
          {children}
        </main>
      </body>
    </html>
  );
}