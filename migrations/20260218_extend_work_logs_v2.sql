-- Migración para ampliar los campos de trabajos en Contendo
-- Fecha: 2026-02-18

ALTER TABLE work_logs_180 ADD COLUMN IF NOT EXISTS concepto_facturacion VARCHAR(255);
-- El campo detalles ya existe por la migración 006, pero nos aseguramos
ALTER TABLE work_logs_180 ADD COLUMN IF NOT EXISTS detalles TEXT;

COMMENT ON COLUMN work_logs_180.concepto_facturacion IS 'Descripción corta para facturación';
COMMENT ON COLUMN work_logs_180.detalles IS 'Detalles técnicos o adicionales del trabajo';
