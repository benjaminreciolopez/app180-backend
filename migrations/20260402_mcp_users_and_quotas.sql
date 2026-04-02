-- ============================================================
-- MCP: Usuarios unificados + cuotas por usuario individual
-- ============================================================

-- 1. Añadir columna 'app' a users_180
ALTER TABLE users_180 ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'app180';

-- 2. Añadir columna 'app' a cons_users
ALTER TABLE cons_users ADD COLUMN IF NOT EXISTS app TEXT DEFAULT 'construgest';

-- 3. Añadir columna 'ai_enabled' a users_180 (construgest ya la tiene)
ALTER TABLE users_180 ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN DEFAULT TRUE;

-- 4. Cuotas por usuario individual
CREATE TABLE IF NOT EXISTS mcp_ai_user_quotas (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  app_id          TEXT NOT NULL,                          -- 'app180' | 'construgest'
  user_id         UUID NOT NULL,
  quota_type      TEXT NOT NULL DEFAULT 'daily',          -- 'daily', 'monthly'
  max_calls       INTEGER,                                -- null = usa cuota de org
  max_tokens      BIGINT,                                 -- null = sin límite de tokens
  max_cost_usd    NUMERIC(10,4),                          -- null = sin límite de costo
  enabled         BOOLEAN DEFAULT TRUE,                   -- kill switch individual
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(app_id, user_id, quota_type)
);

CREATE INDEX IF NOT EXISTS idx_mcp_user_quotas_user ON mcp_ai_user_quotas(user_id);

-- 5. Vista unificada de usuarios cross-app (materializable)
CREATE OR REPLACE VIEW mcp_users_view AS
SELECT
  u.id AS user_id,
  u.email,
  u.nombre AS full_name,
  u.avatar_url,
  u.role,
  u.app,
  u.ai_enabled,
  u.created_at,
  e.id AS org_id,
  e.nombre AS org_name,
  'app180' AS source_app
FROM users_180 u
LEFT JOIN empresa_180 e ON e.user_id = u.id
UNION ALL
SELECT
  cu.id AS user_id,
  cu.email,
  cu.full_name,
  cu.avatar_url,
  COALESCE(om.role, 'member') AS role,
  cu.app,
  cu.ai_enabled,
  cu.created_at,
  om.organization_id AS org_id,
  o.name AS org_name,
  'construgest' AS source_app
FROM cons_users cu
LEFT JOIN cons_organization_members om ON om.user_id = cu.id
LEFT JOIN cons_organizations o ON o.id = om.organization_id;

-- 6. Actualizar datos existentes
UPDATE users_180 SET app = 'app180' WHERE app IS NULL;
UPDATE cons_users SET app = 'construgest' WHERE app IS NULL;

