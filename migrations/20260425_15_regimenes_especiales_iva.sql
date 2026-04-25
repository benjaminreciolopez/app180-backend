-- Sprint 3F: regímenes especiales IVA (agricultura/ganadería/pesca y simplificado/módulos).
--
-- REAGP (Arts. 124-134 LIVA): el autónomo NO repercute IVA en sus ventas; en
-- su lugar percibe una compensación a tanto alzado del cliente (12% para
-- agricultura/forestal, 10,5% para ganadería/pesca). No presenta modelo 303
-- de actividad ordinaria (Art. 47.4 RGAT).
--
-- Régimen simplificado (Arts. 122-123 LIVA): cuotas devengadas se calculan
-- por módulos (Anexo II Orden HFP anual). Deducible se calcula como 1% del
-- IVA devengado (gastos de difícil justificación). Se paga en cada
-- trimestre 1/4 de la cuota anual fija, regularizando en 4T.
--
-- Estructura del JSONB modulos_simplificado:
-- {
--   "actividad": "Comercio menor",
--   "epigrafe_iae": "651.1",
--   "cuota_devengada_anual": 1200,
--   "cuota_minima_anual": 0,
--   "modulos": [
--     { "nombre": "Personal asalariado", "unidades": 1, "importe_unidad": 600 },
--     { "nombre": "Superficie m2", "unidades": 50, "importe_unidad": 12 }
--   ]
-- }

-- 1. Extender CHECK constraint de regimen_iva para incluir REAGP y simplificado.
ALTER TABLE emisor_180 DROP CONSTRAINT IF EXISTS emisor_180_regimen_iva_chk;

ALTER TABLE emisor_180
    ADD CONSTRAINT emisor_180_regimen_iva_chk
    CHECK (regimen_iva IN ('general', 'criterio_caja', 'agricultura', 'simplificado'));

-- 2. Datos del régimen simplificado por empresa (módulos calculados manualmente
--    por el asesor según la Orden HFP del ejercicio). NULL si no aplica.
ALTER TABLE emisor_180
    ADD COLUMN IF NOT EXISTS modulos_simplificado JSONB;

-- 3. Tipo de compensación REAGP (12% agrícola/forestal o 10,5% ganadería/pesca).
ALTER TABLE emisor_180
    ADD COLUMN IF NOT EXISTS compensacion_reagp_pct NUMERIC(4,2);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'emisor_180_compensacion_reagp_chk'
    ) THEN
        ALTER TABLE emisor_180
            ADD CONSTRAINT emisor_180_compensacion_reagp_chk
            CHECK (compensacion_reagp_pct IS NULL OR compensacion_reagp_pct IN (10.5, 12.0));
    END IF;
END $$;
