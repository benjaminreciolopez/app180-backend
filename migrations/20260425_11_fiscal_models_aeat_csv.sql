-- Sprint 3C: persistir el CSV de respuesta de AEAT para presentaciones telemáticas.
-- Cuando una presentación se acepta, AEAT devuelve un Código Seguro de Verificación
-- (CSV) que sirve como justificante. Lo almacenamos para auditoría y para enlazar
-- con los recibos descargables.

ALTER TABLE fiscal_models_180
    ADD COLUMN IF NOT EXISTS aeat_csv TEXT;

CREATE INDEX IF NOT EXISTS idx_fiscal_models_aeat_csv
    ON fiscal_models_180 (aeat_csv)
    WHERE aeat_csv IS NOT NULL;
