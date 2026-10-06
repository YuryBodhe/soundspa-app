"use client";

import { FormEvent, ReactNode, useState } from "react";
import { useRouter } from "next/navigation";

export default function AccessMutationForm({ operation, channelId, locationId, productCode, children }: { operation: string; channelId: string; locationId?: string; productCode?: string; children: ReactNode }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setPending(true);
    try {
      const response = await fetch("/api/v2/admin/access", { method: "POST", body: new FormData(event.currentTarget), credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) { setError((await response.text()) || "Mutation failed."); return; }
      router.refresh();
    } catch { setError("Connection failed. Please retry."); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit}><input type="hidden" name="operation" value={operation} /><input type="hidden" name="channelId" value={channelId} />{locationId && <input type="hidden" name="locationId" value={locationId} />}{productCode && <input type="hidden" name="productCode" value={productCode} />}{children}{pending && <span role="status">Saving…</span>}{error && <span role="alert">{error}</span>}</form>;
}
