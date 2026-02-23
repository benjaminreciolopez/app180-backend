-- Añadir tipo de factura para soportar facturas proforma
-- Las facturas proforma NO consumen numeración ni afectan a VeriFactu

ALTER TABLE factura_180
ADD COLUMN IF NOT EXISTS tipo_factura VARCHAR(20) DEFAULT 'NORMAL' CHECK (tipo_factura IN ('NORMAL', 'PROFORMA'));

-- Actualizar facturas existentes
UPDATE factura_180
SET tipo_factura = 'NORMAL'
WHERE tipo_factura IS NULL;

-- Comentarios
COMMENT ON COLUMN factura_180.tipo_factura IS 'Tipo de factura: NORMAL (numerada, afecta VeriFactu) o PROFORMA (sin número oficial, no afecta VeriFactu)';

-- Índice para mejorar consultas
CREATE INDEX IF NOT EXISTS idx_factura_tipo ON factura_180(tipo_factura);
