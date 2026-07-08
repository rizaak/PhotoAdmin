ALTER TABLE "galleries" ALTER COLUMN "cover_template" SET DEFAULT 'editorial';
--> statement-breakpoint
UPDATE "galleries" SET "cover_template" = 'editorial' WHERE "cover_template" = 'classic';