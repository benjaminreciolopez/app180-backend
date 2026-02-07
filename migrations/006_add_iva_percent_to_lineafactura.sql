-- Agregar columna iva_percent a lineafactura_180
-- Esta columna permite que cada línea tenga su propio porcentaje de IVA

ALTER TABLE lineafactura_180
ADD COLUMN IF NOT EXISTS iva_percent NUMERIC(5,2) DEFAULT 0.00;

COMMENT ON COLUMN lineafactura_180.iva_percent IS 'Porcentaje de IVA aplicado a esta línea (puede variar por línea)';
