CREATE TABLE "ledger_entries" (
	"idx" integer PRIMARY KEY NOT NULL,
	"report_id" bigint NOT NULL,
	"payload_hash" text NOT NULL,
	"prev_hash" text NOT NULL,
	"entry_hash" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "ledger_entries_report_id_unique" UNIQUE("report_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"case_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"type" text NOT NULL,
	"payload" text NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_code_unique" UNIQUE("code"),
	CONSTRAINT "reports_case_id_unique" UNIQUE("case_id"),
	CONSTRAINT "reports_type_valid" CHECK ("reports"."type" IN ('suplantacion_entidad', 'robo_cuenta', 'compra_prestamo_falso', 'generico'))
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_user_idx" ON "reports" USING btree ("user_id","created_at");