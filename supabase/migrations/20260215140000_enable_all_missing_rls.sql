-- Enable RLS and create policies for all remaining tables
-- Migration timestamp: 20260215140000

-- ============================================================================
-- 1. client_fiscal_data_180
-- ============================================================================
ALTER TABLE client_fiscal_data_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_client_fiscal_data_mismo_users_180" ON client_fiscal_data_180;
CREATE POLICY "select_client_fiscal_data_mismo_users_180" ON client_fiscal_data_180
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients_180 c
      WHERE c.id = client_fiscal_data_180.cliente_id
        AND c.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "insert_client_fiscal_data_180" ON client_fiscal_data_180;
CREATE POLICY "insert_client_fiscal_data_180" ON client_fiscal_data_180
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients_180 c
      WHERE c.id = client_fiscal_data_180.cliente_id
        AND c.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "update_client_fiscal_data_180" ON client_fiscal_data_180;
CREATE POLICY "update_client_fiscal_data_180" ON client_fiscal_data_180
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM clients_180 c
      WHERE c.id = client_fiscal_data_180.cliente_id
        AND c.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients_180 c
      WHERE c.id = client_fiscal_data_180.cliente_id
        AND c.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "delete_client_fiscal_data_180" ON client_fiscal_data_180;
CREATE POLICY "delete_client_fiscal_data_180" ON client_fiscal_data_180
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM clients_180 c
      WHERE c.id = client_fiscal_data_180.cliente_id
        AND c.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 2. invoices_180
