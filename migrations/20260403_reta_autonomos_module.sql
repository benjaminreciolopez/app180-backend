-- ============================================================
-- MODULO RETA: Estimacion Base de Cotizacion para Autonomos
-- Fecha: 2026-04-03
-- ============================================================

-- 1. Tramos RETA por ejercicio
CREATE TABLE IF NOT EXISTS reta_tramos_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ejercicio integer NOT NULL,
  tramo_num integer NOT NULL,
  rend_neto_mensual_min numeric NOT NULL,
  rend_neto_mensual_max numeric,
  base_min numeric NOT NULL,
  base_max numeric NOT NULL,
  tipo_cotizacion numeric NOT NULL DEFAULT 31.20,
  activo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(ejercicio, tramo_num)
);

-- 2. Perfil RETA del autonomo (uno por empresa/ejercicio)
CREATE TABLE IF NOT EXISTS reta_autonomo_perfil_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  ejercicio integer NOT NULL,
  es_societario boolean DEFAULT false,
  es_pluriactividad boolean DEFAULT false,
  regimen_estimacion text DEFAULT 'directa_simplificada',
  tarifa_plana_activa boolean DEFAULT false,
  tarifa_plana_inicio date,
  tarifa_plana_fin date,
  tarifa_plana_importe numeric DEFAULT 80,
  base_cotizacion_actual numeric,
  tramo_actual integer,
  cuota_mensual_actual numeric,
  perfil_estacionalidad text DEFAULT 'regular',
  meses_baja_actividad integer[],
  sector_actividad text,
  epigrafes_iae text[],
  discapacidad_pct integer DEFAULT 0,
  notas text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(empresa_id, ejercicio)
);

-- 3. Estimaciones periodicas (snapshots de calculo)
CREATE TABLE IF NOT EXISTS reta_estimaciones_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  ejercicio integer NOT NULL,
  fecha_calculo timestamptz DEFAULT now(),
  ingresos_reales_ytd numeric DEFAULT 0,
  gastos_reales_ytd numeric DEFAULT 0,
  nominas_reales_ytd numeric DEFAULT 0,
  metodo_proyeccion text NOT NULL,
  ingresos_proyectados_anual numeric NOT NULL,
  gastos_proyectados_anual numeric NOT NULL,
  rendimiento_neto_anual numeric NOT NULL,
  deduccion_gastos_dificil numeric NOT NULL,
  rendimiento_neto_reducido numeric NOT NULL,
  rendimiento_neto_mensual numeric NOT NULL,
  tramo_recomendado integer NOT NULL,
  base_recomendada numeric NOT NULL,
  cuota_recomendada numeric NOT NULL,
  base_actual numeric,
  cuota_actual numeric,
  diferencia_mensual numeric,
  riesgo_regularizacion_anual numeric,
  confianza_pct integer,
  meses_datos_reales integer,
  escenario_optimista jsonb,
  escenario_pesimista jsonb,
  ajustes_manuales jsonb,
  creado_por uuid,
  tipo_creador text DEFAULT 'system',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reta_est_empresa ON reta_estimaciones_180(empresa_id, ejercicio, fecha_calculo DESC);

-- 4. Historial de cambios de base
CREATE TABLE IF NOT EXISTS reta_cambios_base_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  ejercicio integer NOT NULL,
  base_anterior numeric NOT NULL,
  base_nueva numeric NOT NULL,
  tramo_anterior integer,
  tramo_nuevo integer,
  fecha_efectiva date NOT NULL,
  fecha_solicitud date NOT NULL,
  fecha_limite_solicitud date NOT NULL,
  estado text DEFAULT 'pendiente',
  motivo text,
  estimacion_id uuid REFERENCES reta_estimaciones_180(id),
  solicitado_por uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 5. Eventos que afectan proyecciones
CREATE TABLE IF NOT EXISTS reta_eventos_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  ejercicio integer NOT NULL,
  tipo text NOT NULL,
  fecha_inicio date NOT NULL,
  fecha_fin date,
  impacto_ingresos numeric DEFAULT 0,
  impacto_gastos numeric DEFAULT 0,
  descripcion text,
  datos_extra jsonb,
  activo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reta_eventos_empresa ON reta_eventos_180(empresa_id, ejercicio);

