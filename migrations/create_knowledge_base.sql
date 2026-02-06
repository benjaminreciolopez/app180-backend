-- Tabla para almacenar conocimiento general y tokens para el agente IA
CREATE TABLE IF NOT EXISTS conocimiento_180 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL, -- Para mantener el conocimiento aislado por empresa
    token TEXT NOT NULL,      -- La palabra clave, pregunta o "token" de búsqueda
    respuesta TEXT NOT NULL,  -- La información o respuesta asociada
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsquedas rápidas (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_conocimiento_token ON conocimiento_180 (empresa_id, token);
