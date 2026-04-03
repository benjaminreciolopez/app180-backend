-- SII Framework Extension
-- Extends the SII module with batch envio support and registro-level tracking
-- Required tables: sii_config_180, sii_envios_180 (from 20260403_sii_module.sql)

-- Add missing columns to sii_config_180
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_config_180' AND column_name='sii_obligatorio') THEN
    ALTER TABLE sii_config_180 ADD COLUMN sii_obligatorio boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_config_180' AND column_name='fecha_alta_sii') THEN
    ALTER TABLE sii_config_180 ADD COLUMN fecha_alta_sii date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_config_180' AND column_name='modo') THEN
    ALTER TABLE sii_config_180 ADD COLUMN modo text DEFAULT 'manual';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_config_180' AND column_name='ultimo_envio_exitoso') THEN
    ALTER TABLE sii_config_180 ADD COLUMN ultimo_envio_exitoso timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_config_180' AND column_name='notas') THEN
    ALTER TABLE sii_config_180 ADD COLUMN notas text;
  END IF;
END $$;

-- Add batch-level columns to sii_envios_180 for grouped envios
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_envios_180' AND column_name='num_registros') THEN
    ALTER TABLE sii_envios_180 ADD COLUMN num_registros integer DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_envios_180' AND column_name='xml_request') THEN
    ALTER TABLE sii_envios_180 ADD COLUMN xml_request text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_envios_180' AND column_name='xml_response') THEN
    ALTER TABLE sii_envios_180 ADD COLUMN xml_response text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_envios_180' AND column_name='csv_respuesta') THEN
    ALTER TABLE sii_envios_180 ADD COLUMN csv_respuesta text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_envios_180' AND column_name='registros_correctos') THEN
    ALTER TABLE sii_envios_180 ADD COLUMN registros_correctos integer DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_envios_180' AND column_name='registros_con_errores') THEN
    ALTER TABLE sii_envios_180 ADD COLUMN registros_con_errores integer DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_envios_180' AND column_name='registros_aceptados_con_errores') THEN
    ALTER TABLE sii_envios_180 ADD COLUMN registros_aceptados_con_errores integer DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_envios_180' AND column_name='detalle_errores') THEN
    ALTER TABLE sii_envios_180 ADD COLUMN detalle_errores jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_envios_180' AND column_name='enviado_por') THEN
    ALTER TABLE sii_envios_180 ADD COLUMN enviado_por uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_envios_180' AND column_name='periodo_mes') THEN
    ALTER TABLE sii_envios_180 ADD COLUMN periodo_mes text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sii_envios_180' AND column_name='periodo_ejercicio') THEN
    ALTER TABLE sii_envios_180 ADD COLUMN periodo_ejercicio integer;
  END IF;
END $$;

-- SII registro-level tracking (individual invoice results within a batch envio)
CREATE TABLE IF NOT EXISTS sii_registros_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envio_id uuid REFERENCES sii_envios_180(id) ON DELETE CASCADE,
  factura_id uuid,
  tipo_factura text, -- emitida, recibida
  nif_contraparte text,
  nombre_contraparte text,
  numero_factura text,
  fecha_expedicion date,
  tipo_factura_sii text, -- F1, F2, R1, R2, R3, R4, R5
  clave_regimen text, -- 01, 02, 03...
  base_imponible numeric,
  tipo_impositivo numeric,
  cuota_repercutida numeric,
  estado_registro text, -- correcto, aceptado_con_errores, rechazado
  codigo_error text,
  descripcion_error text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sii_registros_envio ON sii_registros_180(envio_id);
CREATE INDEX IF NOT EXISTS idx_sii_registros_factura ON sii_registros_180(factura_id);
