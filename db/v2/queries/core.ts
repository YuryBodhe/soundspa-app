import { eq } from "drizzle-orm";
import { v2Db } from "../client";
import { organizations } from "../schema";

export async function getOrganization(id: string) {
  const [organization] = await v2Db.select().from(organizations).where(eq(organizations.id, id));
  return organization ?? null;
}
