import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { v2Db } from "../client";
import { channels, channelTracks } from "../schema";

export class ContentValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ContentValidationError"; }
}
const nonempty = z.string().trim().min(1).max(200);
const key = z.string().trim().max(500).refine((value) => !value || value.split("/").every((part) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) && part !== "." && part !== ".."), "Invalid image key.");
export const channelInput = z.object({
  displayName: nonempty,
  slug: nonempty.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  kind: z.enum(["music", "ambient"]),
  description: z.string().trim().max(2000),
  imageKey: key,
  sortOrder: z.number().int().min(0).max(2147483647),
});
export type ChannelInput = z.infer<typeof channelInput>;
type ContentConnection = Pick<typeof v2Db, "select" | "insert" | "update" | "execute">;

// Trusted server service. HTTP callers must authorize before invoking it.
// Injecting the transaction allows verification to roll back all synthetic data.
export function contentAdminService(tx: ContentConnection) {
  const lockChannel = async (id: string) => {
    if (!z.string().uuid().safeParse(id).success) throw new ContentValidationError("Invalid channel ID.");
    await tx.execute(sql`SELECT id FROM channels WHERE id = ${id}::uuid FOR UPDATE`);
    const [channel] = await tx.select().from(channels).where(eq(channels.id, id));
    if (!channel) throw new ContentValidationError("Channel not found.");
    return channel;
  };
  const tracksFor = (id: string) => tx.select().from(channelTracks).where(eq(channelTracks.channelId, id));
  const editable = (channel: typeof channels.$inferSelect) => {
    if (channel.archivedAt) throw new ContentValidationError("Archived channels cannot be edited.");
  };
  return {
    async create(input: ChannelInput) {
      const values = channelInput.parse(input);
      const [channel] = await tx.insert(channels).values({ ...values, description: values.description || null, imageKey: values.imageKey || null, isPublished: false }).returning();
      return channel;
    },
    async edit(id: string, input: ChannelInput) {
      const values = channelInput.parse(input);
      const channel = await lockChannel(id); editable(channel);
      const tracks = await tracksFor(id);
      if (tracks.length && values.slug !== channel.slug) throw new ContentValidationError("Slug is immutable once track records exist.");
      if (tracks.length && values.kind !== channel.kind) throw new ContentValidationError("Kind cannot change while track records exist.");
      if (channel.isPublished && !values.imageKey) throw new ContentValidationError("Unpublish before removing artwork metadata.");
      await tx.update(channels).set({ ...values, description: values.description || null, imageKey: values.imageKey || null, updatedAt: new Date() }).where(eq(channels.id, id));
    },
    async publication(id: string, published: boolean) {
      const channel = await lockChannel(id);
      if (published) {
        editable(channel);
        if (!channel.imageKey?.trim()) throw new ContentValidationError("Artwork image key is required before publishing.");
        if (!(await tracksFor(id)).some((track) => track.isEnabled)) throw new ContentValidationError("At least one enabled track is required before publishing.");
      }
      await tx.update(channels).set({ isPublished: published, updatedAt: new Date() }).where(eq(channels.id, id));
    },
    async archive(id: string) {
      await lockChannel(id);
      await tx.update(channels).set({ archivedAt: new Date(), isPublished: false, updatedAt: new Date() }).where(eq(channels.id, id));
    },
    async track(id: string, trackId: string, enabled: boolean, sortOrder: number) {
      const channel = await lockChannel(id); editable(channel);
      if (!z.string().uuid().safeParse(trackId).success || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 2147483647) throw new ContentValidationError("Invalid track ID or order.");
      const tracks = await tracksFor(id);
      if (!tracks.some((track) => track.id === trackId)) throw new ContentValidationError("Track does not belong to this channel.");
      if (!enabled && channel.isPublished && !tracks.some((track) => track.id !== trackId && track.isEnabled)) throw new ContentValidationError("Unpublish before disabling the last enabled track.");
      await tx.update(channelTracks).set({ isEnabled: enabled, sortOrder, updatedAt: new Date() })
        .where(and(eq(channelTracks.id, trackId), eq(channelTracks.channelId, id)));
    },
  };
}

export function mutateContentAdmin<T>(operation: (service: ReturnType<typeof contentAdminService>) => Promise<T>) {
  return v2Db.transaction((tx) => operation(contentAdminService(tx)));
}
