-- Add retention fields to clients and confirm retention fields in facturas

-- 1. Add retention settings to clients_180
ALTER TABLE clients_180
ADD COLUMN IF NOT EXISTS aplicar_retencion boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS retencion_tipo numeric DEFAULT 0;

-- 2. Ensure retention fields exist in factura_180 (previously added but good to double check/consolidate)
ALTER TABLE factura_180
ADD COLUMN IF NOT EXISTS retencion_porcentaje numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS retencion_importe numeric DEFAULT 0;

-- 3. Ensure retention fields exist in purchases_180 (previously added but good to double check/consolidate)
ALTER TABLE purchases_180
ADD COLUMN IF NOT EXISTS retencion_porcentaje numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS retencion_importe numeric DEFAULT 0;
