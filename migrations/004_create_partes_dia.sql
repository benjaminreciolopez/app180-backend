CREATE TABLE IF NOT EXISTS partes_dia_180 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES employees_180(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES clients_180(id) ON DELETE SET NULL,
  fecha DATE NOT NULL,
  
  horas_trabajadas NUMERIC(5, 2),
  resumen TEXT,
  
  estado TEXT, -- 'completo', 'abierto', 'incidencia', 'incompleto', etc.
  
  validado BOOLEAN DEFAULT NULL, -- NULL=pendiente, true=valid, false=incidencia
  validado_at TIMESTAMPTZ,
  nota_admin TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Un parte por empleado por día
  UNIQUE(empresa_id, empleado_id, fecha)
);

-- Indices para busqueda rápida
CREATE INDEX IF NOT EXISTS idx_partes_dia_fecha ON partes_dia_180(fecha);
CREATE INDEX IF NOT EXISTS idx_partes_dia_empresa ON partes_dia_180(empresa_id);
