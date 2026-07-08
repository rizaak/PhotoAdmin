ALTER TABLE "galleries" ADD COLUMN "watermark_id" uuid;--> statement-breakpoint
ALTER TABLE "galleries" ADD CONSTRAINT "galleries_watermark_id_watermarks_id_fk" FOREIGN KEY ("watermark_id") REFERENCES "public"."watermarks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE "galleries" g SET "watermark_id" = w."id"
FROM "watermarks" w
WHERE w."studio_id" = g."studio_id"
  AND w."slot" = (SELECT min(w2."slot") FROM "watermarks" w2 WHERE w2."studio_id" = g."studio_id");