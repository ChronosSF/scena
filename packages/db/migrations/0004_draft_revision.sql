ALTER TABLE "pages" ALTER COLUMN "handle" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "draft_revision" integer DEFAULT 1 NOT NULL;