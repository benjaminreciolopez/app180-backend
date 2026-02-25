-- Migración: Sistema propio de proformas
-- Fecha: 2026-02-25
-- Descripción: Añade estados ACTIVA/CONVERTIDA para proformas y columnas de trazabilidad

-- 1. Ampliar CHECK constraint de estado para incluir ACTIVA y CONVERTIDA
ALTER TABLE factura_180 DROP CONSTRAINT IF EXISTS factura_180_estado_check;
ALTER TABLE factura_180 ADD CONSTRAINT factura_180_estado_check
  CHECK (estado IN ('BORRADOR', 'VALIDADA', 'ANULADA', 'ACTIVA', 'CONVERTIDA'));

-- 2. Campo para vincular proforma reactivada con su origen
ALTER TABLE factura_180 ADD COLUMN IF NOT EXISTS proforma_origen_id INTEGER REFERENCES factura_180(id);

-- 3. Campo para vincular proforma convertida con la factura resultante
ALTER TABLE factura_180 ADD COLUMN IF NOT EXISTS factura_convertida_id INTEGER REFERENCES factura_180(id);

-- 4. Índice para búsquedas de proformas por origen
CREATE INDEX IF NOT EXISTS idx_factura_180_proforma_origen ON factura_180(proforma_origen_id) WHERE proforma_origen_id IS NOT NULL;
