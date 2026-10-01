CREATE TABLE "device_activation_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "credential_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device_activation_tokens" ADD CONSTRAINT "device_activation_tokens_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_activation_tokens_token_hash_unique" ON "device_activation_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "device_activation_tokens_device_idx" ON "device_activation_tokens" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "device_activation_tokens_expiry_idx" ON "device_activation_tokens" USING btree ("expires_at");
