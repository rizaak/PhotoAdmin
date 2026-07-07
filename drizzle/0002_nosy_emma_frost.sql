DELETE FROM "comments" a USING "comments" b
WHERE a."client_id" = b."client_id" AND a."photo_id" = b."photo_id"
  AND (a."created_at" < b."created_at" OR (a."created_at" = b."created_at" AND a."id" < b."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "comments_client_photo_idx" ON "comments" USING btree ("client_id","photo_id");