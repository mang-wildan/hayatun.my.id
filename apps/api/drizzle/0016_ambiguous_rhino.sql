ALTER TABLE "orders" ADD COLUMN "gateway_reference" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gateway_url" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_gateway_reference_unique" UNIQUE("gateway_reference");