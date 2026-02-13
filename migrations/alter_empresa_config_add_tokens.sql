-- Añadir saldo inicial de tokens de IA para humanización
ALTER TABLE empresa_config_180 
ADD COLUMN IF NOT EXISTS ai_tokens INTEGER DEFAULT 0;

-- Actualizar empresas existentes con 1000 tokens sociales si es necesario
-- UPDATE empresa_config_180 SET ai_tokens = 1000 WHERE ai_tokens = 0;
