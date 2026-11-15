CREATE TYPE "public"."page_status" AS ENUM('draft', 'published', 'unpublished');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "handles_reserved" (
	"handle" "citext" PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handles_reserved" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"handle" "citext" NOT NULL,
	"previous_handle" "citext",
	"handle_changed_at" timestamp with time zone,
	"draft" jsonb NOT NULL,
	"status" "page_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_handle_unique" UNIQUE("handle"),
	CONSTRAINT "pages_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"display_name" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_user_id" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_live" ON "users" USING btree ("email") WHERE "users"."deleted_at" is null;