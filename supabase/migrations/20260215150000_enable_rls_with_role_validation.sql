-- Enable RLS with role-based access control for all remaining tables
-- Migration timestamp: 20260215150000
-- 
-- Patrón de seguridad:
-- - Admin (role='admin'): Acceso total (SELECT, INSERT, UPDATE, DELETE)
-- - Empleado (role='empleado'): Acceso limitado según tabla
-- - Aislamiento por empresa_id para todas las operaciones

-- ============================================================================
-- 1. client_fiscal_data_180 - ADMIN ONLY
-- ============================================================================
ALTER TABLE client_fiscal_data_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_client_fiscal_data_180" ON client_fiscal_data_180;
CREATE POLICY "admin_select_client_fiscal_data_180" ON client_fiscal_data_180
  FOR SELECT
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM clients_180 c
      WHERE c.id = client_fiscal_data_180.cliente_id
        AND c.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_insert_client_fiscal_data_180" ON client_fiscal_data_180;
CREATE POLICY "admin_insert_client_fiscal_data_180" ON client_fiscal_data_180
  FOR INSERT
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM clients_180 c
      WHERE c.id = client_fiscal_data_180.cliente_id
        AND c.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_update_client_fiscal_data_180" ON client_fiscal_data_180;
CREATE POLICY "admin_update_client_fiscal_data_180" ON client_fiscal_data_180
  FOR UPDATE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM clients_180 c
      WHERE c.id = client_fiscal_data_180.cliente_id
        AND c.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM clients_180 c
      WHERE c.id = client_fiscal_data_180.cliente_id
        AND c.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_delete_client_fiscal_data_180" ON client_fiscal_data_180;
CREATE POLICY "admin_delete_client_fiscal_data_180" ON client_fiscal_data_180
  FOR DELETE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM clients_180 c
      WHERE c.id = client_fiscal_data_180.cliente_id
        AND c.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 2. invoices_180 - ADMIN ONLY
-- ============================================================================
ALTER TABLE invoices_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_invoices_180" ON invoices_180;
CREATE POLICY "admin_select_invoices_180" ON invoices_180
  FOR SELECT
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "admin_insert_invoices_180" ON invoices_180;
CREATE POLICY "admin_insert_invoices_180" ON invoices_180
  FOR INSERT
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "admin_update_invoices_180" ON invoices_180;
CREATE POLICY "admin_update_invoices_180" ON invoices_180
  FOR UPDATE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  )
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "admin_delete_invoices_180" ON invoices_180;
CREATE POLICY "admin_delete_invoices_180" ON invoices_180
  FOR DELETE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

-- ============================================================================
-- 3. plantilla_bloques_180 - ADMIN ONLY
-- ============================================================================
ALTER TABLE plantilla_bloques_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_plantilla_bloques_180" ON plantilla_bloques_180;
CREATE POLICY "admin_select_plantilla_bloques_180" ON plantilla_bloques_180
  FOR SELECT
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_bloques_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_insert_plantilla_bloques_180" ON plantilla_bloques_180;
CREATE POLICY "admin_insert_plantilla_bloques_180" ON plantilla_bloques_180
  FOR INSERT
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_bloques_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_update_plantilla_bloques_180" ON plantilla_bloques_180;
CREATE POLICY "admin_update_plantilla_bloques_180" ON plantilla_bloques_180
  FOR UPDATE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_bloques_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_bloques_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_delete_plantilla_bloques_180" ON plantilla_bloques_180;
CREATE POLICY "admin_delete_plantilla_bloques_180" ON plantilla_bloques_180
  FOR DELETE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_bloques_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 4. plantilla_dias_180 - ADMIN ONLY
-- ============================================================================
ALTER TABLE plantilla_dias_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_plantilla_dias_180" ON plantilla_dias_180;
CREATE POLICY "admin_select_plantilla_dias_180" ON plantilla_dias_180
  FOR SELECT
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_dias_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_insert_plantilla_dias_180" ON plantilla_dias_180;
CREATE POLICY "admin_insert_plantilla_dias_180" ON plantilla_dias_180
  FOR INSERT
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_dias_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_update_plantilla_dias_180" ON plantilla_dias_180;
CREATE POLICY "admin_update_plantilla_dias_180" ON plantilla_dias_180
  FOR UPDATE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_dias_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_dias_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_delete_plantilla_dias_180" ON plantilla_dias_180;
CREATE POLICY "admin_delete_plantilla_dias_180" ON plantilla_dias_180
  FOR DELETE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_dias_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 5. plantilla_excepcion_bloques_180 - ADMIN ONLY
