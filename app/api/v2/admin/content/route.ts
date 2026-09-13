import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { operatorAuthResponse, operatorAuthStatus, isSameOriginMutation } from "../../../../../lib/v2/adminOperator";

export async function POST(request: Request) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return new Response("Same-origin request required.", { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return new Response("Metadata forms only; uploads are not available.", { status: 415 });
  // Stream with a hard cap: do not parse arbitrary upload bodies into memory.
  const reader = request.body?.getReader();
  if (!reader) return new Response("Empty form.", { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 16384) { await reader.cancel(); return new Response("Form too large.", { status: 413 }); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  const get = (name: string) => form.get(name) ?? "";
  const id = get("channelId");
  let message = "Saved.";
  try {
    const { mutateContentAdmin, ContentValidationError } = await import("../../../../../db/v2/services/contentAdmin");
    await mutateContentAdmin(async (service) => {
      switch (get("operation")) {
        case "create": case "edit": {
          const input = { displayName: get("displayName"), slug: get("slug"), kind: get("kind") as "music" | "ambient", description: get("description"), imageKey: get("imageKey"), sortOrder: Number(get("sortOrder")) };
          if (get("operation") === "create") await service.create(input); else await service.edit(id, input); break;
        }
        case "publish": await service.publication(id, true); break;
        case "unpublish": await service.publication(id, false); break;
        case "archive": await service.archive(id); break;
        case "track": {
          if (!["true", "false"].includes(get("enabled"))) throw new ContentValidationError("Invalid track enabled value.");
          await service.track(id, get("trackId"), get("enabled") === "true", Number(get("sortOrder"))); break;
        }
        default: throw new ContentValidationError("Unknown operation.");
      }
    });
    revalidatePath("/app/admin/channels/v2");
  } catch (error) {
    if (error instanceof ZodError) message = "Invalid metadata. Check required fields, slug, image key and non-negative order.";
    else if (error instanceof Error && error.name === "ContentValidationError") message = error.message;
    else if ((error as { cause?: { code?: string }; code?: string })?.cause?.code === "23505" || (error as { code?: string })?.code === "23505") message = "That slug already exists.";
    else { console.error("V2 Content mutation failed"); message = "Content could not be saved. No internal details are exposed."; }
  }
  const destination = new URL("/app/admin/channels/v2", request.url);
  destination.searchParams.set("message", message);
  // Relative Location preserves the public ingress origin behind nginx.
  return new NextResponse(null, { status: 303, headers: { Location: destination.pathname + destination.search, "Cache-Control": "no-store" } });
}
