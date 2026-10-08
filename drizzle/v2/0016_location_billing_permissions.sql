CREATE TABLE "location_billing_permissions" (
	"location_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_billing_permissions_location_id_user_id_pk" PRIMARY KEY("location_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "location_billing_permissions" ADD CONSTRAINT "location_billing_permissions_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_billing_permissions" ADD CONSTRAINT "location_billing_permissions_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_billing_permissions" ADD CONSTRAINT "location_billing_permissions_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_billing_permissions_user_idx" ON "location_billing_permissions" USING btree ("user_id","organization_id");