CREATE TABLE "device_current_browser_operations" (
	"operation_hash" text PRIMARY KEY NOT NULL,
	"authenticated_user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "device_current_browser_operations_hash_format" CHECK ("device_current_browser_operations"."operation_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "device_current_browser_operations_expiry_window" CHECK ("device_current_browser_operations"."expires_at" > "device_current_browser_operations"."created_at" AND "device_current_browser_operations"."expires_at" <= "device_current_browser_operations"."created_at" + interval '15 minutes')
);
--> statement-breakpoint
ALTER TABLE "device_current_browser_operations" ADD CONSTRAINT "device_current_browser_operations_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_current_browser_operations_device_unique" ON "device_current_browser_operations" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "device_current_browser_operations_expiry_idx" ON "device_current_browser_operations" USING btree ("expires_at");