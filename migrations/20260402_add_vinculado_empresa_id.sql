-- Migración: Añadir vinculado_empresa_id a clients_180
-- Permite vincular un cliente de la asesoría con la empresa_180 original (app)
ALTER TABLE clients_180 ADD COLUMN IF NOT EXISTS vinculado_empresa_id UUID;
