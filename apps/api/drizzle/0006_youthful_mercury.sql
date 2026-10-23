CREATE TABLE "bot_state" (
	"phone" text PRIMARY KEY NOT NULL,
	"last_case_id" bigint,
	"awaiting_report" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_state" ADD CONSTRAINT "bot_state_last_case_id_cases_id_fk" FOREIGN KEY ("last_case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;