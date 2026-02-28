-- Migración: Sistema de entrega y firma de nóminas
-- Fecha: 2026-02-28

-- 1. Columna estado_entrega en nominas_180
ALTER TABLE nominas_180 ADD COLUMN IF NOT EXISTS estado_entrega VARCHAR(20) DEFAULT 'borrador';
-- Valores: borrador | enviada | recibida | firmada

-- 2. Tabla nomina_entregas_180 (tracking de entregas y firmas)
CREATE TABLE IF NOT EXISTS nomina_entregas_180 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomina_id UUID NOT NULL REFERENCES nominas_180(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL,
  empleado_id UUID NOT NULL REFERENCES employees_180(id),
  estado VARCHAR(20) NOT NULL DEFAULT 'enviada',
  fecha_envio TIMESTAMPTZ DEFAULT NOW(),
  fecha_recepcion TIMESTAMPTZ,
  fecha_firma TIMESTAMPTZ,
  metodo_envio VARCHAR(10) DEFAULT 'app',
  email_enviado_a TEXT,
  comentario_empleado TEXT,
  ip_firma TEXT,
  hash_firma TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. RLS
ALTER TABLE nomina_entregas_180 ENABLE ROW LEVEL SECURITY;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_nomina_entregas_nomina ON nomina_entregas_180(nomina_id);
CREATE INDEX IF NOT EXISTS idx_nomina_entregas_emp ON nomina_entregas_180(empleado_id, empresa_id);
