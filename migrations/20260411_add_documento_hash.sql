-- Añadir hash de documento para detección de duplicados sin coste de IA
ALTER TABLE purchases_180 ADD COLUMN IF NOT EXISTS documento_hash VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_purchases_documento_hash ON purchases_180(empresa_id, documento_hash) WHERE documento_hash IS NOT NULL AND activo = true;
