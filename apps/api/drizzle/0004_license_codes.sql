CREATE TABLE "license_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"code_enc" text NOT NULL,
	"code_index" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"order_item_id" uuid,
	"assigned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "license_codes_product_code_unique" UNIQUE("product_id","code_index")
);
--> statement-breakpoint
ALTER TABLE "license_codes" ADD CONSTRAINT "license_codes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "license_codes_status_idx" ON "license_codes" USING btree ("product_id","status");