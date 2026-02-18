-- Migración para Nivel Dios: Gastos (OCR) y Cobros Directos
-- Fecha: 2026-02-18

-- 1. Ampliar tabla de compras/gastos
ALTER TABLE purchases_180 ADD COLUMN IF NOT EXISTS base_imponible NUMERIC(15,2);
ALTER TABLE purchases_180 ADD COLUMN IF NOT EXISTS iva_importe NUMERIC(15,2);
ALTER TABLE purchases_180 ADD COLUMN IF NOT EXISTS iva_porcentaje NUMERIC(5,2);
ALTER TABLE purchases_180 ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(50);
ALTER TABLE purchases_180 ADD COLUMN IF NOT EXISTS documento_url TEXT;
ALTER TABLE purchases_180 ADD COLUMN IF NOT EXISTS ocr_data JSONB;

COMMENT ON COLUMN purchases_180.base_imponible IS 'Base imponible extraída o calculada';
COMMENT ON COLUMN purchases_180.documento_url IS 'URL del ticket o factura escaneada';

-- 2. Ampliar tabla de trabajos para flujo de cobro directo
ALTER TABLE work_logs_180 ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(20) DEFAULT 'pendiente';
ALTER TABLE work_logs_180 ADD COLUMN IF NOT EXISTS metodo_pago_directo VARCHAR(50);
ALTER TABLE work_logs_180 ADD COLUMN IF NOT EXISTS pagado_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN work_logs_180.estado_pago IS 'Estado de cobro: pendiente, pagado (sin factura), facturado';

-- 3. Crear índices para reportes de beneficio
CREATE INDEX IF NOT EXISTS idx_purchases_empresa_fecha ON purchases_180(empresa_id, fecha_compra);
CREATE INDEX IF NOT EXISTS idx_work_logs_pago ON work_logs_180(empresa_id, estado_pago);
