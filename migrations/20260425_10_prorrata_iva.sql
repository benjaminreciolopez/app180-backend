-- Sprint 3B: pro-rata IVA general para actividades mixtas (Art. 102 LIVA).
--
-- Cuando un sujeto pasivo realiza simultáneamente operaciones con y sin
-- derecho a deducción, el IVA soportado solo es deducible en el porcentaje
-- que represente el volumen de operaciones con derecho sobre el total.
--
-- Por defecto 100 (todas las operaciones generan derecho a deducción).
-- El gestor configura este % en el panel de empresa cuando aplica.

ALTER TABLE emisor_180
    ADD COLUMN IF NOT EXISTS prorrata_iva_pct NUMERIC(5,2) NOT NULL DEFAULT 100;

ALTER TABLE emisor_180
    ADD COLUMN IF NOT EXISTS prorrata_iva_definitivo NUMERIC(5,2);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'emisor_180_prorrata_pct_chk'
    ) THEN
        ALTER TABLE emisor_180
            ADD CONSTRAINT emisor_180_prorrata_pct_chk
            CHECK (prorrata_iva_pct >= 0 AND prorrata_iva_pct <= 100);
    END IF;
END $$;
