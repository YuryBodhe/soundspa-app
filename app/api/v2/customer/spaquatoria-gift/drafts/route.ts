import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { authResponseHeaders } from "@/lib/v2/customerAuthCore";
import { SpaquatoriaGiftDraftError } from "@/db/v2/services/spaquatoriaGiftDrafts";

export const dynamic = "force-dynamic";
const headers = authResponseHeaders();
const createSchema = z.object({ organizationId: z.string().uuid(), locationId: z.string().uuid() }).strict();
type Session = { user: { id: string; emailVerifiedAt: Date | string | null } };
type Dependencies = {
  sameOrigin: (request: Request) => boolean;
  getSession: (request: Request) => Promise<Session | null>;
  list: (userId: string) => Promise<unknown>;
  createOrResume: (input: { authenticatedUserId: string; organizationId: string; locationId: string }) => Promise<unknown>;
};

function failure(code: string, status: number) { return NextResponse.json({ error: code }, { status, headers }); }
function serviceFailure(error: unknown) {
  if (error instanceof z.ZodError) return failure("invalid", 400);
  if (error instanceof SpaquatoriaGiftDraftError) {
    if (error.code === "invalid_input") return failure("invalid", 400);
    if (error.code === "not_authorized" || error.code === "location_unavailable" || error.code === "draft_unavailable") return failure("draft_unavailable", 404);
  }
  console.error("[V2 Spaquatoria Gift draft] Request failed.");
  return failure("unavailable", 503);
}

export function createGiftDraftCollectionHandlers(dependencies: Dependencies) {
  return {
    async GET(request: Request) {
      const session = await dependencies.getSession(request);
      if (!session?.user.emailVerifiedAt) return failure("unauthenticated_or_unverified", 401);
      try { return NextResponse.json({ drafts: await dependencies.list(session.user.id) }, { headers }); }
      catch (error) { return serviceFailure(error); }
    },
    async POST(request: Request) {
      if (!dependencies.sameOrigin(request)) return failure("request_not_allowed", 403);
      const session = await dependencies.getSession(request);
      if (!session?.user.emailVerifiedAt) return failure("unauthenticated_or_unverified", 401);
      let body: z.infer<typeof createSchema>;
      try {
        const raw = await request.text();
        if (raw.length > 2048) return failure("invalid", 400);
        body = createSchema.parse(JSON.parse(raw));
      } catch { return failure("invalid", 400); }
      try {
        const result = await dependencies.createOrResume({ authenticatedUserId: session.user.id, ...body });
        const status = result && typeof result === "object" && "resumed" in result && result.resumed === true ? 200 : 201;
        return NextResponse.json(result, { status, headers });
      } catch (error) { return serviceFailure(error); }
    },
  };
}

const defaultHandlers = createGiftDraftCollectionHandlers({
  sameOrigin: isSameOriginMutation,
  getSession: async (request) => {
    const { getVerifiedCustomerPaymentSession } = await import("@/lib/v2/customerPaymentHttp");
    return getVerifiedCustomerPaymentSession(request);
  },
  list: async (userId) => {
    const { listSpaquatoriaGiftDraftsForUser } = await import("@/db/v2/services/spaquatoriaGiftDrafts");
    return listSpaquatoriaGiftDraftsForUser(userId);
  },
  createOrResume: async (input) => {
    const { createOrResumeSpaquatoriaGiftDraft } = await import("@/db/v2/services/spaquatoriaGiftDrafts");
    return createOrResumeSpaquatoriaGiftDraft(input);
  },
});

export const GET = defaultHandlers.GET;
export const POST = defaultHandlers.POST;
