-- Permitir al usuario marcar asientos como revisados manualmente
-- para que re-revisar no los vuelva a procesar
ALTER TABLE asientos_180 ADD COLUMN IF NOT EXISTS revisado_usuario BOOLEAN DEFAULT false;
