-- ============================================================================
-- MIGRACIÓN: Campos faltantes en emisor_180 y correcciones config
-- Fecha: 2026-02-21
-- ============================================================================

-- 1. Añadir campos que el frontend muestra pero no existían en emisor_180
ALTER TABLE emisor_180
  ADD COLUMN IF NOT EXISTS nombre_comercial VARCHAR(200),
  ADD COLUMN IF NOT EXISTS registro_mercantil TEXT,
  ADD COLUMN IF NOT EXISTS iban VARCHAR(50),
  ADD COLUMN IF NOT EXISTS certificado_info JSONB,
  ADD COLUMN IF NOT EXISTS certificado_upload_date TIMESTAMP;

-- 2. Asegurar que email, web, telefono, etc. son nullables (el script original los marca NOT NULL)
ALTER TABLE emisor_180
  ALTER COLUMN nombre DROP NOT NULL,
  ALTER COLUMN nif DROP NOT NULL,
  ALTER COLUMN direccion DROP NOT NULL,
  ALTER COLUMN poblacion DROP NOT NULL,
  ALTER COLUMN provincia DROP NOT NULL,
  ALTER COLUMN cp DROP NOT NULL,
  ALTER COLUMN telefono DROP NOT NULL,
  ALTER COLUMN email DROP NOT NULL;

-- 3. Añadir updated_at a configuracionsistema_180 para coherencia con el upsert de backup_local_path
ALTER TABLE configuracionsistema_180
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Sincronizar updated_at con actualizado_en para los registros existentes
UPDATE configuracionsistema_180
  SET updated_at = actualizado_en
  WHERE updated_at IS NULL AND actualizado_en IS NOT NULL;

-- 4. Asegurar que configuracionsistema_180 tiene backup_local_path (si no existe ya)
ALTER TABLE configuracionsistema_180
  ADD COLUMN IF NOT EXISTS backup_local_path TEXT;

-- 5. Ticker BAI (campo que el backend guarda pero el script original no tenía)
ALTER TABLE configuracionsistema_180
  ADD COLUMN IF NOT EXISTS ticket_bai_activo BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS numeracion_tipo VARCHAR(20) DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS numeracion_formato VARCHAR(100),
  ADD COLUMN IF NOT EXISTS serie VARCHAR(50),
  ADD COLUMN IF NOT EXISTS storage_facturas_folder VARCHAR(200) DEFAULT 'Facturas emitidas',
  ADD COLUMN IF NOT EXISTS correlativo_inicial INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS migracion_last_pdf TEXT,
  ADD COLUMN IF NOT EXISTS migracion_last_serie VARCHAR(50),
  ADD COLUMN IF NOT EXISTS migracion_last_emisor_nif VARCHAR(30),
  ADD COLUMN IF NOT EXISTS migracion_last_cliente_nif VARCHAR(30),
  ADD COLUMN IF NOT EXISTS migracion_last_subtotal NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS migracion_last_iva NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS migracion_last_total NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS migracion_legal_aceptado BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS migracion_fecha_aceptacion TIMESTAMP;

SELECT 'Migración 20260221 aplicada correctamente' as resultado;
