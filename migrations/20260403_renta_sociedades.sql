-- Migration: Renta IRPF + Impuesto de Sociedades
-- Date: 2026-04-03

-- Renta IRPF (autonomos y personas fisicas)
CREATE TABLE IF NOT EXISTS renta_irpf_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  ejercicio integer NOT NULL,
  estado text DEFAULT 'borrador', -- borrador, en_progreso, calculado, presentado, rectificada
  -- Rendimientos actividad economica
  ingresos_actividad numeric DEFAULT 0,
  gastos_deducibles_actividad numeric DEFAULT 0,
  rendimiento_neto_actividad numeric DEFAULT 0,
  reduccion_rendimiento_irregular numeric DEFAULT 0,
  gastos_dificil_justificacion numeric DEFAULT 0, -- 7% (5% desde 2023)
  rendimiento_neto_reducido_actividad numeric DEFAULT 0,
  -- Rendimientos trabajo (si pluriactividad)
  rendimientos_trabajo numeric DEFAULT 0,
  retenciones_trabajo numeric DEFAULT 0,
  -- Rendimientos capital inmobiliario
  ingresos_alquiler numeric DEFAULT 0,
  gastos_alquiler numeric DEFAULT 0,
  rendimiento_inmobiliario numeric DEFAULT 0,
  reduccion_alquiler_vivienda numeric DEFAULT 0, -- 60% si vivienda habitual
  -- Rendimientos capital mobiliario
  intereses_cuentas numeric DEFAULT 0,
  dividendos numeric DEFAULT 0,
  otros_mobiliario numeric DEFAULT 0,
  -- Ganancias patrimoniales
  ganancias_patrimoniales numeric DEFAULT 0,
  perdidas_patrimoniales numeric DEFAULT 0,
  -- Base imponible
  base_imponible_general numeric DEFAULT 0,
  base_imponible_ahorro numeric DEFAULT 0,
  -- Reducciones
  reduccion_tributacion_conjunta numeric DEFAULT 0,
  aportaciones_planes_pensiones numeric DEFAULT 0,
  otras_reducciones numeric DEFAULT 0,
  -- Base liquidable
  base_liquidable_general numeric DEFAULT 0,
  base_liquidable_ahorro numeric DEFAULT 0,
  -- Cuota integra
  cuota_integra_estatal numeric DEFAULT 0,
  cuota_integra_autonomica numeric DEFAULT 0,
  cuota_integra_total numeric DEFAULT 0,
  -- Deducciones
  deduccion_vivienda_habitual numeric DEFAULT 0,
  deduccion_maternidad numeric DEFAULT 0,
  deduccion_familia_numerosa numeric DEFAULT 0,
  deducciones_autonomicas numeric DEFAULT 0,
  otras_deducciones numeric DEFAULT 0,
  total_deducciones numeric DEFAULT 0,
  -- Cuota diferencial
  cuota_liquida numeric DEFAULT 0,
  retenciones_pagos_cuenta numeric DEFAULT 0, -- mod 130 + retenciones recibidas
  pagos_fraccionados numeric DEFAULT 0,
  cuota_diferencial numeric DEFAULT 0, -- positivo=a pagar, negativo=a devolver
  -- Resultado
  resultado text, -- 'a_pagar', 'a_devolver', 'cero'
  importe_resultado numeric DEFAULT 0,
  -- Presentacion
  fecha_presentacion date,
  csv text,
  numero_justificante text,
  notas text,
  datos_extra jsonb, -- para datos adicionales por ejercicio
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(empresa_id, ejercicio)
);

-- Impuesto de Sociedades (mod 200)
CREATE TABLE IF NOT EXISTS impuesto_sociedades_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  ejercicio integer NOT NULL,
  estado text DEFAULT 'borrador',
  -- Cuenta de resultados
  ingresos_explotacion numeric DEFAULT 0,
  gastos_explotacion numeric DEFAULT 0,
  resultado_explotacion numeric DEFAULT 0,
  ingresos_financieros numeric DEFAULT 0,
  gastos_financieros numeric DEFAULT 0,
  resultado_financiero numeric DEFAULT 0,
  resultado_antes_impuestos numeric DEFAULT 0,
  -- Ajustes extracontables
  ajustes_positivos numeric DEFAULT 0,
  ajustes_negativos numeric DEFAULT 0,
  detalle_ajustes jsonb,
  -- Base imponible
  base_imponible_previa numeric DEFAULT 0,
  compensacion_bin numeric DEFAULT 0, -- bases imponibles negativas anteriores
  base_imponible numeric DEFAULT 0,
  -- Tipo y cuota
  tipo_gravamen numeric DEFAULT 25, -- 25% general, 15% nuevas empresas, 23% pymes
  tipo_aplicado text DEFAULT 'general', -- general, reducido_pyme, reducido_nueva_empresa, microempresa
  cuota_integra numeric DEFAULT 0,
  -- Deducciones
  deduccion_doble_imposicion numeric DEFAULT 0,
  deducciones_id numeric DEFAULT 0, -- I+D
  bonificaciones numeric DEFAULT 0,
  otras_deducciones numeric DEFAULT 0,
  total_deducciones numeric DEFAULT 0,
  -- Cuota liquida y pagos a cuenta
  cuota_liquida numeric DEFAULT 0,
  retenciones numeric DEFAULT 0,
  pagos_fraccionados numeric DEFAULT 0, -- mod 202
  cuota_diferencial numeric DEFAULT 0,
  -- Resultado
  resultado text,
  importe_resultado numeric DEFAULT 0,
  -- Presentacion
  fecha_limite date, -- 25 julio (6 meses despues cierre ejercicio)
  fecha_presentacion date,
  csv text,
  numero_justificante text,
  notas text,
  datos_extra jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(empresa_id, ejercicio)
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_renta_irpf_empresa ON renta_irpf_180(empresa_id);
CREATE INDEX IF NOT EXISTS idx_renta_irpf_ejercicio ON renta_irpf_180(ejercicio);
CREATE INDEX IF NOT EXISTS idx_renta_irpf_estado ON renta_irpf_180(estado);
CREATE INDEX IF NOT EXISTS idx_is_empresa ON impuesto_sociedades_180(empresa_id);
CREATE INDEX IF NOT EXISTS idx_is_ejercicio ON impuesto_sociedades_180(ejercicio);
CREATE INDEX IF NOT EXISTS idx_is_estado ON impuesto_sociedades_180(estado);
