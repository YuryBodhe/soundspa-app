"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ListedDevice = { id: string; label: string | null; status: string; createdAt: Date; activationState: "pending" | "activated" | "revoked" };
type Creation = { ok?: boolean; message?: string; device?: { id: string; label: string | null; status: string; createdAt: string }; activationUrl?: string; expiresAt?: string };

export default function DeviceProvisioningPanel({ locationId, devices }: { locationId: string; devices: ListedDevice[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activation, setActivation] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setActivation(null); setCopied(false);
    const deviceName = name.trim();
    if (!deviceName || deviceName.length > 120) { setError("Enter a Device name (up to 120 characters)."); return; }
    setPending(true);
    try {
      const response = await fetch("/api/v2/admin/devices", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ locationId, name: deviceName }) });
      const result = await response.json().catch(() => null) as Creation | null;
      if (!response.ok || !result?.activationUrl || !result.expiresAt) { setError(result?.message ?? "Device could not be created."); return; }
      setActivation({ url: result.activationUrl, expiresAt: result.expiresAt });
      setName("");
      router.refresh();
    } catch { setError("Connection failed. Check the Devices list before trying again."); }
    finally { setPending(false); }
  }

  async function copyLink() {
    if (!activation) return;
    try { await navigator.clipboard.writeText(activation.url); setCopied(true); }
    catch { setError("Copy was unavailable. Select and copy the one-time link manually."); }
  }

  return <div className="mt-4">
    <h3 className="admin-card-title">Devices</h3>
    <p className="text-dim">A new Player Device is tied to this Location. Activation links work once and expire after 24 hours.</p>
    <form className="admin-form" noValidate onSubmit={submit}>
      <div className="form-row"><label htmlFor={`device-name-${locationId}`}>Device name</label><input id={`device-name-${locationId}`} value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} placeholder="Front desk player" /></div>
      <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Creating…" : "+ Add Device"}</button></div>
    </form>
    {error && <p role="alert" className="text-dim">{error}</p>}
    {activation && <section className="admin-card mt-4" aria-live="polite">
      <h4>One-time activation link</h4>
      <p>This link is shown only now. Copy it to the Player device before it expires.</p>
      <p><code>{activation.url}</code></p>
      <p className="text-dim">Expires: {new Date(activation.expiresAt).toLocaleString()}</p>
      <button type="button" className="btn btn-sm" onClick={copyLink}>{copied ? "Copied" : "Copy link"}</button>
    </section>}
    <table className="admin-table mt-4"><thead><tr><th>Device</th><th>Status</th><th>Activation</th><th>Created</th></tr></thead><tbody>
      {devices.map((device) => <tr key={device.id}><td>{device.label || "Unnamed Device"}</td><td>{device.status === "active" && device.activationState !== "revoked" ? <span className="badge badge-ok">ACTIVE</span> : <span className="badge badge-neutral">REVOKED</span>}</td><td>{device.activationState === "pending" ? <span className="badge badge-warn">PENDING</span> : device.activationState === "activated" ? <span className="badge badge-ok">ACTIVATED</span> : <span className="badge badge-neutral">—</span>}</td><td>{new Date(device.createdAt).toLocaleDateString()}</td></tr>)}
      {!devices.length && <tr><td colSpan={4} className="text-dim">No Devices for this Location.</td></tr>}
    </tbody></table>
  </div>;
}
