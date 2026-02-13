-- Tabla para almacenar conocimiento general y tokens para el agente IA
CREATE TABLE IF NOT EXISTS conocimiento_180 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas_180(id) ON DELETE CASCADE,
    token TEXT NOT NULL,          -- Palabra clave o frase de búsqueda
    respuesta TEXT NOT NULL,      -- Respuesta asociada al token
    categoria VARCHAR(100),       -- Categoría opcional (ej: 'horarios', 'politicas', 'productos')
    prioridad INTEGER DEFAULT 0,  -- Mayor = más relevante cuando hay múltiples matches
    activo BOOLEAN DEFAULT true,  -- Permite desactivar sin borrar
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_conocimiento_empresa ON conocimiento_180 (empresa_id);
CREATE INDEX IF NOT EXISTS idx_conocimiento_token ON conocimiento_180 (empresa_id, token);
CREATE INDEX IF NOT EXISTS idx_conocimiento_activo ON conocimiento_180 (empresa_id, activo);

-- Restricción de unicidad para el token por empresa (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conocimiento_unique_token ON conocimiento_180 (empresa_id, LOWER(token));
