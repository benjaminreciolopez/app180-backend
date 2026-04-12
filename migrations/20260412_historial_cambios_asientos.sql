-- Historial de cambios aplicados a asientos contables por la IA o manualmente
CREATE TABLE IF NOT EXISTS historial_cambios_asientos_180 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  asiento_id UUID NOT NULL,
  asiento_numero INTEGER,
  asiento_concepto TEXT,
  linea_id UUID,
  tipo_cambio VARCHAR(30) NOT NULL,  -- 'cuenta_corregida', 'revisado_usuario', 'revisado_ia'
  cuenta_anterior_codigo VARCHAR(20),
  cuenta_anterior_nombre VARCHAR(255),
  cuenta_nueva_codigo VARCHAR(20),
  cuenta_nueva_nombre VARCHAR(255),
  importe NUMERIC(15,2),
  realizado_por UUID,       -- user id que aprobo el cambio
  origen VARCHAR(20) DEFAULT 'ia_revision',  -- 'ia_revision', 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historial_cambios_empresa ON historial_cambios_asientos_180(empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historial_cambios_asiento ON historial_cambios_asientos_180(asiento_id);
