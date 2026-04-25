-- Promotes the previously-inline "MIGRACION AUTOMATICA (Hotfix)" block
-- from app.js into a versioned migration. Kept idempotent so re-applying
-- against a database where the hotfix already ran is a no-op.

DO $$
BEGIN
    -- clients_180.geo_policy constraint
    ALTER TABLE clients_180 DROP CONSTRAINT IF EXISTS clients_geo_policy_check;
    ALTER TABLE clients_180 ADD CONSTRAINT clients_geo_policy_check
        CHECK (geo_policy IN ('none', 'strict', 'soft', 'info'));

    -- configuracionsistema_180 columns added by the hotfix
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='configuracionsistema_180' AND column_name='backup_local_path') THEN
        ALTER TABLE configuracionsistema_180 ADD COLUMN backup_local_path TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='configuracionsistema_180' AND column_name='correlativo_inicial') THEN
        ALTER TABLE configuracionsistema_180 ADD COLUMN correlativo_inicial INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_pdf') THEN
        ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_pdf TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='configuracionsistema_180' AND column_name='migracion_legal_aceptado') THEN
        ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_legal_aceptado BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='configuracionsistema_180' AND column_name='migracion_fecha_aceptacion') THEN
        ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_fecha_aceptacion TIMESTAMP;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_serie') THEN
        ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_serie TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_emisor_nif') THEN
        ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_emisor_nif TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_cliente_nif') THEN
        ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_cliente_nif TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_subtotal') THEN
        ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_subtotal NUMERIC(15,2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_iva') THEN
        ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_iva NUMERIC(15,2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_total') THEN
        ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_total NUMERIC(15,2);
    END IF;

    -- registroverifactueventos_180 — VeriFactu events table (legacy hotfix
    -- created this with auth.uid()-based RLS, which does not work via the
    -- direct postgres library. Policies are recreated in a later migration
    -- once the set_config('app.empresa_id') strategy lands.
    CREATE TABLE IF NOT EXISTS registroverifactueventos_180 (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL,
        user_id UUID,
        tipo_evento VARCHAR(50) NOT NULL,
        descripcion TEXT,
        fecha_evento TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        hash_anterior VARCHAR(300),
        hash_actual VARCHAR(300),
        meta_data JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
END $$;
