-- RLS Phase 2 (tabla 1 de N): factura_180 + lineafactura_180.
--
-- Habilita RLS y crea políticas para el rol `contendo_app` que filtran por
-- `current_setting('app.empresa_id', true)`. Mientras la app siga conectando
-- como superuser/postgres (BYPASSRLS), estas políticas son inertes — se
-- activan al cambiar la connection string en Fase 4.
--
-- `current_setting(_, true)` con segundo arg true devuelve NULL en lugar
-- de error si el GUC no está seteado. La comparación contra empresa_id
-- falla si NULL, denegando filas a rutas sin tenant resuelto — comportamiento
-- seguro por defecto.
--
-- lineafactura_180 no tiene empresa_id propio: la política filtra vía
-- EXISTS sobre factura_180. Si en producción esto produce regresiones
-- de performance se puede denormalizar añadiendo empresa_id a la línea.

-- ============================================================
-- factura_180
-- ============================================================

ALTER TABLE factura_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_factura_select ON factura_180;
DROP POLICY IF EXISTS rls_factura_insert ON factura_180;
DROP POLICY IF EXISTS rls_factura_update ON factura_180;
DROP POLICY IF EXISTS rls_factura_delete ON factura_180;

CREATE POLICY rls_factura_select ON factura_180
    FOR SELECT TO contendo_app
    USING (empresa_id::text = current_setting('app.empresa_id', true));

CREATE POLICY rls_factura_insert ON factura_180
    FOR INSERT TO contendo_app
    WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true));

CREATE POLICY rls_factura_update ON factura_180
    FOR UPDATE TO contendo_app
    USING (empresa_id::text = current_setting('app.empresa_id', true))
    WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true));

CREATE POLICY rls_factura_delete ON factura_180
    FOR DELETE TO contendo_app
    USING (empresa_id::text = current_setting('app.empresa_id', true));

-- ============================================================
-- lineafactura_180 (filtra vía factura padre)
-- ============================================================

ALTER TABLE lineafactura_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_lineafactura_select ON lineafactura_180;
DROP POLICY IF EXISTS rls_lineafactura_insert ON lineafactura_180;
DROP POLICY IF EXISTS rls_lineafactura_update ON lineafactura_180;
DROP POLICY IF EXISTS rls_lineafactura_delete ON lineafactura_180;

CREATE POLICY rls_lineafactura_select ON lineafactura_180
    FOR SELECT TO contendo_app
    USING (
        EXISTS (
            SELECT 1 FROM factura_180 f
            WHERE f.id = lineafactura_180.factura_id
              AND f.empresa_id::text = current_setting('app.empresa_id', true)
        )
    );

CREATE POLICY rls_lineafactura_insert ON lineafactura_180
    FOR INSERT TO contendo_app
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM factura_180 f
            WHERE f.id = lineafactura_180.factura_id
              AND f.empresa_id::text = current_setting('app.empresa_id', true)
        )
    );

CREATE POLICY rls_lineafactura_update ON lineafactura_180
    FOR UPDATE TO contendo_app
    USING (
        EXISTS (
            SELECT 1 FROM factura_180 f
            WHERE f.id = lineafactura_180.factura_id
              AND f.empresa_id::text = current_setting('app.empresa_id', true)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM factura_180 f
            WHERE f.id = lineafactura_180.factura_id
              AND f.empresa_id::text = current_setting('app.empresa_id', true)
        )
    );

CREATE POLICY rls_lineafactura_delete ON lineafactura_180
    FOR DELETE TO contendo_app
    USING (
        EXISTS (
            SELECT 1 FROM factura_180 f
            WHERE f.id = lineafactura_180.factura_id
              AND f.empresa_id::text = current_setting('app.empresa_id', true)
        )
    );
