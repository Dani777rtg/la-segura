-- El registro de reportes es de solo anexar: ni siquiera la aplicación puede editar o borrar entradas.
CREATE FUNCTION ledger_entries_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries es de solo anexar: no se permite % ', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_update_delete
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();
--> statement-breakpoint
-- Los reportes firmados tampoco se pueden modificar.
CREATE FUNCTION reports_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'reports es inmutable: no se permite %', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reports_no_update_delete
BEFORE UPDATE OR DELETE ON reports
FOR EACH ROW EXECUTE FUNCTION reports_immutable();
