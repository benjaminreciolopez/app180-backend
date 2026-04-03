-- Migration: Laboral Profesional module
-- Date: 2026-04-03
-- Tables: contratos_180, bajas_laborales_180, certificados_empresa_180, cotizaciones_ss_180

-- Contratos laborales
CREATE TABLE IF NOT EXISTS contratos_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees_180(id) ON DELETE CASCADE,
  tipo_contrato text NOT NULL, -- indefinido, temporal, formacion, practicas, obra_servicio, interinidad, relevo, discontinuo
  codigo_contrato text, -- codigo oficial SEPE (100, 200, 401, etc.)
  jornada text DEFAULT 'completa', -- completa, parcial, reducida
  horas_semanales numeric DEFAULT 40,
  fecha_inicio date NOT NULL,
  fecha_fin date, -- null = indefinido
  fecha_fin_prevista date,
  periodo_prueba_dias integer,
  periodo_prueba_fin date,
  salario_bruto_anual numeric,
  salario_bruto_mensual numeric,
  num_pagas integer DEFAULT 14,
  convenio_colectivo text,
  categoria_profesional text,
  grupo_cotizacion integer, -- 1-11
  epigrafes_at text, -- epigrafe accidentes trabajo
  coeficiente_parcialidad numeric, -- % for parcial
  es_bonificado boolean DEFAULT false,
  tipo_bonificacion text,
  importe_bonificacion numeric,
  estado text DEFAULT 'vigente', -- vigente, finalizado, extinguido, suspendido
  motivo_extincion text,
  fecha_extincion date,
  notas text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contratos_empresa ON contratos_180(empresa_id, employee_id);

-- Bajas laborales (IT, maternidad, etc.)
CREATE TABLE IF NOT EXISTS bajas_laborales_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees_180(id),
  contrato_id uuid REFERENCES contratos_180(id),
  tipo_baja text NOT NULL, -- enfermedad_comun, accidente_laboral, accidente_no_laboral, enfermedad_profesional, maternidad, paternidad, riesgo_embarazo
  fecha_inicio date NOT NULL,
  fecha_fin date,
  fecha_alta_medica date,
  diagnostico text,
  codigo_diagnostico text,
  dias_totales integer,
  -- Prestacion
  base_reguladora numeric,
  porcentaje_prestacion numeric, -- 60% primeros 20 dias, 75% despues (enfermedad comun)
  importe_diario numeric,
  pagador text DEFAULT 'empresa', -- empresa (primeros 15 dias), inss, mutua
  mutua text,
  -- Control
  parte_confirmacion_fecha date,
  siguiente_revision date,
  estado text DEFAULT 'activa', -- activa, alta_medica, cerrada
  notas text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Certificados de empresa (para SEPE cuando termina un contrato)
CREATE TABLE IF NOT EXISTS certificados_empresa_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees_180(id),
  contrato_id uuid REFERENCES contratos_180(id),
  tipo text NOT NULL, -- certificado_empresa_sepe, vida_laboral, certificado_retenciones
  fecha_generacion date DEFAULT CURRENT_DATE,
  datos jsonb, -- datos del certificado
  estado text DEFAULT 'borrador', -- borrador, generado, entregado
  notas text,
  created_at timestamptz DEFAULT now()
);

-- Cotizaciones SS detalladas por trabajador/mes
CREATE TABLE IF NOT EXISTS cotizaciones_ss_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees_180(id),
  contrato_id uuid REFERENCES contratos_180(id),
  periodo_mes integer NOT NULL, -- 1-12
  periodo_anio integer NOT NULL,
  base_contingencias_comunes numeric NOT NULL,
  base_accidentes_trabajo numeric,
  base_horas_extra_fuerza_mayor numeric DEFAULT 0,
  base_horas_extra_resto numeric DEFAULT 0,
  -- Cuotas empresa
  cuota_empresa_cc numeric, -- contingencias comunes 23.60%
  cuota_empresa_desempleo numeric,
  cuota_empresa_fogasa numeric, -- 0.20%
  cuota_empresa_fp numeric, -- formacion prof 0.60%
  cuota_empresa_at numeric, -- accidentes trabajo (variable por CNAE)
  cuota_empresa_mep numeric DEFAULT 0, -- mecanismo equidad intergeneracional
  total_cuota_empresa numeric,
  -- Cuotas trabajador
  cuota_trabajador_cc numeric, -- 4.70%
  cuota_trabajador_desempleo numeric,
  cuota_trabajador_fp numeric, -- 0.10%
  cuota_trabajador_mep numeric DEFAULT 0,
  total_cuota_trabajador numeric,
  -- Total
  total_cotizacion numeric,
  -- Metadata
  estado text DEFAULT 'calculado', -- calculado, pagado, rectificado
  created_at timestamptz DEFAULT now(),
  UNIQUE(empresa_id, employee_id, periodo_mes, periodo_anio)
);
