-- Añadir columna es_test a factura_180 para marcar facturas de prueba VeriFactu
ALTER TABLE factura_180
ADD COLUMN IF NOT EXISTS es_test BOOLEAN DEFAULT FALSE;

-- Índice para filtrar fácilmente facturas reales vs test
CREATE INDEX IF NOT EXISTS idx_factura_180_es_test ON factura_180(es_test) WHERE es_test = true;
