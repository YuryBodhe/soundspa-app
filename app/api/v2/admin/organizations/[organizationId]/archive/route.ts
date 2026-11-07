import { mutateOrganizationLifecycle } from "../../lifecycleRoute";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return mutateOrganizationLifecycle(request, context, "archive");
}
