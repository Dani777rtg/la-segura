CREATE TABLE "purchases" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"credits" integer NOT NULL,
	"base_cop" integer NOT NULL,
	"iva_cop" integer NOT NULL,
	"amount_cop" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"mp_preference_id" text,
	"mp_payment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	CONSTRAINT "purchases_status_valid" CHECK ("purchases"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "purchases_amount_consistent" CHECK ("purchases"."amount_cop" = "purchases"."base_cop" + "purchases"."iva_cop")
);
--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_payment_uq" ON "purchases" USING btree ("mp_payment_id");--> statement-breakpoint
CREATE INDEX "purchases_user_idx" ON "purchases" USING btree ("user_id","created_at");