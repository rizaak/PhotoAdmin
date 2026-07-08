CREATE TYPE "public"."watermark_placement" AS ENUM('tl', 'tc', 'tr', 'ml', 'center', 'mr', 'bl', 'bc', 'br', 'tile');--> statement-breakpoint
CREATE TYPE "public"."watermark_type" AS ENUM('text', 'image');--> statement-breakpoint
CREATE TABLE "watermarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"type" "watermark_type" NOT NULL,
	"text" text,
	"image_key" text,
	"opacity_pct" integer NOT NULL,
	"size_pct" integer NOT NULL,
	"placement" "watermark_placement" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watermarks" ADD CONSTRAINT "watermarks_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watermarks_studio_slot_idx" ON "watermarks" USING btree ("studio_id","slot");