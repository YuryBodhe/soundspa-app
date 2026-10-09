CREATE TYPE "public"."gift_access_duration" AS ENUM('3_months', '6_months', '12_months', 'indefinite');--> statement-breakpoint
CREATE TABLE "gift_access_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"duration" "gift_access_duration" NOT NULL,
	"duration_months" integer,
	"redemption_deadline" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_operator" text,
	"created_by_operator" text NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_organization_id" uuid,
	"redeemed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_access_invitations_token_hash_sha256" CHECK ("gift_access_invitations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "gift_access_invitations_operator_nonempty" CHECK (length(btrim("gift_access_invitations"."created_by_operator")) > 0),
	CONSTRAINT "gift_access_invitations_revocation_shape" CHECK (("gift_access_invitations"."revoked_at" IS NULL AND "gift_access_invitations"."revoked_by_operator" IS NULL) OR ("gift_access_invitations"."revoked_at" IS NOT NULL AND "gift_access_invitations"."revoked_by_operator" IS NOT NULL AND length(btrim("gift_access_invitations"."revoked_by_operator")) > 0)),
	CONSTRAINT "gift_access_invitations_duration_shape" CHECK (("gift_access_invitations"."duration" = 'indefinite' AND "gift_access_invitations"."duration_months" IS NULL) OR ("gift_access_invitations"."duration" <> 'indefinite' AND "gift_access_invitations"."duration_months" IN (3, 6, 12))),
	CONSTRAINT "gift_access_invitations_redemption_shape" CHECK (("gift_access_invitations"."redeemed_at" IS NULL AND "gift_access_invitations"."redeemed_organization_id" IS NULL AND "gift_access_invitations"."redeemed_by_user_id" IS NULL) OR ("gift_access_invitations"."redeemed_at" IS NOT NULL AND "gift_access_invitations"."redeemed_organization_id" IS NOT NULL AND "gift_access_invitations"."redeemed_by_user_id" IS NOT NULL))
);--> statement-breakpoint
CREATE TABLE "organization_channel_gift_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"redeemed_by_user_id" uuid NOT NULL,
	"duration" "gift_access_duration" NOT NULL,
	"duration_months" integer,
	"redeemed_at" timestamp with time zone NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"billing_anchor_day" integer,
	"billing_anchor_is_end_of_month" boolean,
	"revoked_at" timestamp with time zone,
	"revoked_by_operator" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_channel_gift_grants_duration_shape" CHECK (("organization_channel_gift_grants"."duration" = 'indefinite' AND "organization_channel_gift_grants"."duration_months" IS NULL AND "organization_channel_gift_grants"."ends_at" IS NULL AND "organization_channel_gift_grants"."billing_anchor_day" IS NULL AND "organization_channel_gift_grants"."billing_anchor_is_end_of_month" IS NULL) OR ("organization_channel_gift_grants"."duration" <> 'indefinite' AND "organization_channel_gift_grants"."duration_months" IN (3, 6, 12) AND "organization_channel_gift_grants"."ends_at" > "organization_channel_gift_grants"."starts_at" AND "organization_channel_gift_grants"."billing_anchor_day" BETWEEN 1 AND 31 AND "organization_channel_gift_grants"."billing_anchor_is_end_of_month" IS NOT NULL)),
	CONSTRAINT "organization_channel_gift_grants_revocation_shape" CHECK (("organization_channel_gift_grants"."revoked_at" IS NULL AND "organization_channel_gift_grants"."revoked_by_operator" IS NULL) OR ("organization_channel_gift_grants"."revoked_at" IS NOT NULL AND "organization_channel_gift_grants"."revoked_by_operator" IS NOT NULL AND length(btrim("organization_channel_gift_grants"."revoked_by_operator")) > 0))
);--> statement-breakpoint
CREATE UNIQUE INDEX "gift_access_invitations_token_hash_unique" ON "gift_access_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_access_invitations_redemption_target_unique" ON "gift_access_invitations" USING btree ("id","channel_id","redeemed_organization_id","redeemed_by_user_id");--> statement-breakpoint
CREATE INDEX "gift_access_invitations_created_idx" ON "gift_access_invitations" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "gift_access_invitations_channel_idx" ON "gift_access_invitations" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_channel_gift_grants_invitation_unique" ON "organization_channel_gift_grants" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "organization_channel_gift_grants_entitlement_idx" ON "organization_channel_gift_grants" USING btree ("organization_id","channel_id","revoked_at","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "organization_channel_gift_grants_redemption_idx" ON "organization_channel_gift_grants" USING btree ("organization_id","channel_id","redeemed_at","id");--> statement-breakpoint
ALTER TABLE "gift_access_invitations" ADD CONSTRAINT "gift_access_invitations_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_access_invitations" ADD CONSTRAINT "gift_access_invitations_redeemed_organization_id_organizations_id_fk" FOREIGN KEY ("redeemed_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_access_invitations" ADD CONSTRAINT "gift_access_invitations_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_channel_gift_grants" ADD CONSTRAINT "organization_channel_gift_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_channel_gift_grants" ADD CONSTRAINT "organization_channel_gift_grants_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_channel_gift_grants" ADD CONSTRAINT "organization_channel_gift_grants_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_channel_gift_grants" ADD CONSTRAINT "organization_channel_gift_grants_invitation_target_fk" FOREIGN KEY ("invitation_id","channel_id","organization_id","redeemed_by_user_id") REFERENCES "public"."gift_access_invitations"("id","channel_id","redeemed_organization_id","redeemed_by_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
