-- Add retention fields to factura_180 and purchases_180

-- Facturas (Ventas)
ALTER TABLE factura_180
ADD COLUMN IF NOT EXISTS retencion_porcentaje numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS retencion_importe numeric DEFAULT 0;

-- Gastos (Compras)
ALTER TABLE purchases_180
ADD COLUMN IF NOT EXISTS retencion_porcentaje numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS retencion_importe numeric DEFAULT 0;