-- ============================================================================
ALTER TABLE plantilla_excepcion_bloques_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180;
CREATE POLICY "admin_select_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180
  FOR SELECT
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantilla_excepciones_180 pe
      WHERE pe.id = plantilla_excepcion_bloques_180.excepcion_id
        AND EXISTS (
          SELECT 1 FROM plantillas_jornada_180 pj
          WHERE pj.id = pe.plantilla_id
            AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "admin_insert_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180;
CREATE POLICY "admin_insert_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180
  FOR INSERT
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantilla_excepciones_180 pe
      WHERE pe.id = plantilla_excepcion_bloques_180.excepcion_id
        AND EXISTS (
          SELECT 1 FROM plantillas_jornada_180 pj
          WHERE pj.id = pe.plantilla_id
            AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "admin_update_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180;
CREATE POLICY "admin_update_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180
  FOR UPDATE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
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
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantilla_excepciones_180 pe
      WHERE pe.id = plantilla_excepcion_bloques_180.excepcion_id
        AND EXISTS (
          SELECT 1 FROM plantillas_jornada_180 pj
          WHERE pj.id = pe.plantilla_id
            AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "admin_delete_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180;
CREATE POLICY "admin_delete_plantilla_excepcion_bloques_180" ON plantilla_excepcion_bloques_180
  FOR DELETE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
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
-- 6. plantilla_excepciones_180 - ADMIN ONLY
-- ============================================================================
ALTER TABLE plantilla_excepciones_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_plantilla_excepciones_180" ON plantilla_excepciones_180;
CREATE POLICY "admin_select_plantilla_excepciones_180" ON plantilla_excepciones_180
  FOR SELECT
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_excepciones_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_insert_plantilla_excepciones_180" ON plantilla_excepciones_180;
CREATE POLICY "admin_insert_plantilla_excepciones_180" ON plantilla_excepciones_180
  FOR INSERT
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_excepciones_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_update_plantilla_excepciones_180" ON plantilla_excepciones_180;
CREATE POLICY "admin_update_plantilla_excepciones_180" ON plantilla_excepciones_180
  FOR UPDATE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_excepciones_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_excepciones_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_delete_plantilla_excepciones_180" ON plantilla_excepciones_180;
CREATE POLICY "admin_delete_plantilla_excepciones_180" ON plantilla_excepciones_180
  FOR DELETE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM plantillas_jornada_180 pj
      WHERE pj.id = plantilla_excepciones_180.plantilla_id
        AND pj.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 7. calendario_importacion_180 - ADMIN ONLY
-- ============================================================================
ALTER TABLE calendario_importacion_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_calendario_importacion_180" ON calendario_importacion_180;
CREATE POLICY "admin_select_calendario_importacion_180" ON calendario_importacion_180
  FOR SELECT
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "admin_insert_calendario_importacion_180" ON calendario_importacion_180;
CREATE POLICY "admin_insert_calendario_importacion_180" ON calendario_importacion_180
  FOR INSERT
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "admin_update_calendario_importacion_180" ON calendario_importacion_180;
CREATE POLICY "admin_update_calendario_importacion_180" ON calendario_importacion_180
  FOR UPDATE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  )
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "admin_delete_calendario_importacion_180" ON calendario_importacion_180;
CREATE POLICY "admin_delete_calendario_importacion_180" ON calendario_importacion_180
  FOR DELETE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

-- ============================================================================
-- 8. calendario_importacion_item_180 - ADMIN ONLY
-- ============================================================================
ALTER TABLE calendario_importacion_item_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_calendario_importacion_item_180" ON calendario_importacion_item_180;
CREATE POLICY "admin_select_calendario_importacion_item_180" ON calendario_importacion_item_180
  FOR SELECT
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM calendario_importacion_180 ci
      WHERE ci.id = calendario_importacion_item_180.importacion_id
        AND ci.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_insert_calendario_importacion_item_180" ON calendario_importacion_item_180;
CREATE POLICY "admin_insert_calendario_importacion_item_180" ON calendario_importacion_item_180
  FOR INSERT
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM calendario_importacion_180 ci
      WHERE ci.id = calendario_importacion_item_180.importacion_id
        AND ci.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_update_calendario_importacion_item_180" ON calendario_importacion_item_180;
CREATE POLICY "admin_update_calendario_importacion_item_180" ON calendario_importacion_item_180
  FOR UPDATE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM calendario_importacion_180 ci
      WHERE ci.id = calendario_importacion_item_180.importacion_id
        AND ci.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM calendario_importacion_180 ci
      WHERE ci.id = calendario_importacion_item_180.importacion_id
        AND ci.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_delete_calendario_importacion_item_180" ON calendario_importacion_item_180;
CREATE POLICY "admin_delete_calendario_importacion_item_180" ON calendario_importacion_item_180
  FOR DELETE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM calendario_importacion_180 ci
      WHERE ci.id = calendario_importacion_item_180.importacion_id
        AND ci.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 9. purchases_180 - ADMIN ONLY
-- ============================================================================
ALTER TABLE purchases_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_purchases_180" ON purchases_180;
CREATE POLICY "admin_select_purchases_180" ON purchases_180
  FOR SELECT
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "admin_insert_purchases_180" ON purchases_180;
CREATE POLICY "admin_insert_purchases_180" ON purchases_180
  FOR INSERT
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "admin_update_purchases_180" ON purchases_180;
CREATE POLICY "admin_update_purchases_180" ON purchases_180
  FOR UPDATE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  )
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "admin_delete_purchases_180" ON purchases_180;
CREATE POLICY "admin_delete_purchases_180" ON purchases_180
  FOR DELETE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
  );

