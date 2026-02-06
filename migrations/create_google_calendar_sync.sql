-- ========================================
-- GOOGLE CALENDAR SYNC - MIGRATION
-- ========================================
-- Tablas para sincronización bidireccional entre APP180 y Google Calendar
-- Reutiliza infraestructura OAuth2 existente (email)
-- Incluye webhooks, mapping anti-loop y auditoría completa

-- ========================================
-- 1. CONFIGURACIÓN DE GOOGLE CALENDAR
-- ========================================
CREATE TABLE IF NOT EXISTS empresa_calendar_config_180 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL UNIQUE REFERENCES empresa_180(id) ON DELETE CASCADE,

  -- OAuth2 Configuration (mismo patrón que empresa_email_config_180)
  oauth2_provider VARCHAR(50) DEFAULT 'google',
  oauth2_email VARCHAR(255),
  oauth2_refresh_token TEXT, -- Encriptado AES-256-CBC
  oauth2_connected_at TIMESTAMPTZ,

  -- Google Calendar Específico
  calendar_id VARCHAR(255) DEFAULT 'primary', -- ID del calendario de Google
  sync_token TEXT, -- Token incremental de Google (para cambios desde última sync)
  last_sync_at TIMESTAMPTZ,

  -- Configuración de Sincronización
  sync_enabled BOOLEAN DEFAULT true,
  sync_direction VARCHAR(20) DEFAULT 'bidirectional', -- 'bidirectional', 'to_google', 'from_google'
  sync_types JSONB DEFAULT '{"festivos": true, "cierres": true, "ausencias": false}'::jsonb,
  sync_range_months INTEGER DEFAULT 12, -- Cuántos meses sincronizar (hacia adelante)

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_config_empresa ON empresa_calendar_config_180(empresa_id);

COMMENT ON TABLE empresa_calendar_config_180 IS 'Configuración de Google Calendar por empresa';
COMMENT ON COLUMN empresa_calendar_config_180.oauth2_refresh_token IS 'Token refresh de Google OAuth2, encriptado con AES-256';
COMMENT ON COLUMN empresa_calendar_config_180.sync_token IS 'Token incremental de Google para sync eficiente';
COMMENT ON COLUMN empresa_calendar_config_180.sync_types IS 'Tipos de eventos a sincronizar: festivos, cierres, ausencias';

-- ========================================
-- 2. MAPEO DE EVENTOS (Prevención de Duplicados y Loops)
-- ========================================
CREATE TABLE IF NOT EXISTS calendar_event_mapping_180 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,

  -- Referencia APP180
  app180_source VARCHAR(50) NOT NULL, -- 'calendario_empresa', 'ausencias'
  app180_event_id UUID NOT NULL,

  -- Referencia Google Calendar
  google_calendar_id VARCHAR(255) NOT NULL, -- ID del calendario (normalmente 'primary')
  google_event_id VARCHAR(1024) NOT NULL, -- ID del evento en Google

  -- Metadata de Sincronización (CRÍTICO para prevenir loops infinitos)
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  sync_direction VARCHAR(20), -- 'to_google', 'from_google'
  google_etag VARCHAR(255), -- ETag de Google para detectar cambios

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints: Cada evento APP180 se mapea a un evento Google (y viceversa)
  UNIQUE(empresa_id, app180_source, app180_event_id),
  UNIQUE(empresa_id, google_calendar_id, google_event_id)
);

CREATE INDEX IF NOT EXISTS idx_mapping_app180 ON calendar_event_mapping_180(empresa_id, app180_source, app180_event_id);
CREATE INDEX IF NOT EXISTS idx_mapping_google ON calendar_event_mapping_180(empresa_id, google_calendar_id, google_event_id);
CREATE INDEX IF NOT EXISTS idx_mapping_last_synced ON calendar_event_mapping_180(last_synced_at);

COMMENT ON TABLE calendar_event_mapping_180 IS 'Mapeo bidireccional entre eventos APP180 y Google Calendar';
COMMENT ON COLUMN calendar_event_mapping_180.last_synced_at IS 'Usado para prevenir loops: si sync hace < 5 min, SKIP';
COMMENT ON COLUMN calendar_event_mapping_180.google_etag IS 'ETag de Google para detectar si el evento cambió';

