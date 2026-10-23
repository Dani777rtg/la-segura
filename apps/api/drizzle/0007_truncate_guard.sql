-- TRUNCATE no dispara los triggers de fila: se bloquea aparte para que nadie vacíe el registro.
CREATE FUNCTION ledger_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'No se permite TRUNCATE sobre %', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
FOR EACH STATEMENT EXECUTE FUNCTION ledger_no_truncate();
--> statement-breakpoint
CREATE TRIGGER reports_no_truncate BEFORE TRUNCATE ON reports
FOR EACH STATEMENT EXECUTE FUNCTION ledger_no_truncate();
