-- Sprint 3D: registro de inmovilizado y amortizaciones para autónomos.
--
-- Estimación directa simplificada (Art. 28 RIRPF) permite deducir como
-- gasto la amortización lineal de los bienes afectos a la actividad,
-- aplicando los coeficientes máximos de la tabla simplificada (Anexo del
-- Reglamento del Impuesto sobre Sociedades).
--
-- En vez de pre-computar cada periodo, almacenamos el alta del bien y
-- calculamos la amortización acumulada on-demand al generar el modelo 130
-- prorrateando por días desde fecha_alta.

CREATE TABLE IF NOT EXISTS inmovilizado_180 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL,
    descripcion TEXT NOT NULL,
    fecha_alta DATE NOT NULL,
    fecha_baja DATE,
    valor_adquisicion NUMERIC(14,2) NOT NULL,
    valor_residual NUMERIC(14,2) NOT NULL DEFAULT 0,
    grupo TEXT NOT NULL CHECK (grupo IN (
        'edificios', 'instalaciones', 'maquinaria', 'mobiliario',
        'equipos_informaticos', 'vehiculos', 'utiles_herramientas', 'otros'
    )),
    coef_amortizacion_pct NUMERIC(5,2) NOT NULL CHECK (coef_amortizacion_pct > 0 AND coef_amortizacion_pct <= 100),
    metodo TEXT NOT NULL DEFAULT 'lineal' CHECK (metodo IN ('lineal')),
    cuenta_inmovilizado VARCHAR(10),
    cuenta_amortizacion_acumulada VARCHAR(10),
    cuenta_dotacion VARCHAR(10),
    purchase_id UUID,
    notas TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inmovilizado_empresa
    ON inmovilizado_180 (empresa_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inmovilizado_fecha_alta
    ON inmovilizado_180 (empresa_id, fecha_alta) WHERE deleted_at IS NULL;

-- FK opcional al gasto (purchase) que originó el alta.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inmovilizado_180_purchase_fk'
    ) THEN
        ALTER TABLE inmovilizado_180
            ADD CONSTRAINT inmovilizado_180_purchase_fk
            FOREIGN KEY (purchase_id) REFERENCES purchases_180(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Row-Level Security: aislamiento multi-tenant por empresa_id, mismo patrón
-- que el resto de tablas tenant (ver 20260425_02_rls_tenant_tables.sql).
ALTER TABLE inmovilizado_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_inmovilizado_180_select ON inmovilizado_180;
DROP POLICY IF EXISTS rls_inmovilizado_180_insert ON inmovilizado_180;
DROP POLICY IF EXISTS rls_inmovilizado_180_update ON inmovilizado_180;
DROP POLICY IF EXISTS rls_inmovilizado_180_delete ON inmovilizado_180;

CREATE POLICY rls_inmovilizado_180_select ON inmovilizado_180
    FOR SELECT TO contendo_app
    USING (empresa_id::text = current_setting('app.empresa_id', true));

CREATE POLICY rls_inmovilizado_180_insert ON inmovilizado_180
    FOR INSERT TO contendo_app
    WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true));

CREATE POLICY rls_inmovilizado_180_update ON inmovilizado_180
    FOR UPDATE TO contendo_app
    USING (empresa_id::text = current_setting('app.empresa_id', true))
    WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true));

CREATE POLICY rls_inmovilizado_180_delete ON inmovilizado_180
    FOR DELETE TO contendo_app
    USING (empresa_id::text = current_setting('app.empresa_id', true));
