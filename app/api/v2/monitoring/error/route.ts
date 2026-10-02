import { cookies } from "next/headers";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";

const COOKIE = "soundspa_v2_device";
const NO_STORE = { "Cache-Control": "no-store" };
const bodySchema = z.object({ lane: z.enum(["music", "ambient"]) }).strict();
const MAX_BODY_BYTES = 512;
export const dynamic = "force-dynamic";

async function readBoundedBody(request: Request): Promise<{ text: string } | { tooLarge: true } | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body) };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Same-origin request required." }, { status: 403, headers: NO_STORE });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Invalid error report." }, { status: 400, headers: NO_STORE });
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) return Response.json({ error: "Invalid error report." }, { status: 400, headers: NO_STORE });
    if (contentLength > MAX_BODY_BYTES) return Response.json({ error: "Invalid error report." }, { status: 413, headers: NO_STORE });
  }

  const credential = (await cookies()).get(COOKIE)?.value;
  if (!credential) return Response.json({ error: "Device authentication required." }, { status: 401, headers: NO_STORE });
  const [{ authenticateDeviceCredential }, { recordDevicePlaybackFailure }] = await Promise.all([
    import("@/db/v2/queries/devices"),
    import("@/db/v2/services/monitoringObservability"),
  ]);
  const device = await authenticateDeviceCredential(credential);
  if (!device) return Response.json({ error: "Device authentication failed." }, { status: 401, headers: NO_STORE });

  let body: z.infer<typeof bodySchema>;
  try {
    const bounded = await readBoundedBody(request);
    if (bounded && "tooLarge" in bounded) return Response.json({ error: "Invalid error report." }, { status: 413, headers: NO_STORE });
    if (!bounded) return Response.json({ error: "Invalid error report." }, { status: 400, headers: NO_STORE });
    body = bodySchema.parse(JSON.parse(bounded.text));
  } catch {
    return Response.json({ error: "Invalid error report." }, { status: 400, headers: NO_STORE });
  }

  await recordDevicePlaybackFailure(device.deviceId, body.lane).catch(() => undefined);
  return Response.json({ ok: true }, { headers: NO_STORE });
}
