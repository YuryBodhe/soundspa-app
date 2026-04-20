ALTER TABLE "agents" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "model" text DEFAULT 'nvidia/nemotron-3-super-120b-a12b:free';--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "temperature" real DEFAULT 0;