CREATE TABLE IF NOT EXISTS factura_recurrente_180 (
  id SERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL,
  cliente_id UUID NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  lineas JSONB NOT NULL DEFAULT '[]',
  iva_global NUMERIC(5,2) DEFAULT 21,
  mensaje_iva TEXT,
  metodo_pago VARCHAR(50) DEFAULT 'TRANSFERENCIA',
  retencion_porcentaje NUMERIC(5,2) DEFAULT 0,
  dia_generacion INTEGER DEFAULT 1,
  activo BOOLEAN DEFAULT true,
  ultima_generacion DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