-- ============================================================
-- Actualizar RPC: verificar cuotas por usuario individual
-- ============================================================
CREATE OR REPLACE FUNCTION mcp_check_quota(
  p_app_id TEXT,
  p_org_id TEXT,
  p_user_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_daily_quota  RECORD;
  v_monthly_quota RECORD;
  v_user_daily   RECORD;
  v_user_monthly RECORD;
  v_daily_usage  RECORD;
  v_monthly_usage RECORD;
  v_user_daily_usage RECORD;
  v_user_monthly_usage RECORD;
  v_today        DATE := CURRENT_DATE;
  v_month_start  DATE := DATE_TRUNC('month', CURRENT_DATE)::DATE;
  v_is_bypass    BOOLEAN := FALSE;
  v_user_enabled BOOLEAN := TRUE;
BEGIN
  -- ── 1. Verificar si el usuario tiene IA habilitada ──
  IF p_user_id IS NOT NULL THEN
    -- Verificar user-level enable/disable
    SELECT enabled INTO v_user_enabled FROM mcp_ai_user_quotas
      WHERE app_id = p_app_id AND user_id = p_user_id AND quota_type = 'daily' LIMIT 1;
    IF v_user_enabled IS NOT NULL AND NOT v_user_enabled THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'user_disabled');
    END IF;
  END IF;

  -- ── 2. Verificar cuotas a nivel de organización ──
  SELECT * INTO v_daily_quota FROM mcp_ai_quotas
    WHERE app_id = p_app_id AND org_id = p_org_id AND quota_type = 'daily';

  SELECT * INTO v_monthly_quota FROM mcp_ai_quotas
    WHERE app_id = p_app_id AND org_id = p_org_id AND quota_type = 'monthly';

  -- Kill switch de org
  IF (v_daily_quota IS NOT NULL AND NOT v_daily_quota.enabled) OR
     (v_monthly_quota IS NOT NULL AND NOT v_monthly_quota.enabled) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'ai_disabled');
  END IF;

  -- Verificar bypass de org
  IF p_user_id IS NOT NULL THEN
    IF (v_daily_quota IS NOT NULL AND p_user_id = ANY(v_daily_quota.bypass_user_ids)) OR
       (v_monthly_quota IS NOT NULL AND p_user_id = ANY(v_monthly_quota.bypass_user_ids)) THEN
      v_is_bypass := TRUE;
    END IF;
  END IF;

  -- ── 3. Verificar cuotas POR USUARIO (tienen prioridad) ──
  IF p_user_id IS NOT NULL AND NOT v_is_bypass THEN
    SELECT * INTO v_user_daily FROM mcp_ai_user_quotas
      WHERE app_id = p_app_id AND user_id = p_user_id AND quota_type = 'daily';

    SELECT * INTO v_user_monthly FROM mcp_ai_user_quotas
      WHERE app_id = p_app_id AND user_id = p_user_id AND quota_type = 'monthly';

    -- Cuota diaria por usuario
    IF v_user_daily IS NOT NULL AND v_user_daily.max_calls IS NOT NULL THEN
      SELECT COUNT(*) as calls INTO v_user_daily_usage
      FROM mcp_ai_consumption
      WHERE app_id = p_app_id AND user_id = p_user_id AND created_at >= v_today;

      IF v_user_daily_usage.calls >= v_user_daily.max_calls THEN
        RETURN jsonb_build_object(
          'allowed', false, 'reason', 'user_daily_limit',
          'current', v_user_daily_usage.calls, 'limit', v_user_daily.max_calls
        );
      END IF;
    END IF;

    -- Cuota mensual por usuario
    IF v_user_monthly IS NOT NULL AND v_user_monthly.max_calls IS NOT NULL THEN
      SELECT COUNT(*) as calls INTO v_user_monthly_usage
      FROM mcp_ai_consumption
      WHERE app_id = p_app_id AND user_id = p_user_id AND created_at >= v_month_start;

      IF v_user_monthly_usage.calls >= v_user_monthly.max_calls THEN
        RETURN jsonb_build_object(
          'allowed', false, 'reason', 'user_monthly_limit',
          'current', v_user_monthly_usage.calls, 'limit', v_user_monthly.max_calls
        );
      END IF;
    END IF;
  END IF;

  -- ── 4. Verificar cuotas de ORG (si no hay bypass ni cuota user) ──
  IF NOT v_is_bypass THEN
    -- Si no hay cuotas de org, permitir
    IF v_daily_quota IS NULL AND v_monthly_quota IS NULL THEN
      RETURN jsonb_build_object('allowed', true, 'reason', 'no_quotas');
    END IF;

    -- Uso diario org
    IF v_daily_quota IS NOT NULL AND v_daily_quota.max_calls IS NOT NULL THEN
      SELECT COUNT(*) as calls INTO v_daily_usage
      FROM mcp_ai_consumption
      WHERE app_id = p_app_id AND org_id = p_org_id AND created_at >= v_today;

      IF v_daily_usage.calls >= v_daily_quota.max_calls AND COALESCE(v_daily_quota.credits_extra, 0) <= 0 THEN
        RETURN jsonb_build_object(
          'allowed', false, 'reason', 'daily_limit',
          'current', v_daily_usage.calls, 'limit', v_daily_quota.max_calls
        );
      END IF;
    END IF;

    -- Uso mensual org
    IF v_monthly_quota IS NOT NULL AND v_monthly_quota.max_calls IS NOT NULL THEN
      SELECT COUNT(*) as calls INTO v_monthly_usage
      FROM mcp_ai_consumption
      WHERE app_id = p_app_id AND org_id = p_org_id AND created_at >= v_month_start;

      IF v_monthly_usage.calls >= v_monthly_quota.max_calls AND COALESCE(v_monthly_quota.credits_extra, 0) <= 0 THEN
        RETURN jsonb_build_object(
          'allowed', false, 'reason', 'monthly_limit',
          'current', v_monthly_usage.calls, 'limit', v_monthly_quota.max_calls
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', 'within_limits');
END;
$$ LANGUAGE plpgsql;

-- ── Actualizar también mcp_check_and_record_usage ──
CREATE OR REPLACE FUNCTION mcp_check_and_record_usage(
  p_app_id        TEXT,
  p_org_id        TEXT,
  p_user_id       UUID,
  p_provider      TEXT,
  p_model         TEXT,
  p_input_tokens  INTEGER DEFAULT 0,
  p_output_tokens INTEGER DEFAULT 0,
  p_estimated_cost NUMERIC DEFAULT 0,
  p_key_source    TEXT DEFAULT 'env',
  p_operation     TEXT DEFAULT 'chat',
  p_tool_calls    INTEGER DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
  v_check JSONB;
  v_daily_quota RECORD;
  v_daily_usage RECORD;
  v_today DATE := CURRENT_DATE;
BEGIN
  -- Pre-check (ahora incluye verificación por usuario)
  v_check := mcp_check_quota(p_app_id, p_org_id, p_user_id);

  IF NOT (v_check->>'allowed')::BOOLEAN THEN
    RETURN v_check;
  END IF;

  -- Registrar consumo
  INSERT INTO mcp_ai_consumption (
    app_id, org_id, user_id, provider, model,
    input_tokens, output_tokens, estimated_cost,
    key_source, operation, tool_calls
  ) VALUES (
    p_app_id, p_org_id, p_user_id, p_provider, p_model,
    p_input_tokens, p_output_tokens, p_estimated_cost,
    p_key_source, p_operation, p_tool_calls
  );

  -- Descontar crédito extra si superó límite diario de org
  SELECT * INTO v_daily_quota FROM mcp_ai_quotas
    WHERE app_id = p_app_id AND org_id = p_org_id AND quota_type = 'daily';

  IF v_daily_quota IS NOT NULL AND v_daily_quota.max_calls IS NOT NULL THEN
    SELECT COUNT(*) as calls INTO v_daily_usage
    FROM mcp_ai_consumption
    WHERE app_id = p_app_id AND org_id = p_org_id AND created_at >= v_today;

    IF v_daily_usage.calls > v_daily_quota.max_calls AND COALESCE(v_daily_quota.credits_extra, 0) > 0 THEN
      UPDATE mcp_ai_quotas SET credits_extra = credits_extra - 1, updated_at = NOW()
      WHERE app_id = p_app_id AND org_id = p_org_id AND quota_type = 'daily';
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'recorded', true);
END;
$$ LANGUAGE plpgsql;