-- ============================================================================
-- 10. time_logs_180 - ADMIN ONLY (empleados no pueden crear/editar)
-- ============================================================================
ALTER TABLE time_logs_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_time_logs_180" ON time_logs_180;
CREATE POLICY "admin_select_time_logs_180" ON time_logs_180
  FOR SELECT
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM employees_180 e
      WHERE e.id = time_logs_180.empleado_id
        AND e.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_insert_time_logs_180" ON time_logs_180;
CREATE POLICY "admin_insert_time_logs_180" ON time_logs_180
  FOR INSERT
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM employees_180 e
      WHERE e.id = time_logs_180.empleado_id
        AND e.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_update_time_logs_180" ON time_logs_180;
CREATE POLICY "admin_update_time_logs_180" ON time_logs_180
  FOR UPDATE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM employees_180 e
      WHERE e.id = time_logs_180.empleado_id
        AND e.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM employees_180 e
      WHERE e.id = time_logs_180.empleado_id
        AND e.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_delete_time_logs_180" ON time_logs_180;
CREATE POLICY "admin_delete_time_logs_180" ON time_logs_180
  FOR DELETE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM employees_180 e
      WHERE e.id = time_logs_180.empleado_id
        AND e.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 11. turno_bloques_180 - ADMIN ONLY
-- ============================================================================
ALTER TABLE turno_bloques_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_turno_bloques_180" ON turno_bloques_180;
CREATE POLICY "admin_select_turno_bloques_180" ON turno_bloques_180
  FOR SELECT
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM turnos_180 t
      WHERE t.id = turno_bloques_180.turno_id
        AND t.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_insert_turno_bloques_180" ON turno_bloques_180;
CREATE POLICY "admin_insert_turno_bloques_180" ON turno_bloques_180
  FOR INSERT
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM turnos_180 t
      WHERE t.id = turno_bloques_180.turno_id
        AND t.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_update_turno_bloques_180" ON turno_bloques_180;
CREATE POLICY "admin_update_turno_bloques_180" ON turno_bloques_180
  FOR UPDATE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM turnos_180 t
      WHERE t.id = turno_bloques_180.turno_id
        AND t.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM turnos_180 t
      WHERE t.id = turno_bloques_180.turno_id
        AND t.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_delete_turno_bloques_180" ON turno_bloques_180;
CREATE POLICY "admin_delete_turno_bloques_180" ON turno_bloques_180
  FOR DELETE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM turnos_180 t
      WHERE t.id = turno_bloques_180.turno_id
        AND t.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 12. work_items_180 - ADMIN ONLY
-- ============================================================================
ALTER TABLE work_items_180 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_work_items_180" ON work_items_180;
CREATE POLICY "admin_select_work_items_180" ON work_items_180
  FOR SELECT
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM work_logs_180 wl
      WHERE wl.id = work_items_180.work_log_id
        AND wl.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_insert_work_items_180" ON work_items_180;
CREATE POLICY "admin_insert_work_items_180" ON work_items_180
  FOR INSERT
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM work_logs_180 wl
      WHERE wl.id = work_items_180.work_log_id
        AND wl.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_update_work_items_180" ON work_items_180;
CREATE POLICY "admin_update_work_items_180" ON work_items_180
  FOR UPDATE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM work_logs_180 wl
      WHERE wl.id = work_items_180.work_log_id
        AND wl.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM work_logs_180 wl
      WHERE wl.id = work_items_180.work_log_id
        AND wl.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_delete_work_items_180" ON work_items_180;
CREATE POLICY "admin_delete_work_items_180" ON work_items_180
  FOR DELETE
  USING (
    (SELECT role FROM users_180 WHERE id = auth.uid()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM work_logs_180 wl
      WHERE wl.id = work_items_180.work_log_id
        AND wl.empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid())
    )
  );
