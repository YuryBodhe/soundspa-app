CREATE TABLE "organization_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"organization_name" text NOT NULL,
	"action" text NOT NULL,
	"operator" text NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_lifecycle_events_action_valid" CHECK ("organization_lifecycle_events"."action" IN ('archived', 'restored')),
	CONSTRAINT "organization_lifecycle_events_operator_nonempty" CHECK (length(btrim("organization_lifecycle_events"."operator")) BETWEEN 1 AND 200),
	CONSTRAINT "organization_lifecycle_events_reason_nonempty" CHECK (length(btrim("organization_lifecycle_events"."reason")) BETWEEN 12 AND 500),
	CONSTRAINT "organization_lifecycle_events_name_nonempty" CHECK (length(btrim("organization_lifecycle_events"."organization_name")) > 0)
);
--> statement-breakpoint
CREATE INDEX "organization_lifecycle_events_org_time_idx" ON "organization_lifecycle_events" USING btree ("organization_id","occurred_at");