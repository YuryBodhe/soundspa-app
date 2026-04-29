CREATE TABLE "monitoring_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"agent_name" text NOT NULL,
	"type" text DEFAULT 'technical',
	"content" text NOT NULL,
	"status" text DEFAULT 'ok',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "issued_to" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "created_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "used_by_tenant_id" integer;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "used_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "base_label" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "rotation_interval_months" integer;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "users_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_logs" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "monitoring_logs" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "monitoring_logs" ADD COLUMN "event_type" text;--> statement-breakpoint
ALTER TABLE "monitoring_logs" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "monitoring_logs" ADD COLUMN "client_type" text;--> statement-breakpoint
ALTER TABLE "monitoring_logs" ADD COLUMN "is_buffering" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_logs" ADD COLUMN "noise_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "kind" text DEFAULT 'watcher' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_reports" ADD CONSTRAINT "monitoring_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_tenant_id_tenants_id_fk" FOREIGN KEY ("used_by_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;