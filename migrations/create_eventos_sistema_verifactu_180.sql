-- Tabla de Registro de Eventos del Sistema (Requisito RD 1007/2023)
-- Registra todos los eventos del sistema: inicio, parada, cambios de modo, etc.

CREATE TABLE IF NOT EXISTS eventos_sistema_verifactu_180 (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,

  -- Tipo de evento
  tipo_evento VARCHAR(50) NOT NULL CHECK (tipo_evento IN (
    'INICIO_SISTEMA',           -- Sistema iniciado
    'PARADA_SISTEMA',           -- Sistema detenido
    'CAMBIO_MODO',              -- Cambio TEST <-> PRODUCCION
    'ACTIVACION_VERIFACTU',     -- VeriFactu activado
    'DESACTIVACION_VERIFACTU',  -- VeriFactu desactivado (bloqueado si hay facturas)
    'DESCARGA_REGISTROS',       -- Volcado/descarga de registros
    'RESTAURACION_BACKUP',      -- Restauración desde backup
    'INCIDENCIA',               -- Error o incidencia del sistema
    'ENVIO_AEAT',               -- Envío de registros a AEAT
    'CONFIGURACION',            -- Cambio de configuración
    'MANTENIMIENTO'             -- Operación de mantenimiento
  )),

  -- Descripción del evento
  descripcion TEXT NOT NULL,

  -- Datos adicionales del evento (JSON)
  datos_evento JSONB DEFAULT '{}',

  -- Usuario que generó el evento (si aplica)
  usuario_id INTEGER REFERENCES users_180(id) ON DELETE SET NULL,

  -- Timestamp del evento
  fecha_evento TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Hash encadenado (SHA-256)
  hash_actual VARCHAR(64) NOT NULL,
  hash_anterior VARCHAR(64) DEFAULT '',

  -- Metadatos
  ip_address VARCHAR(45),
  user_agent TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_eventos_sistema_empresa_fecha ON eventos_sistema_verifactu_180(empresa_id, fecha_evento DESC);
CREATE INDEX idx_eventos_sistema_tipo ON eventos_sistema_verifactu_180(tipo_evento);
CREATE INDEX idx_eventos_sistema_hash ON eventos_sistema_verifactu_180(hash_actual);

-- RLS (Row Level Security)
ALTER TABLE eventos_sistema_verifactu_180 ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios solo pueden ver eventos de su empresa
CREATE POLICY eventos_sistema_select_policy ON eventos_sistema_verifactu_180
  FOR SELECT
  USING (
    empresa_id IN (
      SELECT e.id FROM empresa_180 e
      WHERE e.user_id = current_setting('app.user_id', true)::integer
    )
  );

-- Política: Solo el sistema puede insertar eventos (a través de función)
CREATE POLICY eventos_sistema_insert_policy ON eventos_sistema_verifactu_180
  FOR INSERT
  WITH CHECK (true); -- Se controla por función

-- Política: NO se puede actualizar ni eliminar (inmutabilidad)
CREATE POLICY eventos_sistema_update_policy ON eventos_sistema_verifactu_180
  FOR UPDATE
  USING (false);

CREATE POLICY eventos_sistema_delete_policy ON eventos_sistema_verifactu_180
  FOR DELETE
  USING (false);

-- Comentarios
COMMENT ON TABLE eventos_sistema_verifactu_180 IS 'Registro de eventos del sistema VeriFactu (RD 1007/2023). Inmutable y encadenado con hash SHA-256.';
COMMENT ON COLUMN eventos_sistema_verifactu_180.hash_actual IS 'Hash SHA-256 de este evento';
COMMENT ON COLUMN eventos_sistema_verifactu_180.hash_anterior IS 'Hash del evento anterior (encadenamiento)';
