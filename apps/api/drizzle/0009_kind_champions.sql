ALTER TABLE "cases" ADD COLUMN "level" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "case_id" bigint;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_case_id_unique" UNIQUE("case_id");