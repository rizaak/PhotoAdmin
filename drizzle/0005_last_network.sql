INSERT INTO "watermarks" ("studio_id","slot","type","text","opacity_pct","size_pct","placement")
SELECT DISTINCT ON (g."studio_id") g."studio_id", 0, 'text', g."watermark_text", 35, 15, 'tile'
FROM "galleries" g
WHERE g."watermark_text" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "watermarks" w WHERE w."studio_id" = g."studio_id")
ORDER BY g."studio_id", g."updated_at" DESC;--> statement-breakpoint
ALTER TABLE "galleries" DROP COLUMN "watermark_text";--> statement-breakpoint
ALTER TABLE "galleries" DROP COLUMN "watermark_image_key";
