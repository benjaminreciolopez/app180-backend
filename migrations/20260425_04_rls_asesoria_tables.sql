-- RLS Phase 2 — tablas de asesoría (filtran por `asesoria_id`).
--
-- Estas tablas representan datos cross-empresa propios de una asesoría
-- (vínculos asesor↔cliente, usuarios internos, documentos compartidos, etc.).
-- Filtrar por `app.empresa_id` no aplica: el tenant aquí es la asesoría.
--
-- El middleware tenantContext fija `app.asesoria_id` cuando el JWT del
-- request lleva role=asesor o usuarios elevados con asesoría asociada.
--
-- Inerte mientras la connection string sea superuser/postgres con BYPASSRLS.

DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'asesoria_clientes_180',
        'asesoria_usuarios_180',
        'asesoria_documentos_180',
        'asesoria_mensajes_180',
        'asesoria_invitaciones_180'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_tables
            WHERE schemaname = 'public' AND tablename = t
        ) THEN
            RAISE NOTICE 'skip RLS on %: table not found', t;
            CONTINUE;
        END IF;

        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

        EXECUTE format('DROP POLICY IF EXISTS rls_%s_select ON %I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%s_insert ON %I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%s_update ON %I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%s_delete ON %I', t, t);

        EXECUTE format(
            $f$CREATE POLICY rls_%s_select ON %I
                FOR SELECT TO contendo_app
                USING (asesoria_id::text = current_setting('app.asesoria_id', true))$f$,
            t, t);

        EXECUTE format(
            $f$CREATE POLICY rls_%s_insert ON %I
                FOR INSERT TO contendo_app
                WITH CHECK (asesoria_id::text = current_setting('app.asesoria_id', true))$f$,
            t, t);

        EXECUTE format(
            $f$CREATE POLICY rls_%s_update ON %I
                FOR UPDATE TO contendo_app
                USING (asesoria_id::text = current_setting('app.asesoria_id', true))
                WITH CHECK (asesoria_id::text = current_setting('app.asesoria_id', true))$f$,
            t, t);

        EXECUTE format(
            $f$CREATE POLICY rls_%s_delete ON %I
                FOR DELETE TO contendo_app
                USING (asesoria_id::text = current_setting('app.asesoria_id', true))$f$,
            t, t);

        RAISE NOTICE 'RLS habilitado en % (asesoria_id)', t;
    END LOOP;
END $$;
