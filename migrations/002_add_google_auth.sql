-- ============================================
-- Añadir soporte Google Sign-In a users_180
-- ============================================

-- Campo Google ID para identificación
ALTER TABLE users_180 ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;

-- Avatar URL (foto de perfil de Google)
ALTER TABLE users_180 ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Hacer password nullable (usuarios Google no necesitan password)
ALTER TABLE users_180 ALTER COLUMN password DROP NOT NULL;

-- Dashboard widgets configurables por empresa
ALTER TABLE empresa_config_180
ADD COLUMN IF NOT EXISTS dashboard_widgets JSONB DEFAULT '[]'::jsonb;
