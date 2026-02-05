-- Tabla para memoria de conversaciones de CONTENDO
CREATE TABLE IF NOT EXISTS contendo_memory_180 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas_180(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users_180(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,
  mensaje TEXT NOT NULL,
  respuesta TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Índices para búsqueda rápida
  CONSTRAINT fk_empresa FOREIGN KEY (empresa_id) REFERENCES empresas_180(id),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users_180(id)
);

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_contendo_memory_empresa ON contendo_memory_180(empresa_id);
CREATE INDEX IF NOT EXISTS idx_contendo_memory_user ON contendo_memory_180(user_id);
CREATE INDEX IF NOT EXISTS idx_contendo_memory_created ON contendo_memory_180(created_at DESC);

-- Comentarios
COMMENT ON TABLE contendo_memory_180 IS 'Historial de conversaciones con CONTENDO para contexto persistente';
COMMENT ON COLUMN contendo_memory_180.metadata IS 'Metadata adicional: tokens usados, herramientas llamadas, etc.';
