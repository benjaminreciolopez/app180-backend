-- 20260509_empresa_contexto_tipo.sql
--
-- Nivel 3 — separación despacho/clientes en el modelo de datos.
--
-- Añade columna `contexto_tipo` a empresa_180 con tres valores:
--   - 'despacho_propio'    : la empresa es la contabilidad propia de una asesoría
--                            (asesorias_180.empresa_id = esta.id)
--   - 'cliente_gestionado' : empresa vinculada a una asesoría como cliente
--                            (existe fila activa en asesoria_clientes_180 con esta.empresa_id,
--                             o gestionada_por_asesoria_id NOT NULL)
--   - 'autonomo'           : empresa estándar (autónomo / pyme con la app, sin asesoría)
--
-- Triggers mantienen el campo sincronizado ante cambios en asesorias_180 y
-- asesoria_clientes_180.
--
-- Beneficio: queries de agregados del asesor pueden distinguir su despacho de
-- sus clientes sin JOINs costosos, y la UI puede separar visualmente "Mi
-- Despacho" de "Mis Clientes".

-- =============================================================================
-- 1) Añadir columna y constraint
-- =============================================================================

ALTER TABLE empresa_180
  ADD COLUMN IF NOT EXISTS contexto_tipo TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'empresa_180_contexto_tipo_check'
  ) THEN
    ALTER TABLE empresa_180
      ADD CONSTRAINT empresa_180_contexto_tipo_check
      CHECK (contexto_tipo IN ('despacho_propio', 'cliente_gestionado', 'autonomo'));
  END IF;
END $$;

COMMENT ON COLUMN empresa_180.contexto_tipo IS
  'Clasificación de la empresa en el ecosistema asesor: despacho_propio (la empresa contable de una asesoría), cliente_gestionado (empresa cliente de una asesoría), autonomo (estándar).';

-- Índice para queries de agregados ("dame todos los clientes_gestionados de mi asesoría")
CREATE INDEX IF NOT EXISTS idx_empresa_180_contexto_tipo
  ON empresa_180 (contexto_tipo) WHERE contexto_tipo IS NOT NULL;

-- =============================================================================
-- 2) Backfill basado en estado actual
-- =============================================================================

-- 2.1) Empresas que son despacho propio de alguna asesoría
UPDATE empresa_180 e
SET contexto_tipo = 'despacho_propio'
FROM asesorias_180 a
WHERE a.empresa_id = e.id
  AND e.contexto_tipo IS NULL;

-- 2.2) Empresas vinculadas como cliente activo a una asesoría
UPDATE empresa_180 e
SET contexto_tipo = 'cliente_gestionado'
WHERE e.contexto_tipo IS NULL
  AND (
    e.gestionada_por_asesoria_id IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM asesoria_clientes_180 ac
      WHERE ac.empresa_id = e.id AND ac.estado = 'activo'
    )
  );

-- 2.3) Resto = autónomo estándar
UPDATE empresa_180
SET contexto_tipo = 'autonomo'
WHERE contexto_tipo IS NULL;

-- =============================================================================
-- 3) Trigger: mantener contexto_tipo cuando cambia asesoria_clientes_180
-- =============================================================================

CREATE OR REPLACE FUNCTION recalc_empresa_contexto_tipo(p_empresa_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tipo TEXT;
BEGIN
  -- Prioridad: despacho_propio gana sobre todo
  IF EXISTS (SELECT 1 FROM asesorias_180 WHERE empresa_id = p_empresa_id) THEN
    v_tipo := 'despacho_propio';
  ELSIF EXISTS (
    SELECT 1 FROM asesoria_clientes_180
    WHERE empresa_id = p_empresa_id AND estado = 'activo'
  ) OR EXISTS (
    SELECT 1 FROM empresa_180
    WHERE id = p_empresa_id AND gestionada_por_asesoria_id IS NOT NULL
  ) THEN
    v_tipo := 'cliente_gestionado';
  ELSE
    v_tipo := 'autonomo';
  END IF;

  UPDATE empresa_180
  SET contexto_tipo = v_tipo
  WHERE id = p_empresa_id
    AND (contexto_tipo IS DISTINCT FROM v_tipo);
END;
$$;

CREATE OR REPLACE FUNCTION trg_asesoria_clientes_recalc_contexto()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recalc_empresa_contexto_tipo(NEW.empresa_id);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM recalc_empresa_contexto_tipo(NEW.empresa_id);
    IF OLD.empresa_id IS DISTINCT FROM NEW.empresa_id THEN
      PERFORM recalc_empresa_contexto_tipo(OLD.empresa_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recalc_empresa_contexto_tipo(OLD.empresa_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_asesoria_clientes_recalc_contexto ON asesoria_clientes_180;
CREATE TRIGGER trg_asesoria_clientes_recalc_contexto
AFTER INSERT OR UPDATE OR DELETE ON asesoria_clientes_180
FOR EACH ROW EXECUTE FUNCTION trg_asesoria_clientes_recalc_contexto();

-- =============================================================================
-- 4) Trigger: mantener contexto_tipo cuando cambia asesorias_180.empresa_id
-- =============================================================================

CREATE OR REPLACE FUNCTION trg_asesorias_recalc_contexto()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.empresa_id IS NOT NULL THEN
      PERFORM recalc_empresa_contexto_tipo(NEW.empresa_id);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.empresa_id IS NOT NULL THEN
      PERFORM recalc_empresa_contexto_tipo(NEW.empresa_id);
    END IF;
    IF OLD.empresa_id IS NOT NULL AND OLD.empresa_id IS DISTINCT FROM NEW.empresa_id THEN
      PERFORM recalc_empresa_contexto_tipo(OLD.empresa_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.empresa_id IS NOT NULL THEN
      PERFORM recalc_empresa_contexto_tipo(OLD.empresa_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_asesorias_recalc_contexto ON asesorias_180;
CREATE TRIGGER trg_asesorias_recalc_contexto
AFTER INSERT OR UPDATE OR DELETE ON asesorias_180
FOR EACH ROW EXECUTE FUNCTION trg_asesorias_recalc_contexto();

-- =============================================================================
-- 5) Trigger: mantener contexto_tipo cuando cambia empresa_180.gestionada_por_asesoria_id
-- =============================================================================

CREATE OR REPLACE FUNCTION trg_empresa_180_recalc_contexto()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Solo recalcular si cambia gestionada_por_asesoria_id (no en otros UPDATEs).
  IF TG_OP = 'UPDATE' AND
     OLD.gestionada_por_asesoria_id IS NOT DISTINCT FROM NEW.gestionada_por_asesoria_id THEN
    RETURN NEW;
  END IF;

  -- Para INSERT, dejamos que el backfill o el resto de triggers se encarguen.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  PERFORM recalc_empresa_contexto_tipo(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_empresa_180_recalc_contexto ON empresa_180;
CREATE TRIGGER trg_empresa_180_recalc_contexto
AFTER UPDATE OF gestionada_por_asesoria_id ON empresa_180
FOR EACH ROW EXECUTE FUNCTION trg_empresa_180_recalc_contexto();
