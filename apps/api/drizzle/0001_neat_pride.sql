CREATE TABLE "cases" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"input_text" text NOT NULL,
	"risk" text NOT NULL,
	"confidence" smallint NOT NULL,
	"fraud_type" text NOT NULL,
	"summary" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"advice" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"municipality_code" text NOT NULL,
	"locality_id" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_risk_valid" CHECK ("cases"."risk" IN ('alto', 'medio', 'bajo')),
	CONSTRAINT "cases_confidence_valid" CHECK ("cases"."confidence" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "indicators" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "indicators_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"value_hash" text NOT NULL,
	"display" text NOT NULL,
	"case_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indicators_kind_valid" CHECK ("indicators"."kind" IN ('phone', 'domain'))
);
--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_municipality_code_municipalities_code_fk" FOREIGN KEY ("municipality_code") REFERENCES "public"."municipalities"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_locality_id_localities_id_fk" FOREIGN KEY ("locality_id") REFERENCES "public"."localities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_user_idx" ON "cases" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "cases_municipality_idx" ON "cases" USING btree ("municipality_code","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "indicators_user_value_uq" ON "indicators" USING btree ("kind","value_hash","user_id");--> statement-breakpoint
CREATE INDEX "indicators_lookup_idx" ON "indicators" USING btree ("kind","value_hash");