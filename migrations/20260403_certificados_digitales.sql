-- Migration: Certificados Digitales para gestorías
-- Gestión de certificados .p12/.pfx instalados para clientes (AEAT, Seg. Social, etc.)
-- Date: 2026-04-03

DROP TABLE IF EXISTS certificados_uso_log_180;
DROP TABLE IF EXISTS certificados_digitales_180;

CREATE TABLE IF NOT EXISTS certificados_digitales_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
  asesoria_id uuid,
  nombre text NOT NULL,
  tipo text NOT NULL DEFAULT 'persona_fisica', -- persona_fisica, persona_juridica, representante
  titular_nombre text NOT NULL,
  titular_nif text NOT NULL,
  emisor text, -- FNMT, etc.
  numero_serie text,
  fecha_emision date,
  fecha_caducidad date NOT NULL,
  archivo_nombre text, -- original filename (no actual file stored for security)
  password_hint text, -- hint only, never store actual password
  instalado_en text[], -- e.g., ['aeat_sede', 'seguridad_social', 'local']
  estado text NOT NULL DEFAULT 'activo', -- activo, caducado, revocado, proximo_caducar
  notas text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certificados_empresa ON certificados_digitales_180(empresa_id);
CREATE INDEX IF NOT EXISTS idx_certificados_caducidad ON certificados_digitales_180(fecha_caducidad);
CREATE INDEX IF NOT EXISTS idx_certificados_asesoria ON certificados_digitales_180(asesoria_id);

CREATE TABLE IF NOT EXISTS certificados_uso_log_180 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificado_id uuid NOT NULL REFERENCES certificados_digitales_180(id) ON DELETE CASCADE,
  accion text NOT NULL, -- instalacion, renovacion, uso_presentacion, revocacion
  detalle text,
  modelo_aeat text, -- e.g., '303', '390'
  usuario_id uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certificados_uso_certificado ON certificados_uso_log_180(certificado_id);
