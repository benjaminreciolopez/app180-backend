-- Up Migration

-- 1. Add fiscal fields to purchases_180
ALTER TABLE purchases_180
ADD COLUMN IF NOT EXISTS iva_porcentaje numeric DEFAULT 21,
ADD COLUMN IF NOT EXISTS base_imponible numeric,
ADD COLUMN IF NOT EXISTS cuota_iva numeric,
ADD COLUMN IF NOT EXISTS tipo_gasto text DEFAULT 'CORRIENTE'; -- CORRIENTE, INVERSION, SUPLIDO

-- Update existing rows (assuming 21% VAT and total includes VAT)
-- base = total / 1.21
-- cuota = total - base
UPDATE purchases_180
SET 
  base_imponible = ROUND(total / 1.21, 2),
  cuota_iva = total - ROUND(total / 1.21, 2),
  iva_porcentaje = 21
WHERE base_imponible IS NULL AND total IS NOT NULL;


-- 2. Create nominas_180 table
CREATE TABLE IF NOT EXISTS nominas_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id),
  empleado_id uuid REFERENCES employees_180(id), -- Optional, can be NULL for generic payroll entry
  anio integer NOT NULL,
  mes integer NOT NULL,
  bruto numeric NOT NULL DEFAULT 0,
  seguridad_social_empresa numeric NOT NULL DEFAULT 0, -- Coste empresa
  seguridad_social_empleado numeric NOT NULL DEFAULT 0, -- A cargo del empleado (se resta del bruto)
  irpf_retencion numeric NOT NULL DEFAULT 0,
  liquido numeric NOT NULL DEFAULT 0, -- A pagar
  pdf_path text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  CONSTRAINT nominas_anio_check CHECK (anio >= 2000 AND anio <= 2100),
  CONSTRAINT nominas_mes_check CHECK (mes >= 1 AND mes <= 12)
);

-- 3. Create fiscal_models_180 table
CREATE TABLE IF NOT EXISTS fiscal_models_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id),
  modelo text NOT NULL, -- '303', '130', '111', etc.
  ejercicio integer NOT NULL,
  periodo text NOT NULL, -- '1T', '2T', '3T', '4T', '01'...'12', 'OA' (Anual)
  estado text NOT NULL DEFAULT 'BORRADOR', -- BORRADOR, GENERADO, PRESENTADO, ERROR
  resultado_tipo text, -- 'INGRESAR', 'DEVOLVER', 'COMPENSAR', 'NEGATIVA'
  resultado_importe numeric,
  datos_json jsonb, -- The calculated data used to generate the model
  aeat_respuesta_json jsonb, -- The response from AEAT (CSV/XML)
  pdf_path text,
  csv_path text,
  presentado_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Down Migration
-- ALTER TABLE purchases_180 DROP COLUMN IF EXISTS iva_porcentaje;
-- ALTER TABLE purchases_180 DROP COLUMN IF EXISTS base_imponible;
-- ALTER TABLE purchases_180 DROP COLUMN IF EXISTS cuota_iva;
-- ALTER TABLE purchases_180 DROP COLUMN IF EXISTS tipo_gasto;
-- DROP TABLE IF EXISTS nominas_180;
-- DROP TABLE IF EXISTS fiscal_models_180;
