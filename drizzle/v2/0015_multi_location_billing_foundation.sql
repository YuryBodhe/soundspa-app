CREATE TABLE "commercial_billing_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"provider_code" text NOT NULL,
	"currency" text NOT NULL,
	"market_code" text NOT NULL,
	"route_id" uuid NOT NULL,
	"route_external_reference" text NOT NULL,
	"duration_months" integer NOT NULL,
	"list_amount_minor" bigint NOT NULL,
	"discount_amount_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"billing_anchor_day" integer NOT NULL,
	"billing_anchor_is_end_of_month" boolean NOT NULL,
	"billing_period_starts_at" timestamp with time zone,
	"billing_period_ends_at" timestamp with time zone,
	"subscription_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_billing_order_lines_duration_months" CHECK ("commercial_billing_order_lines"."duration_months" BETWEEN 1 AND 12),
	CONSTRAINT "commercial_billing_order_lines_market_format" CHECK ("commercial_billing_order_lines"."market_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "commercial_billing_order_lines_route_reference_nonempty" CHECK (length(btrim("commercial_billing_order_lines"."route_external_reference")) > 0),
	CONSTRAINT "commercial_billing_order_lines_amounts" CHECK ("commercial_billing_order_lines"."list_amount_minor" >= 0 AND "commercial_billing_order_lines"."discount_amount_minor" >= 0 AND "commercial_billing_order_lines"."discount_amount_minor" <= "commercial_billing_order_lines"."list_amount_minor" AND "commercial_billing_order_lines"."amount_minor" = "commercial_billing_order_lines"."list_amount_minor" - "commercial_billing_order_lines"."discount_amount_minor"),
	CONSTRAINT "commercial_billing_order_lines_anchor_day" CHECK ("commercial_billing_order_lines"."billing_anchor_day" BETWEEN 1 AND 31),
	CONSTRAINT "commercial_billing_order_lines_period_pair" CHECK (("commercial_billing_order_lines"."billing_period_starts_at" IS NULL AND "commercial_billing_order_lines"."billing_period_ends_at" IS NULL) OR ("commercial_billing_order_lines"."billing_period_starts_at" IS NOT NULL AND "commercial_billing_order_lines"."billing_period_ends_at" > "commercial_billing_order_lines"."billing_period_starts_at"))
);
--> statement-breakpoint
CREATE TABLE "commercial_billing_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"provider_code" text NOT NULL,
	"currency" text NOT NULL,
	"total_amount_minor" bigint NOT NULL,
	"quote_reference" text,
	"quoted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"provider_order_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_billing_orders_status_valid" CHECK ("commercial_billing_orders"."status" IN ('draft', 'quoted', 'pending', 'paid', 'expired', 'canceled', 'failed')),
	CONSTRAINT "commercial_billing_orders_amount_nonnegative" CHECK ("commercial_billing_orders"."total_amount_minor" >= 0),
	CONSTRAINT "commercial_billing_orders_currency_format" CHECK ("commercial_billing_orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "commercial_billing_orders_quote_expiry" CHECK ("commercial_billing_orders"."expires_at" IS NULL OR ("commercial_billing_orders"."quoted_at" IS NOT NULL AND "commercial_billing_orders"."expires_at" > "commercial_billing_orders"."quoted_at"))
);
--> statement-breakpoint
CREATE TABLE "commercial_payment_allocations" (
	"order_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_payment_allocations_payment_id_order_line_id_pk" PRIMARY KEY("payment_id","order_line_id"),
	CONSTRAINT "commercial_payment_allocations_amount_nonnegative" CHECK ("commercial_payment_allocations"."amount_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commercial_payments" ALTER COLUMN "location_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_payments" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_payments" ADD COLUMN "billing_order_id" uuid;--> statement-breakpoint
ALTER TABLE "location_subscriptions" ADD COLUMN "billing_anchor_day" integer;--> statement-breakpoint
ALTER TABLE "location_subscriptions" ADD COLUMN "billing_anchor_is_end_of_month" boolean;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_billing_order_lines_id_order_unique" ON "commercial_billing_order_lines" USING btree ("id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_billing_order_lines_target_unique" ON "commercial_billing_order_lines" USING btree ("order_id","location_id","product_id");--> statement-breakpoint
CREATE INDEX "commercial_billing_order_lines_location_product_idx" ON "commercial_billing_order_lines" USING btree ("location_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_billing_orders_id_organization_unique" ON "commercial_billing_orders" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_billing_orders_id_provider_unique" ON "commercial_billing_orders" USING btree ("id","provider_code");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_billing_orders_id_currency_unique" ON "commercial_billing_orders" USING btree ("id","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_payment_allocations_order_line_unique" ON "commercial_payment_allocations" USING btree ("order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_payment_routes_id_product_market_provider_unique" ON "commercial_payment_routes" USING btree ("id","product_id","market_code","provider_code");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_payments_id_billing_order_unique" ON "commercial_payments" USING btree ("id","billing_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_payments_billing_order_unique" ON "commercial_payments" USING btree ("billing_order_id") WHERE "commercial_payments"."billing_order_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_id_organization_unique" ON "locations" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "commercial_payments" ADD CONSTRAINT "commercial_payments_scope_shape" CHECK (("commercial_payments"."billing_order_id" IS NULL AND "commercial_payments"."location_id" IS NOT NULL AND "commercial_payments"."product_id" IS NOT NULL) OR ("commercial_payments"."billing_order_id" IS NOT NULL AND "commercial_payments"."location_id" IS NULL AND "commercial_payments"."product_id" IS NULL AND "commercial_payments"."subscription_id" IS NULL AND "commercial_payments"."route_id" IS NULL));--> statement-breakpoint
ALTER TABLE "location_subscriptions" ADD CONSTRAINT "location_subscriptions_billing_anchor_pair" CHECK (("location_subscriptions"."billing_anchor_day" IS NULL AND "location_subscriptions"."billing_anchor_is_end_of_month" IS NULL) OR ("location_subscriptions"."billing_anchor_day" BETWEEN 1 AND 31 AND "location_subscriptions"."billing_anchor_is_end_of_month" IS NOT NULL));--> statement-breakpoint
CREATE INDEX "commercial_billing_orders_organization_created_idx" ON "commercial_billing_orders" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "commercial_payment_allocations_order_idx" ON "commercial_payment_allocations" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "commercial_billing_order_lines" ADD CONSTRAINT "commercial_billing_order_lines_product_id_commercial_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_billing_order_lines" ADD CONSTRAINT "commercial_billing_order_lines_subscription_id_location_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."location_subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_billing_order_lines" ADD CONSTRAINT "commercial_billing_order_lines_order_organization_fk" FOREIGN KEY ("order_id","organization_id") REFERENCES "public"."commercial_billing_orders"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_billing_order_lines" ADD CONSTRAINT "commercial_billing_order_lines_location_organization_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_billing_order_lines" ADD CONSTRAINT "commercial_billing_order_lines_order_provider_fk" FOREIGN KEY ("order_id","provider_code") REFERENCES "public"."commercial_billing_orders"("id","provider_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_billing_order_lines" ADD CONSTRAINT "commercial_billing_order_lines_order_currency_fk" FOREIGN KEY ("order_id","currency") REFERENCES "public"."commercial_billing_orders"("id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_billing_order_lines" ADD CONSTRAINT "commercial_billing_order_lines_route_snapshot_fk" FOREIGN KEY ("route_id","product_id","market_code","provider_code") REFERENCES "public"."commercial_payment_routes"("id","product_id","market_code","provider_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_billing_orders" ADD CONSTRAINT "commercial_billing_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_billing_orders" ADD CONSTRAINT "commercial_billing_orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_billing_orders" ADD CONSTRAINT "commercial_billing_orders_provider_code_commercial_payment_providers_code_fk" FOREIGN KEY ("provider_code") REFERENCES "public"."commercial_payment_providers"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payment_allocations" ADD CONSTRAINT "commercial_payment_allocations_payment_order_fk" FOREIGN KEY ("payment_id","order_id") REFERENCES "public"."commercial_payments"("id","billing_order_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payment_allocations" ADD CONSTRAINT "commercial_payment_allocations_line_order_fk" FOREIGN KEY ("order_line_id","order_id") REFERENCES "public"."commercial_billing_order_lines"("id","order_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payments" ADD CONSTRAINT "commercial_payments_billing_order_fk" FOREIGN KEY ("billing_order_id") REFERENCES "public"."commercial_billing_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payments" ADD CONSTRAINT "commercial_payments_order_provider_fk" FOREIGN KEY ("billing_order_id","provider_code") REFERENCES "public"."commercial_billing_orders"("id","provider_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payments" ADD CONSTRAINT "commercial_payments_order_currency_fk" FOREIGN KEY ("billing_order_id","currency") REFERENCES "public"."commercial_billing_orders"("id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
--> statement-breakpoint
-- Aggregate order totals and payment allocations are cross-row invariants.
-- Deferred constraint triggers permit a complete order/allocations to be
-- assembled inside one transaction while rejecting partial committed state.
CREATE OR REPLACE FUNCTION enforce_commercial_billing_order_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_order_id uuid;
  order_state text;
  order_total bigint;
  line_count bigint;
  line_total bigint;
BEGIN
  IF TG_TABLE_NAME = 'commercial_billing_orders' THEN
    target_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  END IF;

  SELECT status, total_amount_minor INTO order_state, order_total
    FROM commercial_billing_orders WHERE id = target_order_id;
  IF NOT FOUND OR order_state = 'draft' THEN RETURN NULL; END IF;

  SELECT count(*), COALESCE(sum(amount_minor), 0) INTO line_count, line_total
    FROM commercial_billing_order_lines WHERE order_id = target_order_id;
  IF line_count = 0 OR line_total <> order_total THEN
    RAISE EXCEPTION 'billing order lines must exactly equal order total'
      USING ERRCODE = '23514', CONSTRAINT = 'commercial_billing_order_total_matches_lines';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commercial_billing_orders_total_check
  AFTER INSERT OR UPDATE ON commercial_billing_orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION enforce_commercial_billing_order_total();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commercial_billing_order_lines_total_check
  AFTER INSERT OR UPDATE OR DELETE ON commercial_billing_order_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION enforce_commercial_billing_order_total();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_commercial_payment_allocations() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_payment_id uuid;
  target_order_id uuid;
  payment_total bigint;
  v_provider_code text;
  v_payment_currency text;
  order_total bigint;
  order_provider text;
  order_currency text;
  line_count bigint;
  allocation_count bigint;
  missing_count bigint;
  mismatched_count bigint;
  allocation_total bigint;
BEGIN
  IF TG_TABLE_NAME = 'commercial_payments' THEN
    target_payment_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_payment_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.payment_id ELSE NEW.payment_id END;
  END IF;

  SELECT p.billing_order_id, p.amount_minor, p.provider_code, p.currency
    INTO target_order_id, payment_total, v_provider_code, v_payment_currency
    FROM commercial_payments p WHERE p.id = target_payment_id;
  IF NOT FOUND OR target_order_id IS NULL THEN RETURN NULL; END IF;

  SELECT total_amount_minor, provider_code, currency
    INTO order_total, order_provider, order_currency
    FROM commercial_billing_orders WHERE id = target_order_id;
  IF NOT FOUND OR payment_total <> order_total OR v_provider_code <> order_provider OR v_payment_currency <> order_currency THEN
    RAISE EXCEPTION 'aggregate payment must match its billing order'
      USING ERRCODE = '23514', CONSTRAINT = 'commercial_payment_matches_billing_order';
  END IF;

  SELECT count(*), count(a.order_line_id),
         count(*) FILTER (WHERE a.order_line_id IS NULL),
         count(*) FILTER (WHERE a.order_line_id IS NOT NULL AND a.amount_minor <> l.amount_minor),
         COALESCE(sum(a.amount_minor), 0)
    INTO line_count, allocation_count, missing_count, mismatched_count, allocation_total
    FROM commercial_billing_order_lines l
    LEFT JOIN commercial_payment_allocations a
      ON a.order_line_id = l.id AND a.payment_id = target_payment_id
    WHERE l.order_id = target_order_id;
  IF line_count = 0 OR allocation_count <> line_count OR missing_count <> 0 OR mismatched_count <> 0 OR allocation_total <> payment_total THEN
    RAISE EXCEPTION 'aggregate payment allocations must exactly match every order line'
      USING ERRCODE = '23514', CONSTRAINT = 'commercial_payment_allocations_match_order_lines';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commercial_payments_allocation_check
  AFTER INSERT OR UPDATE ON commercial_payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION enforce_commercial_payment_allocations();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commercial_payment_allocations_total_check
  AFTER INSERT OR UPDATE OR DELETE ON commercial_payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION enforce_commercial_payment_allocations();
