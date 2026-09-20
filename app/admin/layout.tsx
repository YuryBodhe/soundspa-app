import "../app/admin/admin.css";
export const dynamic = "force-dynamic";
export default function AdminLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body><main className="admin-root"><header className="admin-header"><strong>SoundSpa Admin</strong><span className="text-dim">Internal operator console</span></header>{children}</main></body></html>; }
