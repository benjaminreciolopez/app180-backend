-- RLS Phase 2 — todas las tablas con `empresa_id` directo.
--
-- Habilita RLS y crea 4 políticas (SELECT/INSERT/UPDATE/DELETE) por tabla,
-- todas comparando `empresa_id::text` contra `current_setting('app.empresa_id', true)`.
-- Inerte mientras la connection string siga siendo superuser/postgres con BYPASSRLS;
-- se activa al pasar a `contendo_app` en Fase 4.
--
-- Idempotente: usa pg_tables para saltar tablas inexistentes y
-- DROP POLICY IF EXISTS antes de cada CREATE POLICY.
--
-- factura_180 / lineafactura_180 ya cubiertos en 20260425_rls_factura_180.sql.
-- lineafactura_180 usa subquery por carecer de empresa_id; aquí no se incluye.

DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        -- Verifactu / SIF
        'registroverifactu_180',
        'registroverifactueventos_180',
        'eventos_sistema_verifactu_180',
        -- Contabilidad / asientos
        'asientos_180',
        'lineas_asiento_180',
        'pgc_cuentas_180',
        'cuentas_contables_180',
        'ejercicios_contables_180',
        'cierre_ejercicio_180',
        'modelos_anuales_180',
        -- Compras y proformas
        'purchases_180',
        'proforma_180',
        -- Nóminas
        'nominas_180',
        -- Gestión / RRHH
        'clients_180',
        'employees_180',
        'partes_dia_180',
        'worklogs_180',
        'ausencias_180',
        'calendario_180',
        'centros_trabajo_180',
        'titulares_180',
        'certificados_digitales_180',
        -- Configuración / catálogos por empresa
        'empresa_config_180',
        'gastos_recurrentes_180',
        'factura_recurrente_180',
        'jornadas_180',
        'turnos_180',
        'plantillas_180'
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
                USING (empresa_id::text = current_setting('app.empresa_id', true))$f$,
            t, t);

        EXECUTE format(
            $f$CREATE POLICY rls_%s_insert ON %I
                FOR INSERT TO contendo_app
                WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true))$f$,
            t, t);

        EXECUTE format(
            $f$CREATE POLICY rls_%s_update ON %I
                FOR UPDATE TO contendo_app
                USING (empresa_id::text = current_setting('app.empresa_id', true))
                WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true))$f$,
            t, t);

        EXECUTE format(
            $f$CREATE POLICY rls_%s_delete ON %I
                FOR DELETE TO contendo_app
                USING (empresa_id::text = current_setting('app.empresa_id', true))$f$,
            t, t);

        RAISE NOTICE 'RLS habilitado en %', t;
    END LOOP;
END $$;
