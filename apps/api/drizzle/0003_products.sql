CREATE TABLE "product_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text,
	"url" text,
	"filename" text NOT NULL,
	"size_bytes" bigint,
	"content_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_files_kind_data" CHECK (("product_files"."kind" = 'file' and "product_files"."storage_key" is not null) or ("product_files"."kind" = 'link' and "product_files"."url" is not null))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"price" integer NOT NULL,
	"weight_g" integer,
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"stock_reserved" integer DEFAULT 0 NOT NULL,
	"stock_sold" integer DEFAULT 0 NOT NULL,
	"is_licensed" boolean DEFAULT false NOT NULL,
	"cover_key" text,
	"cover_updated_at" timestamp with time zone,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_price_positive" CHECK ("products"."price" > 0),
	CONSTRAINT "products_physical_needs_weight" CHECK ("products"."type" <> 'physical' or "products"."weight_g" > 0),
	CONSTRAINT "products_stock_non_negative" CHECK ("products"."stock_qty" >= 0 and "products"."stock_reserved" >= 0 and "products"."stock_sold" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product_files" ADD CONSTRAINT "product_files_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_files_product_idx" ON "product_files" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "products_active_created_idx" ON "products" USING btree ("active","created_at");