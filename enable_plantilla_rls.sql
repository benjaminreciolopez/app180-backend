-- ============================================================================
-- HABILITAR RLS Y CREAR POLÍTICAS PARA TABLAS PLANTILLA
-- ============================================================================

-- ============================================================================
-- 1. plantilla_bloques_180
-- ============================================================================
ALTER TABLE plantilla_bloques_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_plantilla_bloques_mismo_users_180" ON plantilla_bloques_180;
CREATE POLICY "select_plantilla_bloques_mismo_users_180" ON plantilla_bloques_180
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_bloques_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "insert_plantilla_bloques_180" ON plantilla_bloques_180;
CREATE POLICY "insert_plantilla_bloques_180" ON plantilla_bloques_180
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_bloques_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "update_plantilla_bloques_180" ON plantilla_bloques_180;
CREATE POLICY "update_plantilla_bloques_180" ON plantilla_bloques_180
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_bloques_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_bloques_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "delete_plantilla_bloques_180" ON plantilla_bloques_180;
CREATE POLICY "delete_plantilla_bloques_180" ON plantilla_bloques_180
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_bloques_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 2. plantilla_dias_180
-- ============================================================================
ALTER TABLE plantilla_dias_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_plantilla_dias_mismo_users_180" ON plantilla_dias_180;
CREATE POLICY "select_plantilla_dias_mismo_users_180" ON plantilla_dias_180
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_dias_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "insert_plantilla_dias_180" ON plantilla_dias_180;
CREATE POLICY "insert_plantilla_dias_180" ON plantilla_dias_180
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_dias_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "update_plantilla_dias_180" ON plantilla_dias_180;
CREATE POLICY "update_plantilla_dias_180" ON plantilla_dias_180
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_dias_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_dias_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "delete_plantilla_dias_180" ON plantilla_dias_180;
CREATE POLICY "delete_plantilla_dias_180" ON plantilla_dias_180
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_dias_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 3. plantilla_excepcion_bloques_180
-- ============================================================================
ALTER TABLE plantilla_excepcion_bloques_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_plantilla_excepcion_bloques_mismo_users_180" ON plantilla_excepcion_bloques_180;
CREATE POLICY "select_plantilla_excepcion_bloques_mismo_users_180" ON plantilla_excepcion_bloques_180
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM plantilla_excepciones_180 pe
      WHERE pe.id = plantilla_excepcion_bloques_180.excepcion_id
        AND EXISTS (
          SELECT 1 FROM plantillas_jornada_180 pj
          WHERE pj.id = pe.plantilla_id
            AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "insert_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180;
CREATE POLICY "insert_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plantilla_excepciones_180 pe
      WHERE pe.id = plantilla_excepcion_bloques_180.excepcion_id
        AND EXISTS (
          SELECT 1 FROM plantillas_jornada_180 pj
          WHERE pj.id = pe.plantilla_id
            AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "update_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180;
CREATE POLICY "update_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM plantilla_excepciones_180 pe
      WHERE pe.id = plantilla_excepcion_bloques_180.excepcion_id
        AND EXISTS (
          SELECT 1 FROM plantillas_jornada_180 pj
          WHERE pj.id = pe.plantilla_id
            AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plantilla_excepciones_180 pe
      WHERE pe.id = plantilla_excepcion_bloques_180.excepcion_id
        AND EXISTS (
          SELECT 1 FROM plantillas_jornada_180 pj
          WHERE pj.id = pe.plantilla_id
            AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "delete_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180;
CREATE POLICY "delete_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM plantilla_excepciones_180 pe
      WHERE pe.id = plantilla_excepcion_bloques_180.excepcion_id
        AND EXISTS (
          SELECT 1 FROM plantillas_jornada_180 pj
          WHERE pj.id = pe.plantilla_id
            AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
        )
    )
  );

-- ============================================================================
-- 4. plantilla_excepciones_180
-- ============================================================================
ALTER TABLE plantilla_excepciones_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_plantilla_excepciones_mismo_users_180" ON plantilla_excepciones_180;
CREATE POLICY "select_plantilla_excepciones_mismo_users_180" ON plantilla_excepciones_180
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_excepciones_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "insert_plantilla_excepciones_180" ON plantilla_excepciones_180;
CREATE POLICY "insert_plantilla_excepciones_180" ON plantilla_excepciones_180
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_excepciones_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "update_plantilla_excepciones_180" ON plantilla_excepciones_180;
CREATE POLICY "update_plantilla_excepciones_180" ON plantilla_excepciones_180
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_excepciones_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_excepciones_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "delete_plantilla_excepciones_180" ON plantilla_excepciones_180;
CREATE POLICY "delete_plantilla_excepciones_180" ON plantilla_excepciones_180
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_excepciones_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- VERIFICACIÓN: Confirmar que RLS está habilitada
-- ============================================================================
SELECT 
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename IN (
  'plantilla_bloques_180',
  'plantilla_dias_180',
  'plantilla_excepcion_bloques_180',
  'plantilla_excepciones_180'
)
ORDER BY tablename;
