ALTER TABLE "commercial_products" ADD COLUMN "catalog_visibility" text DEFAULT 'assigned' NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_products" ADD CONSTRAINT "commercial_products_catalog_visibility_valid" CHECK ("commercial_products"."catalog_visibility" IN ('public', 'assigned'));--> statement-breakpoint
UPDATE "commercial_products" SET "catalog_visibility" = 'public' WHERE "code" = 'soundspa';