-- 6. Pre-onboarding: estimacion antes de facturar
CREATE TABLE IF NOT EXISTS reta_pre_onboarding_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid REFERENCES empresa_180(id),
  asesoria_id uuid NOT NULL,
  nombre_prospecto text NOT NULL,
  nif text,
  actividad_tipo text,
  sector text,
  epigrafes_iae text[],
  ingresos_mensuales_estimados numeric,
  gastos_fijos_mensuales numeric,
  gastos_variables_pct numeric,
  tiene_empleados boolean DEFAULT false,
  coste_empleados_mensual numeric DEFAULT 0,
  tiene_local boolean DEFAULT false,
  alquiler_mensual numeric DEFAULT 0,
  ha_sido_autonomo_antes boolean DEFAULT false,
  fecha_ultimo_alta date,
  rendimiento_neto_anterior numeric,
  elegible_tarifa_plana boolean,
  resultado_optimista jsonb,
  resultado_realista jsonb,
  resultado_pesimista jsonb,
  tramo_recomendado integer,
  base_recomendada numeric,
  cuota_estimada numeric,
  estado text DEFAULT 'borrador',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 7. Alertas RETA
CREATE TABLE IF NOT EXISTS reta_alertas_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  ejercicio integer NOT NULL,
  tipo text NOT NULL,
  severidad text NOT NULL,
  titulo text NOT NULL,
  mensaje text NOT NULL,
  datos jsonb,
  leida boolean DEFAULT false,
  descartada boolean DEFAULT false,
  accion_tomada text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reta_alertas_empresa ON reta_alertas_180(empresa_id, ejercicio);

-- ============================================================
-- SEED: Tramos RETA 2025 (RDL 13/2022, tabla transitoria)
-- ============================================================
INSERT INTO reta_tramos_180 (ejercicio, tramo_num, rend_neto_mensual_min, rend_neto_mensual_max, base_min, base_max, tipo_cotizacion)
VALUES
  (2025, 1,  0,       670,     653.59,  718.95,  31.20),
  (2025, 2,  670.01,  900,     718.95,  900.00,  31.20),
  (2025, 3,  900.01,  1166.70, 872.55,  1166.70, 31.20),
  (2025, 4,  1166.71, 1300,    950.98,  1300.00, 31.20),
  (2025, 5,  1300.01, 1500,    960.78,  1500.00, 31.20),
  (2025, 6,  1500.01, 1700,    960.78,  1700.00, 31.20),
  (2025, 7,  1700.01, 1850,    1013.07, 1850.00, 31.20),
  (2025, 8,  1850.01, 2030,    1029.41, 2030.00, 31.20),
  (2025, 9,  2030.01, 2330,    1045.75, 2330.00, 31.20),
  (2025, 10, 2330.01, 2760,    1062.09, 2760.00, 31.20),
  (2025, 11, 2760.01, 3190,    1078.43, 3190.00, 31.20),
  (2025, 12, 3190.01, 3620,    1111.11, 3620.00, 31.20),
  (2025, 13, 3620.01, 4050,    1176.47, 4050.00, 31.20),
  (2025, 14, 4050.01, 6000,    1274.51, 4139.40, 31.20),
  (2025, 15, 6000.01, NULL,    1372.55, 4139.40, 31.20)
ON CONFLICT (ejercicio, tramo_num) DO NOTHING;

-- ============================================================
-- SEED: Tramos RETA 2026 (tabla transitoria, mismos valores que 2025 hasta publicacion BOE)
-- ============================================================
INSERT INTO reta_tramos_180 (ejercicio, tramo_num, rend_neto_mensual_min, rend_neto_mensual_max, base_min, base_max, tipo_cotizacion)
VALUES
  (2026, 1,  0,       670,     653.59,  718.95,  31.20),
  (2026, 2,  670.01,  900,     718.95,  900.00,  31.20),
  (2026, 3,  900.01,  1166.70, 872.55,  1166.70, 31.20),
  (2026, 4,  1166.71, 1300,    950.98,  1300.00, 31.20),
  (2026, 5,  1300.01, 1500,    960.78,  1500.00, 31.20),
  (2026, 6,  1500.01, 1700,    960.78,  1700.00, 31.20),
  (2026, 7,  1700.01, 1850,    1013.07, 1850.00, 31.20),
  (2026, 8,  1850.01, 2030,    1029.41, 2030.00, 31.20),
  (2026, 9,  2030.01, 2330,    1045.75, 2330.00, 31.20),
  (2026, 10, 2330.01, 2760,    1062.09, 2760.00, 31.20),
  (2026, 11, 2760.01, 3190,    1078.43, 3190.00, 31.20),
  (2026, 12, 3190.01, 3620,    1111.11, 3620.00, 31.20),
  (2026, 13, 3620.01, 4050,    1176.47, 4050.00, 31.20),
  (2026, 14, 4050.01, 6000,    1274.51, 4139.40, 31.20),
  (2026, 15, 6000.01, NULL,    1372.55, 4139.40, 31.20)
ON CONFLICT (ejercicio, tramo_num) DO NOTHING;
