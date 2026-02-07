-- =============================================
-- 005: WhatsApp Integration Tables
-- =============================================

-- Memoria de conversaciones WhatsApp (separada de web)
CREATE TABLE IF NOT EXISTS whatsapp_memory_180 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  phone VARCHAR(20) NOT NULL,
  mensaje TEXT NOT NULL,
  respuesta TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wa_memory_empresa_phone ON whatsapp_memory_180(empresa_id, phone);
CREATE INDEX IF NOT EXISTS idx_wa_memory_created ON whatsapp_memory_180(created_at DESC);

-- Acciones peligrosas pendientes de confirmacion
CREATE TABLE IF NOT EXISTS whatsapp_pending_actions_180 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  phone VARCHAR(20) NOT NULL,
  tool_name VARCHAR(100) NOT NULL,
  arguments JSONB NOT NULL DEFAULT '{}',
  preview_message TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wa_pending_empresa_phone ON whatsapp_pending_actions_180(empresa_id, phone);

-- Log de interacciones WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_log_180 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  phone VARCHAR(20) NOT NULL,
  message_id VARCHAR(100),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message TEXT NOT NULL,
  response TEXT,
  is_audio BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wa_log_empresa ON whatsapp_log_180(empresa_id);
CREATE INDEX IF NOT EXISTS idx_wa_log_created ON whatsapp_log_180(created_at DESC);
