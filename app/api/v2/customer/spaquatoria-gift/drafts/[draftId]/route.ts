import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { authResponseHeaders } from "@/lib/v2/customerAuthCore";
import { SpaquatoriaGiftDraftError } from "@/db/v2/services/spaquatoriaGiftDrafts";

export const dynamic = "force-dynamic";
const headers = authResponseHeaders();
const patchSchema = z.object({
  version: z.number().int().positive(),
  legalForm: z.enum(["ru_legal_entity", "ru_individual_entrepreneur"]).nullable().optional(),
  legalName: z.string().max(300).nullable().optional(),
  taxId: z.string().max(32).nullable().optional(),
  registrationNumber: z.string().max(32).nullable().optional(),
  registeredAddress: z.string().max(1000).nullable().optional(),
  physicalAddress: z.string().max(1000).nullable().optional(),
  representativeName: z.string().max(300).nullable().optional(),
  representativeRole: z.string().max(200).nullable().optional(),
  representativeEmail: z.string().max(254).nullable().optional(),
  representativePhone: z.string().max(64).nullable().optional(),
  authorityStatement: z.string().max(1000).nullable().optional(),
}).strict();
type Session = { user: { id: string; emailVerifiedAt: Date | string | null } };
type Dependencies = {
  sameOrigin: (request: Request) => boolean;
  getSession: (request: Request) => Promise<Session | null>;
  update: (input: { authenticatedUserId: string; draftId: string; expectedVersion: number; patch: unknown }) => Promise<unknown>;
};

function failure(code: string, status: number) { return NextResponse.json({ error: code }, { status, headers }); }
function serviceFailure(error: unknown) {
  if (error instanceof z.ZodError) return failure("invalid", 400);
  if (error instanceof SpaquatoriaGiftDraftError) {
    if (error.code === "invalid_input") return failure("invalid", 400);
    if (error.code === "version_conflict") return failure("version_conflict", 409);
    if (error.code === "not_authorized" || error.code === "location_unavailable" || error.code === "draft_unavailable") return failure("draft_unavailable", 404);
  }
  console.error("[V2 Spaquatoria Gift draft] Update failed.");
  return failure("unavailable", 503);
}

export function createGiftDraftUpdateHandler(dependencies: Dependencies) {
  return async function PATCH(request: Request, context: { params: Promise<{ draftId: string }> }) {
    if (!dependencies.sameOrigin(request)) return failure("request_not_allowed", 403);
    const session = await dependencies.getSession(request);
    if (!session?.user.emailVerifiedAt) return failure("unauthenticated_or_unverified", 401);
    let body: z.infer<typeof patchSchema>;
    try {
      const raw = await request.text();
      if (raw.length > 4096) return failure("invalid", 400);
      body = patchSchema.parse(JSON.parse(raw));
    } catch { return failure("invalid", 400); }
    const { draftId } = await context.params;
    const { version, ...patch } = body;
    try {
      const result = await dependencies.update({ authenticatedUserId: session.user.id, draftId, expectedVersion: version, patch });
      return NextResponse.json(result, { headers });
    } catch (error) { return serviceFailure(error); }
  };
}

const defaultPatch = createGiftDraftUpdateHandler({
  sameOrigin: isSameOriginMutation,
  getSession: async (request) => {
    const { getVerifiedCustomerPaymentSession } = await import("@/lib/v2/customerPaymentHttp");
    return getVerifiedCustomerPaymentSession(request);
  },
  update: async (input) => {
    const { updateSpaquatoriaGiftDraft } = await import("@/db/v2/services/spaquatoriaGiftDrafts");
    return updateSpaquatoriaGiftDraft(input);
  },
});

export const PATCH = defaultPatch;
