-- Migración para añadir ruta de backup local persistente
ALTER TABLE configuracionsistema_180 
ADD COLUMN IF NOT EXISTS backup_local_path TEXT;
