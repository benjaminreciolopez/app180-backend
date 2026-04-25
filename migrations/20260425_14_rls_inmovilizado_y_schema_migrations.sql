-- Habilita RLS en tablas que aún están desactivadas y completa las policies.
--
-- inmovilizado_180: la migración _12 ya define las policies, pero esta
-- migración garantiza la activación incluso en bases de datos donde la
-- _12 se aplicó antes de añadir el bloque RLS (es idempotente).
--
-- schema_migrations_180: tabla de metadatos global del runner de
-- migraciones. No tiene empresa_id ni debe ser accesible desde la app.
-- Habilitamos RLS sin crear policies para contendo_app → deny-by-default.
-- Solo el rol que ejecuta migraciones (superuser/postgres con BYPASSRLS)
-- podrá insertar registros.

-- ============================================================
-- inmovilizado_180
-- ============================================================
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'inmovilizado_180') THEN
        EXECUTE 'ALTER TABLE inmovilizado_180 ENABLE ROW LEVEL SECURITY';

        EXECUTE 'DROP POLICY IF EXISTS rls_inmovilizado_180_select ON inmovilizado_180';
        EXECUTE 'DROP POLICY IF EXISTS rls_inmovilizado_180_insert ON inmovilizado_180';
        EXECUTE 'DROP POLICY IF EXISTS rls_inmovilizado_180_update ON inmovilizado_180';
        EXECUTE 'DROP POLICY IF EXISTS rls_inmovilizado_180_delete ON inmovilizado_180';

        EXECUTE $f$CREATE POLICY rls_inmovilizado_180_select ON inmovilizado_180
            FOR SELECT TO contendo_app
            USING (empresa_id::text = current_setting('app.empresa_id', true))$f$;

        EXECUTE $f$CREATE POLICY rls_inmovilizado_180_insert ON inmovilizado_180
            FOR INSERT TO contendo_app
            WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true))$f$;

        EXECUTE $f$CREATE POLICY rls_inmovilizado_180_update ON inmovilizado_180
            FOR UPDATE TO contendo_app
            USING (empresa_id::text = current_setting('app.empresa_id', true))
            WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true))$f$;

        EXECUTE $f$CREATE POLICY rls_inmovilizado_180_delete ON inmovilizado_180
            FOR DELETE TO contendo_app
            USING (empresa_id::text = current_setting('app.empresa_id', true))$f$;
    END IF;
END $$;

-- ============================================================
-- schema_migrations_180  (deny-by-default — sin policies para contendo_app)
-- ============================================================
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'schema_migrations_180') THEN
        EXECUTE 'ALTER TABLE schema_migrations_180 ENABLE ROW LEVEL SECURITY';
        -- Sin policies: la app no debe leer/escribir el registro de migraciones.
        -- El runner usa una connection string privilegiada que ignora RLS.
    END IF;
END $$;
