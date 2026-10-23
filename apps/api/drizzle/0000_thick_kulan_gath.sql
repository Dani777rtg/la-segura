CREATE TABLE "credit_accounts" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "credit_accounts_balance_non_negative" CHECK ("credit_accounts"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credit_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_delta_non_zero" CHECK ("credit_ledger"."delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "localities" (
	"id" smallint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"geojson" jsonb,
	CONSTRAINT "localities_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "municipalities" (
	"code" text PRIMARY KEY NOT NULL,
	"dept_code" text NOT NULL,
	"dept" text NOT NULL,
	"name" text NOT NULL,
	"name_norm" text NOT NULL,
	"lat" double precision,
	"lon" double precision
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "otp_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"municipality_code" text NOT NULL,
	"locality_id" smallint,
	"phone_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_municipality_code_municipalities_code_fk" FOREIGN KEY ("municipality_code") REFERENCES "public"."municipalities"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_locality_id_localities_id_fk" FOREIGN KEY ("locality_id") REFERENCES "public"."localities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_ref_uq" ON "credit_ledger" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "credit_ledger_user_idx" ON "credit_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "municipalities_name_norm_idx" ON "municipalities" USING btree ("name_norm" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "otp_codes_user_idx" ON "otp_codes" USING btree ("user_id");