CREATE TABLE "presentations" (
	"code" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"slide" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
