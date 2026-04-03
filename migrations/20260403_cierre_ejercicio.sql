-- Cierre de Ejercicio: Fiscal Year Close module
-- Created: 2026-04-03

CREATE TABLE IF NOT EXISTS cierre_ejercicio_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  ejercicio integer NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente', -- pendiente, en_progreso, cerrado, reabierto
  -- Checklist items
  facturas_revisadas boolean DEFAULT false,
  gastos_conciliados boolean DEFAULT false,
  nominas_cerradas boolean DEFAULT false,
  amortizaciones_calculadas boolean DEFAULT false,
  modelo_303_4t_presentado boolean DEFAULT false,
  modelo_390_presentado boolean DEFAULT false,
  modelo_111_4t_presentado boolean DEFAULT false,
  modelo_115_4t_presentado boolean DEFAULT false,
  modelo_130_4t_presentado boolean DEFAULT false,
  modelo_190_presentado boolean DEFAULT false,
  modelo_180_presentado boolean DEFAULT false,
  modelo_347_presentado boolean DEFAULT false,
  modelo_349_4t_presentado boolean DEFAULT false,
  regularizacion_iva_hecha boolean DEFAULT false,
  asiento_regularizacion boolean DEFAULT false,
  asiento_cierre boolean DEFAULT false,
  asiento_apertura boolean DEFAULT false,
  resultado_ejercicio numeric,
  resultado_tipo text, -- beneficio, perdida
  -- Datos resumen
  total_ingresos numeric DEFAULT 0,
  total_gastos numeric DEFAULT 0,
  total_iva_devengado numeric DEFAULT 0,
  total_iva_soportado numeric DEFAULT 0,
  total_retenciones numeric DEFAULT 0,
  total_nominas_bruto numeric DEFAULT 0,
  total_ss_empresa numeric DEFAULT 0,
  -- Metadata
  notas text,
  cerrado_por uuid,
  cerrado_at timestamptz,
  reabierto_por uuid,
  reabierto_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(empresa_id, ejercicio)
);

-- Log de acciones del cierre
CREATE TABLE IF NOT EXISTS cierre_ejercicio_log_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cierre_id uuid NOT NULL REFERENCES cierre_ejercicio_180(id) ON DELETE CASCADE,
  accion text NOT NULL,
  detalle text,
  usuario_id uuid,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cierre_log ON cierre_ejercicio_log_180(cierre_id, created_at DESC);