-- ========================================
-- 3. LOG DE SINCRONIZACIONES (Auditoría)
-- ========================================
CREATE TABLE IF NOT EXISTS calendar_sync_log_180 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,

  -- Tipo y Dirección
  sync_type VARCHAR(50) NOT NULL, -- 'manual', 'auto', 'webhook'
  sync_direction VARCHAR(20) NOT NULL, -- 'to_google', 'from_google', 'bidirectional'

  -- Resultados
  status VARCHAR(20) NOT NULL, -- 'success', 'partial', 'error'
  events_created INTEGER DEFAULT 0,
  events_updated INTEGER DEFAULT 0,
  events_deleted INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,

  -- Detalles
  error_details JSONB, -- Array de errores si los hubo
  sync_summary JSONB, -- Resumen: { duration_ms, events_total, etc }

  -- Auditoría
  triggered_by UUID REFERENCES users_180(id), -- Quién disparó la sync (null si automático)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_log_empresa ON calendar_sync_log_180(empresa_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_created ON calendar_sync_log_180(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON calendar_sync_log_180(status);

COMMENT ON TABLE calendar_sync_log_180 IS 'Historial auditable de sincronizaciones con Google Calendar';
COMMENT ON COLUMN calendar_sync_log_180.sync_type IS 'Cómo se disparó: manual (usuario), auto (cron), webhook (Google push)';

-- ========================================
-- 4. WEBHOOKS DE GOOGLE (Push Notifications)
-- ========================================
CREATE TABLE IF NOT EXISTS calendar_webhook_180 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,

  -- Google Webhook Identifiers
  channel_id VARCHAR(255) NOT NULL UNIQUE, -- ID único generado por nosotros
  resource_id VARCHAR(255) NOT NULL, -- ID del recurso en Google
  calendar_id VARCHAR(255) NOT NULL, -- ID del calendario (normalmente 'primary')

  -- Expiración (Google expira webhooks en ~7 días)
  expiration TIMESTAMPTZ NOT NULL,
  active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Una empresa solo puede tener un webhook activo por calendar_id
  UNIQUE(empresa_id, calendar_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_empresa ON calendar_webhook_180(empresa_id);
CREATE INDEX IF NOT EXISTS idx_webhook_expiration ON calendar_webhook_180(expiration);
CREATE INDEX IF NOT EXISTS idx_webhook_active ON calendar_webhook_180(active);

COMMENT ON TABLE calendar_webhook_180 IS 'Webhooks de Google Calendar Push Notifications';
COMMENT ON COLUMN calendar_webhook_180.expiration IS 'Google expira webhooks automáticamente después de ~7 días, requiere renovación';
COMMENT ON COLUMN calendar_webhook_180.channel_id IS 'ID único del canal, formato: app180-{empresaId}-{timestamp}';

-- ========================================
-- FUNCIONES AUXILIARES
-- ========================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_calendar_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para empresa_calendar_config_180
DROP TRIGGER IF EXISTS trigger_update_calendar_config_updated_at ON empresa_calendar_config_180;
CREATE TRIGGER trigger_update_calendar_config_updated_at
  BEFORE UPDATE ON empresa_calendar_config_180
  FOR EACH ROW
  EXECUTE FUNCTION update_calendar_config_updated_at();

-- Trigger para calendar_event_mapping_180
DROP TRIGGER IF EXISTS trigger_update_mapping_updated_at ON calendar_event_mapping_180;
CREATE TRIGGER trigger_update_mapping_updated_at
  BEFORE UPDATE ON calendar_event_mapping_180
  FOR EACH ROW
  EXECUTE FUNCTION update_calendar_config_updated_at();

-- Trigger para calendar_webhook_180
DROP TRIGGER IF EXISTS trigger_update_webhook_updated_at ON calendar_webhook_180;
CREATE TRIGGER trigger_update_webhook_updated_at
  BEFORE UPDATE ON calendar_webhook_180
  FOR EACH ROW
  EXECUTE FUNCTION update_calendar_config_updated_at();

-- ========================================
-- VERIFICACIÓN
-- ========================================
DO $$
BEGIN
  RAISE NOTICE '✅ Tablas de Google Calendar Sync creadas correctamente:';
  RAISE NOTICE '   - empresa_calendar_config_180';
  RAISE NOTICE '   - calendar_event_mapping_180';
  RAISE NOTICE '   - calendar_sync_log_180';
  RAISE NOTICE '   - calendar_webhook_180';
END $$;
