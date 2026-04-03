-- Migration: modelos_anuales_180
-- Tabla para tracking de modelos anuales AEAT (390, 190, 180, 347, 349_anual)

CREATE TABLE IF NOT EXISTS modelos_anuales_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  ejercicio integer NOT NULL,
  modelo text NOT NULL, -- '390', '190', '180', '347', '349_anual'
  estado text NOT NULL DEFAULT 'pendiente', -- pendiente, en_progreso, calculado, presentado, rectificado
  -- Datos calculados (JSONB para flexibilidad por modelo)
  datos_calculados jsonb,
  -- Resumen rapido
  total_base_imponible numeric,
  total_cuota numeric,
  total_operaciones numeric,
  numero_registros integer DEFAULT 0,
  -- Presentacion
  fecha_limite date,
  fecha_presentacion date,
  csv_presentacion text, -- codigo seguro verificacion
  numero_justificante text,
  presentado_por uuid,
  -- Metadata
  notas text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(empresa_id, ejercicio, modelo)
);

CREATE INDEX IF NOT EXISTS idx_modelos_anuales_empresa ON modelos_anuales_180(empresa_id, ejercicio);
CREATE INDEX IF NOT EXISTS idx_modelos_anuales_estado ON modelos_anuales_180(estado);
