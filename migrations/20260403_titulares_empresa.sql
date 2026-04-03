-- Titulares/socios de una empresa (pueden ser múltiples)
CREATE TABLE IF NOT EXISTS titulares_empresa_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees_180(id),
  nombre text NOT NULL,
  nif text,
  porcentaje_participacion numeric DEFAULT 100,
  es_administrador boolean DEFAULT false,
  regimen_ss text NOT NULL DEFAULT 'autonomo', -- 'autonomo', 'general', 'sin_regimen'
  fecha_alta_ss date,
  fecha_baja_ss date,
  activo boolean DEFAULT true,
  notas text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_titulares_empresa ON titulares_empresa_180(empresa_id);

-- Alter RETA profile to optionally link to a titular instead of only empresa
-- This allows tracking RETA per-person when multiple titulares exist
ALTER TABLE reta_autonomo_perfil_180
  ADD COLUMN IF NOT EXISTS titular_id uuid REFERENCES titulares_empresa_180(id);

ALTER TABLE reta_estimaciones_180
  ADD COLUMN IF NOT EXISTS titular_id uuid REFERENCES titulares_empresa_180(id);

ALTER TABLE reta_cambios_base_180
  ADD COLUMN IF NOT EXISTS titular_id uuid REFERENCES titulares_empresa_180(id);

ALTER TABLE reta_eventos_180
  ADD COLUMN IF NOT EXISTS titular_id uuid REFERENCES titulares_empresa_180(id);

ALTER TABLE reta_alertas_180
  ADD COLUMN IF NOT EXISTS titular_id uuid REFERENCES titulares_empresa_180(id);
