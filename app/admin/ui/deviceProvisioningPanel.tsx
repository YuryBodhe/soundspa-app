"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ListedDevice = { id: string; label: string | null; status: string; createdAt: Date; activationState: "pending" | "activated" | "revoked" };
type MutationResponse = { ok?: boolean; message?: string; device?: { id: string; label: string | null; status: string; createdAt: string }; activationUrl?: string; expiresAt?: string };

export default function DeviceProvisioningPanel({ locationId, devices }: { locationId: string; devices: ListedDevice[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activation, setActivation] = useState<{ url: string; expiresAt: string; deviceLabel: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setNotice(null); setActivation(null); setCopied(false);
    const deviceName = name.trim();
    if (!deviceName || deviceName.length > 120) { setError("Enter a Device name (up to 120 characters)."); return; }
    setPending(true);
    try {
      const response = await fetch("/api/v2/admin/devices", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ locationId, name: deviceName }) });
      const result = await response.json().catch(() => null) as MutationResponse | null;
      if (!response.ok || !result?.activationUrl || !result.expiresAt) { setError(result?.message ?? "Device could not be created."); return; }
      setActivation({ url: result.activationUrl, expiresAt: result.expiresAt, deviceLabel: deviceName });
      setName("");
      router.refresh();
    } catch { setError("Connection failed. Check the Devices list before trying again."); }
    finally { setPending(false); }
  }

  async function reissue(device: ListedDevice) {
    const deviceLabel = device.label || "Unnamed Device";
    if (!window.confirm(`Issue a new activation link for "${deviceLabel}"? Any previous unused activation link will stop working.`)) return;
    setError(null); setNotice(null); setActivation(null); setCopied(false); setActionPending(device.id);
    try {
      const response = await fetch(`/api/v2/admin/devices/${encodeURIComponent(device.id)}/activation`, { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
      const result = await response.json().catch(() => null) as MutationResponse | null;
      if (!response.ok || !result?.activationUrl || !result.expiresAt) { setError(result?.message ?? "A new activation link could not be issued."); return; }
      setActivation({ url: result.activationUrl, expiresAt: result.expiresAt, deviceLabel });
      setNotice(`A new one-time activation link was issued for ${deviceLabel}.`);
      router.refresh();
    } catch { setError("Connection failed. Check the Device state before retrying."); }
    finally { setActionPending(null); }
  }

  async function resetAccess(device: ListedDevice) {
    const deviceLabel = device.label || "Unnamed Device";
    if (!window.confirm(`Reset access for "${deviceLabel}" and create a new activation link?\n\nThis will sign the Device out of its current browser and create a new one-time activation link. Monitoring and analytics history will be preserved.`)) return;
    setError(null); setNotice(null); setActivation(null); setCopied(false); setActionPending(device.id);
    try {
      const response = await fetch(`/api/v2/admin/devices/${encodeURIComponent(device.id)}/reset-access`, { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
      const result = await response.json().catch(() => null) as MutationResponse | null;
      if (!response.ok || !result?.activationUrl || !result.expiresAt) { setError(result?.message ?? "Device access could not be reset."); return; }
      setActivation({ url: result.activationUrl, expiresAt: result.expiresAt, deviceLabel });
      setNotice(`Access was reset for ${deviceLabel}. A new one-time activation link is ready.`);
      router.refresh();
    } catch { setError("Connection failed. Check the Device state before retrying."); }
    finally { setActionPending(null); }
  }

  async function remove(device: ListedDevice) {
    const deviceLabel = device.label || "Unnamed Device";
    if (!window.confirm(`Delete device "${deviceLabel}"?\n\nThis will remove this Player Device and its activation/monitoring data. This action cannot be undone.`)) return;
    setError(null); setNotice(null); setActivation(null); setActionPending(device.id);
    try {
      const response = await fetch(`/api/v2/admin/devices/${encodeURIComponent(device.id)}`, { method: "DELETE", credentials: "same-origin", headers: { Accept: "application/json" } });
      const result = await response.json().catch(() => null) as MutationResponse | null;
      if (!response.ok || !result?.ok) { setError(result?.message ?? "Device could not be deleted."); return; }
      setNotice(`Device ${deviceLabel} was deleted.`);
      router.refresh();
    } catch { setError("Connection failed. Check the Devices list before retrying."); }
    finally { setActionPending(null); }
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
    {notice && <p role="status" className="text-dim">{notice}</p>}
    {activation && <section className="admin-card mt-4" aria-live="polite">
      <h4>One-time activation link · {activation.deviceLabel}</h4>
      <p>This link is shown only now. Copy it to the Player device before it expires.</p>
      <p><code>{activation.url}</code></p>
      <p className="text-dim">Expires: {new Date(activation.expiresAt).toLocaleString()}</p>
      <button type="button" className="btn btn-sm" onClick={copyLink}>{copied ? "Copied" : "Copy link"}</button>
    </section>}
    <table className="admin-table mt-4"><thead><tr><th>Device</th><th>Device state</th><th>Activation</th><th>Created</th><th>Actions</th></tr></thead><tbody>
      {devices.map((device) => <tr key={device.id}><td>{device.label || "Unnamed Device"}</td><td>{device.status === "active" && device.activationState !== "revoked" ? <span className="badge badge-ok">ACTIVE</span> : <span className="badge badge-neutral">REVOKED</span>}</td><td>{device.activationState === "pending" ? <span className="badge badge-warn">PENDING</span> : device.activationState === "activated" ? <span className="badge badge-ok">ACTIVATED</span> : <span className="badge badge-neutral">—</span>}</td><td>{new Date(device.createdAt).toLocaleDateString()}</td><td><div className="form-actions">{device.activationState === "pending" && <button type="button" className="btn btn-sm" disabled={pending || actionPending !== null} onClick={() => void reissue(device)}>{actionPending === device.id ? "Working…" : "Reissue activation link"}</button>}{device.activationState === "activated" && <button type="button" className="btn btn-sm" disabled={pending || actionPending !== null} onClick={() => void resetAccess(device)}>{actionPending === device.id ? "Working…" : "Reset access & new link"}</button>}<button type="button" className="btn btn-sm" disabled={pending || actionPending !== null} onClick={() => void remove(device)}>{actionPending === device.id ? "Working…" : "Delete Device"}</button></div></td></tr>)}
      {!devices.length && <tr><td colSpan={5} className="text-dim">No Devices for this Location.</td></tr>}
    </tbody></table>
  </div>;
}
