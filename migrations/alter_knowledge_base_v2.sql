-- Añadir columnas nuevas a conocimiento_180 (si ya existe)
ALTER TABLE conocimiento_180 ADD COLUMN IF NOT EXISTS categoria VARCHAR(100);
ALTER TABLE conocimiento_180 ADD COLUMN IF NOT EXISTS prioridad INTEGER DEFAULT 0;
ALTER TABLE conocimiento_180 ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true;

-- Índices
CREATE INDEX IF NOT EXISTS idx_conocimiento_empresa ON conocimiento_180 (empresa_id);
CREATE INDEX IF NOT EXISTS idx_conocimiento_activo ON conocimiento_180 (empresa_id, activo);
