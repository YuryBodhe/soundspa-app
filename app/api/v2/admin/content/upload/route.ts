import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorAuthResponse, operatorAuthStatus, isSameOriginMutation } from "../../../../../../lib/v2/adminOperator";
import { receiveUpload, UploadError } from "../../../../../../lib/v2/mediaStorage";

export const runtime = "nodejs";
let activeUploads = 0;
export async function POST(request: Request) {
  const auth = operatorAuthStatus(request.headers.get("authorization"));
  if (auth !== 200) return operatorAuthResponse(auth);
  if (!isSameOriginMutation(request)) return new Response("Same-origin request required.",{status:403});
  if (request.headers.get("content-encoding") && request.headers.get("content-encoding") !== "identity") return new Response("Encoded upload bodies are not accepted.",{status:415});
  if (!request.headers.get("content-type")?.startsWith("application/octet-stream")) return new Response("One raw binary file per request is required.",{status:415});
  const parameters = new URL(request.url).searchParams;
  const channelId = parameters.get("channelId") ?? ""; const kind = parameters.get("kind");
  if (!z.string().uuid().safeParse(channelId).success || (kind !== "track" && kind !== "artwork")) return new Response("Invalid upload target.",{status:400});
  let filename: string;
  try { filename = decodeURIComponent(request.headers.get("x-upload-filename") ?? ""); } catch { return new Response("Invalid filename.",{status:400}); }
  if (!filename || filename.length > 200 || /[\/\\\x00-\x1f\x7f]/.test(filename)) return new Response("Invalid original filename.",{status:400});
  if (activeUploads >= 2) return new Response("Uploads busy. Retry after the active uploads finish.",{status:429,headers:{"Retry-After":"10"}});
  activeUploads++; let upload: Awaited<ReturnType<typeof receiveUpload>> | undefined;
  try {
    // Reject a nonexistent/archived target before reading a potentially large body.
    const {getAdminChannel} = await import("../../../../../../db/v2/queries/contentAdmin");
    const channel = await getAdminChannel(channelId);
    if (!channel || channel.archivedAt) throw new UploadError("Channel is missing or archived.",409);
    upload = await receiveUpload(request,kind);
    if (request.signal.aborted) throw new UploadError("Upload interrupted.",408);
    const {attachContentUpload} = await import("../../../../../../db/v2/services/contentUpload");
    const result = await attachContentUpload(channelId,kind,upload,filename);
    // A UI invalidation failure must not misreport a committed upload as failed.
    try { revalidatePath("/app/admin/channels/v2"); } catch { console.error("[V2Upload] admin-refresh-required"); }
    return Response.json({ok:true,...result},{status:201,headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    if (error instanceof UploadError) return Response.json({error:error.message},{status:error.status});
    if (request.signal.aborted || (error instanceof Error && ["AbortError","TimeoutError"].includes(error.name))) return Response.json({error:"Upload interrupted or timed out."},{status:408});
    console.error("[V2Upload] request-failed"); return Response.json({error:"Upload failed. No internal details are exposed."},{status:500});
  } finally {
    await upload?.cleanup().catch(()=>console.error("[V2Upload] temporary-cleanup-required")); activeUploads--;
  }
}