-- ============================================================================
ALTER TABLE invoices_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_invoices_mismo_users_180" ON invoices_180;
CREATE POLICY "select_invoices_mismo_users_180" ON invoices_180
  FOR SELECT
  USING (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_invoices_180" ON invoices_180;
CREATE POLICY "insert_invoices_180" ON invoices_180
  FOR INSERT
  WITH CHECK (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "update_invoices_180" ON invoices_180;
CREATE POLICY "update_invoices_180" ON invoices_180
  FOR UPDATE
  USING (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  )
  WITH CHECK (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_invoices_180" ON invoices_180;
CREATE POLICY "delete_invoices_180" ON invoices_180
  FOR DELETE
  USING (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

-- ============================================================================
-- 3. plantilla_bloques_180
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
-- 4. plantilla_dias_180
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
-- 5. plantilla_excepcion_bloques_180
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
-- 6. plantilla_excepciones_180
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
-- 7. calendario_importacion_180
-- ============================================================================
ALTER TABLE calendario_importacion_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_calendario_importacion_mismo_users_180" ON calendario_importacion_180;
CREATE POLICY "select_calendario_importacion_mismo_users_180" ON calendario_importacion_180
  FOR SELECT
  USING (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_calendario_importacion_180" ON calendario_importacion_180;
CREATE POLICY "insert_calendario_importacion_180" ON calendario_importacion_180
  FOR INSERT
  WITH CHECK (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "update_calendario_importacion_180" ON calendario_importacion_180;
CREATE POLICY "update_calendario_importacion_180" ON calendario_importacion_180
  FOR UPDATE
  USING (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  )
  WITH CHECK (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_calendario_importacion_180" ON calendario_importacion_180;
CREATE POLICY "delete_calendario_importacion_180" ON calendario_importacion_180
  FOR DELETE
  USING (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

-- ============================================================================
-- 8. calendario_importacion_item_180
-- ============================================================================
ALTER TABLE calendario_importacion_item_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_calendario_importacion_item_mismo_users_180" ON calendario_importacion_item_180;
CREATE POLICY "select_calendario_importacion_item_mismo_users_180" ON calendario_importacion_item_180
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM calendario_importacion_180 ci
      WHERE ci.id = calendario_importacion_item_180.importacion_id
        AND ci.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "insert_calendario_importacion_item_180" ON calendario_importacion_item_180;
CREATE POLICY "insert_calendario_importacion_item_180" ON calendario_importacion_item_180
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM calendario_importacion_180 ci
      WHERE ci.id = calendario_importacion_item_180.importacion_id
        AND ci.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "update_calendario_importacion_item_180" ON calendario_importacion_item_180;
CREATE POLICY "update_calendario_importacion_item_180" ON calendario_importacion_item_180
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM calendario_importacion_180 ci
      WHERE ci.id = calendario_importacion_item_180.importacion_id
        AND ci.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM calendario_importacion_180 ci
      WHERE ci.id = calendario_importacion_item_180.importacion_id
        AND ci.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "delete_calendario_importacion_item_180" ON calendario_importacion_item_180;
CREATE POLICY "delete_calendario_importacion_item_180" ON calendario_importacion_item_180
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM calendario_importacion_180 ci
      WHERE ci.id = calendario_importacion_item_180.importacion_id
        AND ci.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 9. purchases_180
-- ============================================================================
ALTER TABLE purchases_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_purchases_mismo_users_180" ON purchases_180;
CREATE POLICY "select_purchases_mismo_users_180" ON purchases_180
  FOR SELECT
  USING (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_purchases_180" ON purchases_180;
CREATE POLICY "insert_purchases_180" ON purchases_180
  FOR INSERT
  WITH CHECK (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "update_purchases_180" ON purchases_180;
CREATE POLICY "update_purchases_180" ON purchases_180
  FOR UPDATE
  USING (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  )
  WITH CHECK (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_purchases_180" ON purchases_180;
CREATE POLICY "delete_purchases_180" ON purchases_180
  FOR DELETE
  USING (
    empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

-- ============================================================================
-- 10. time_logs_180
-- ============================================================================
ALTER TABLE time_logs_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_time_logs_mismo_users_180" ON time_logs_180;
CREATE POLICY "select_time_logs_mismo_users_180" ON time_logs_180
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees_180 e
      WHERE e.id = time_logs_180.empleado_id
        AND e.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "insert_time_logs_180" ON time_logs_180;
CREATE POLICY "insert_time_logs_180" ON time_logs_180
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees_180 e
      WHERE e.id = time_logs_180.empleado_id
        AND e.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "update_time_logs_180" ON time_logs_180;
CREATE POLICY "update_time_logs_180" ON time_logs_180
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM employees_180 e
      WHERE e.id = time_logs_180.empleado_id
        AND e.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees_180 e
      WHERE e.id = time_logs_180.empleado_id
        AND e.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "delete_time_logs_180" ON time_logs_180;
CREATE POLICY "delete_time_logs_180" ON time_logs_180
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM employees_180 e
      WHERE e.id = time_logs_180.empleado_id
        AND e.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 11. turno_bloques_180
-- ============================================================================
ALTER TABLE turno_bloques_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_turno_bloques_mismo_users_180" ON turno_bloques_180;
CREATE POLICY "select_turno_bloques_mismo_users_180" ON turno_bloques_180
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM turnos_180 t
      WHERE t.id = turno_bloques_180.turno_id
        AND t.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "insert_turno_bloques_180" ON turno_bloques_180;
CREATE POLICY "insert_turno_bloques_180" ON turno_bloques_180
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM turnos_180 t
      WHERE t.id = turno_bloques_180.turno_id
        AND t.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "update_turno_bloques_180" ON turno_bloques_180;
CREATE POLICY "update_turno_bloques_180" ON turno_bloques_180
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM turnos_180 t
      WHERE t.id = turno_bloques_180.turno_id
        AND t.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM turnos_180 t
      WHERE t.id = turno_bloques_180.turno_id
        AND t.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "delete_turno_bloques_180" ON turno_bloques_180;
CREATE POLICY "delete_turno_bloques_180" ON turno_bloques_180
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM turnos_180 t
      WHERE t.id = turno_bloques_180.turno_id
        AND t.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 12. work_items_180
-- ============================================================================
ALTER TABLE work_items_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_work_items_mismo_users_180" ON work_items_180;
CREATE POLICY "select_work_items_mismo_users_180" ON work_items_180
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM work_logs_180 wl
      WHERE wl.id = work_items_180.work_log_id
        AND wl.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "insert_work_items_180" ON work_items_180;
CREATE POLICY "insert_work_items_180" ON work_items_180
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM work_logs_180 wl
      WHERE wl.id = work_items_180.work_log_id
        AND wl.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "update_work_items_180" ON work_items_180;
CREATE POLICY "update_work_items_180" ON work_items_180
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM work_logs_180 wl
      WHERE wl.id = work_items_180.work_log_id
        AND wl.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM work_logs_180 wl
      WHERE wl.id = work_items_180.work_log_id
        AND wl.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "delete_work_items_180" ON work_items_180;
CREATE POLICY "delete_work_items_180" ON work_items_180
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM work_logs_180 wl
      WHERE wl.id = work_items_180.work_log_id
        AND wl.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );
