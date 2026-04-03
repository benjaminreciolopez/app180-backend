-- SII (Suministro Inmediato de Información) Module
-- Mandatory for companies with turnover >6M€ and REDEME members
-- Real-time invoice reporting to AEAT

-- SII configuration per empresa
CREATE TABLE IF NOT EXISTS sii_config_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL UNIQUE REFERENCES empresa_180(id) ON DELETE CASCADE,
  sii_activo boolean DEFAULT false,
  sii_motivo text DEFAULT 'voluntario', -- 'facturacion_6m', 'redeme', 'voluntario', 'grupo_iva'
  sii_inicio date,
  certificado_id uuid REFERENCES certificados_digitales_180(id),
  envio_automatico boolean DEFAULT false,
  entorno text DEFAULT 'test', -- 'test', 'produccion'
  ultimo_envio timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- SII submission records
CREATE TABLE IF NOT EXISTS sii_envios_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  tipo_libro text NOT NULL, -- 'emitidas', 'recibidas', 'bienes_inversion', 'cobros_metalico'
  tipo_comunicacion text NOT NULL, -- 'A0' (alta), 'A1' (modificacion), 'A4' (modificacion en contraste)
  -- Factura reference
  factura_id uuid, -- for emitidas (factura_180)
  gasto_id uuid, -- for recibidas (purchases_180)
  -- AEAT data
  ejercicio integer NOT NULL,
  periodo text NOT NULL, -- '01'..'12'
  nif_titular text NOT NULL,
  nif_contraparte text,
  nombre_contraparte text,
  numero_factura text,
  fecha_factura date,
  -- Amounts
  base_imponible numeric,
  cuota_iva numeric,
  tipo_iva numeric,
  total numeric,
  -- Submission status
  estado text DEFAULT 'pendiente', -- 'pendiente', 'enviado', 'aceptado', 'rechazado', 'parcial'
  csv_aeat text, -- Código Seguro de Verificación
  aeat_estado text,
  aeat_error_code text,
  aeat_error_desc text,
  aeat_respuesta_xml text,
  -- Metadata
  enviado_at timestamptz,
  intentos integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sii_envios_empresa ON sii_envios_180(empresa_id, ejercicio, periodo);
CREATE INDEX IF NOT EXISTS idx_sii_envios_estado ON sii_envios_180(estado);
CREATE INDEX IF NOT EXISTS idx_sii_envios_factura ON sii_envios_180(factura_id);
