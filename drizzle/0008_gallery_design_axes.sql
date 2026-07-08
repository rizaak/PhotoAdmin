ALTER TABLE "galleries" ADD COLUMN "cover_style" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "galleries" ADD COLUMN "font_set" text DEFAULT 'elegante' NOT NULL;--> statement-breakpoint
ALTER TABLE "galleries" ADD COLUMN "palette" text DEFAULT 'blanco' NOT NULL;--> statement-breakpoint
ALTER TABLE "galleries" ADD COLUMN "grid_style" text DEFAULT 'justificada' NOT NULL;--> statement-breakpoint
ALTER TABLE "galleries" ADD COLUMN "cover_image_key" text;--> statement-breakpoint
UPDATE "galleries" SET "cover_style"='overlay', "font_set"='dramatica', "palette"='carbon' WHERE "cover_template"='cinematico';--> statement-breakpoint
UPDATE "galleries" SET "cover_style"='overlay', "font_set"='amable', "palette"='calido', "grid_style"='aireada' WHERE "cover_template"='luminoso';--> statement-breakpoint
UPDATE "galleries" SET "cover_style"='split', "font_set"='clasica', "palette"='marfil', "grid_style"='cuadrada' WHERE "cover_template"='clasico';--> statement-breakpoint
INSERT INTO "sections" ("gallery_id", "name", "position", "visible")
SELECT p."gallery_id", 'Fotos',
       COALESCE((SELECT max(s."position") + 1 FROM "sections" s WHERE s."gallery_id" = p."gallery_id"), 0),
       true
FROM "photos" p WHERE p."section_id" IS NULL GROUP BY p."gallery_id";--> statement-breakpoint
UPDATE "photos" p SET "section_id" = (
  SELECT s."id" FROM "sections" s
  WHERE s."gallery_id" = p."gallery_id" AND s."name" = 'Fotos'
  ORDER BY s."position" DESC LIMIT 1
) WHERE p."section_id" IS NULL;--> statement-breakpoint
ALTER TABLE "photos" DROP CONSTRAINT "photos_section_id_sections_id_fk";--> statement-breakpoint
ALTER TABLE "photos" ALTER COLUMN "section_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "galleries" DROP COLUMN "cover_template";--> statement-breakpoint
ALTER TABLE "galleries" DROP COLUMN "theme";--> statement-breakpoint
DROP TYPE "public"."gallery_theme";
