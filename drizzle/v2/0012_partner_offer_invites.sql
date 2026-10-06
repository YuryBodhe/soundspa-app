CREATE TYPE "public"."commercial_offer_grant_type" AS ENUM('partner_benefit', 'trial');--> statement-breakpoint
CREATE TABLE "commercial_offer_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"grant_type" "commercial_offer_grant_type" NOT NULL,
	"duration_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_offer_grants_duration_valid" CHECK (("commercial_offer_grants"."grant_type" = 'partner_benefit' AND ("commercial_offer_grants"."duration_days" IS NULL OR "commercial_offer_grants"."duration_days" > 0)) OR ("commercial_offer_grants"."grant_type" = 'trial' AND "commercial_offer_grants"."duration_days" > 0))
);
--> statement-breakpoint
CREATE TABLE "commercial_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_offers_code_nonempty" CHECK (length(btrim("commercial_offers"."code")) > 0),
	CONSTRAINT "commercial_offers_name_nonempty" CHECK (length(btrim("commercial_offers"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "commercial_partner_invite_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_partner_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"max_claims" integer,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_partner_invites_token_hash_sha256" CHECK ("commercial_partner_invites"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "commercial_partner_invites_max_claims_positive" CHECK ("commercial_partner_invites"."max_claims" IS NULL OR "commercial_partner_invites"."max_claims" > 0),
	CONSTRAINT "commercial_partner_invites_expiry_after_creation" CHECK ("commercial_partner_invites"."expires_at" IS NULL OR "commercial_partner_invites"."expires_at" > "commercial_partner_invites"."created_at")
);
--> statement-breakpoint
ALTER TABLE "commercial_offer_grants" ADD CONSTRAINT "commercial_offer_grants_offer_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."commercial_offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_offer_grants" ADD CONSTRAINT "commercial_offer_grants_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_partner_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."commercial_partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_partner_invite_claims" ADD CONSTRAINT "commercial_partner_invite_claims_invite_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."commercial_partner_invites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_partner_invite_claims" ADD CONSTRAINT "commercial_partner_invite_claims_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_partner_invites" ADD CONSTRAINT "commercial_partner_invites_offer_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."commercial_offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_offer_grants_offer_product_type_unique" ON "commercial_offer_grants" USING btree ("offer_id","product_id","grant_type");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_offers_partner_code_unique" ON "commercial_offers" USING btree ("partner_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_partner_invite_claims_invite_location_unique" ON "commercial_partner_invite_claims" USING btree ("invite_id","location_id");--> statement-breakpoint
CREATE INDEX "commercial_partner_invite_claims_location_idx" ON "commercial_partner_invite_claims" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_partner_invites_token_hash_unique" ON "commercial_partner_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "commercial_partner_invites_offer_idx" ON "commercial_partner_invites" USING btree ("offer_id");