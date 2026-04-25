-- Sprint 4: Multi-titular UI + per-person RETA tracking.
--
-- Contexto: titulares_empresa_180 ya existe (20260403_titulares_empresa.sql) y las
-- tablas reta_* ya tienen columna titular_id (FK opcional). Lo que falta:
--   1. RLS sobre titulares_empresa_180 (4 policies para contendo_app).
--   2. Permitir múltiples perfiles RETA por (empresa, ejercicio) cuando hay
--      varios titulares: relajar UNIQUE(empresa_id, ejercicio) y crearlo
--      sobre la triada (empresa_id, ejercicio, titular_id).
--   3. Lo mismo para reta_estimaciones_180 si tuviera unique antiguo (no lo tiene).
--
-- Por qué es importante: una sociedad puede tener 1 socio autónomo + 1 socio
-- en régimen general; o un autónomo individual con un cónyuge colaborador.
-- Cada uno cotiza con su propia base RETA y la app debe poder calcularlas
-- por separado.

-- 1. RLS sobre titulares_empresa_180
ALTER TABLE titulares_empresa_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS titulares_empresa_select ON titulares_empresa_180;
CREATE POLICY titulares_empresa_select ON titulares_empresa_180
    FOR SELECT TO contendo_app
    USING (empresa_id = current_setting('app.empresa_id', true)::uuid);

DROP POLICY IF EXISTS titulares_empresa_insert ON titulares_empresa_180;
CREATE POLICY titulares_empresa_insert ON titulares_empresa_180
    FOR INSERT TO contendo_app
    WITH CHECK (empresa_id = current_setting('app.empresa_id', true)::uuid);

DROP POLICY IF EXISTS titulares_empresa_update ON titulares_empresa_180;
CREATE POLICY titulares_empresa_update ON titulares_empresa_180
    FOR UPDATE TO contendo_app
    USING (empresa_id = current_setting('app.empresa_id', true)::uuid)
    WITH CHECK (empresa_id = current_setting('app.empresa_id', true)::uuid);

DROP POLICY IF EXISTS titulares_empresa_delete ON titulares_empresa_180;
CREATE POLICY titulares_empresa_delete ON titulares_empresa_180
    FOR DELETE TO contendo_app
    USING (empresa_id = current_setting('app.empresa_id', true)::uuid);

-- 2. UNIQUE per-titular en reta_autonomo_perfil_180
--    El UNIQUE existente (empresa_id, ejercicio) impide registrar 2 titulares
--    distintos para el mismo año. Lo sustituimos por (empresa_id, ejercicio, titular_id)
--    tratando NULL como "perfil de empresa sin titular específico" (caso autónomo
--    individual sin titulares creados).
ALTER TABLE reta_autonomo_perfil_180
    DROP CONSTRAINT IF EXISTS reta_autonomo_perfil_180_empresa_id_ejercicio_key;

CREATE UNIQUE INDEX IF NOT EXISTS reta_autonomo_perfil_titular_unique
    ON reta_autonomo_perfil_180 (empresa_id, ejercicio, COALESCE(titular_id::text, ''));

-- 3. Índices para acelerar consultas filtradas por titular_id
CREATE INDEX IF NOT EXISTS idx_reta_estimaciones_titular ON reta_estimaciones_180(titular_id);
CREATE INDEX IF NOT EXISTS idx_reta_cambios_base_titular ON reta_cambios_base_180(titular_id);
CREATE INDEX IF NOT EXISTS idx_reta_eventos_titular ON reta_eventos_180(titular_id);
CREATE INDEX IF NOT EXISTS idx_reta_alertas_titular ON reta_alertas_180(titular_id);

-- 4. RLS sobre titulares también para tablas reta_* (si aún no tenían) - chequeo idempotente
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reta_autonomo_perfil_180' AND policyname = 'reta_perfil_select') THEN
        EXECUTE 'ALTER TABLE reta_autonomo_perfil_180 ENABLE ROW LEVEL SECURITY';
        EXECUTE 'CREATE POLICY reta_perfil_select ON reta_autonomo_perfil_180 FOR SELECT TO contendo_app USING (empresa_id = current_setting(''app.empresa_id'', true)::uuid)';
        EXECUTE 'CREATE POLICY reta_perfil_insert ON reta_autonomo_perfil_180 FOR INSERT TO contendo_app WITH CHECK (empresa_id = current_setting(''app.empresa_id'', true)::uuid)';
        EXECUTE 'CREATE POLICY reta_perfil_update ON reta_autonomo_perfil_180 FOR UPDATE TO contendo_app USING (empresa_id = current_setting(''app.empresa_id'', true)::uuid) WITH CHECK (empresa_id = current_setting(''app.empresa_id'', true)::uuid)';
        EXECUTE 'CREATE POLICY reta_perfil_delete ON reta_autonomo_perfil_180 FOR DELETE TO contendo_app USING (empresa_id = current_setting(''app.empresa_id'', true)::uuid)';
    END IF;
END $$;
