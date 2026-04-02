-- ============================================================
-- MCP: Sistema Centralizado de Control de Consumo IA
-- Tablas compartidas entre app180 y construgest-web
-- ============================================================

-- 1. Log unificado de consumo IA
CREATE TABLE IF NOT EXISTS mcp_ai_consumption (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  app_id          TEXT NOT NULL,                          -- 'app180' | 'construgest'
  org_id          TEXT NOT NULL,                          -- empresa_id o organization_id
  user_id         UUID,
  provider        TEXT NOT NULL,                          -- 'anthropic', 'groq', 'gemini'
  model           TEXT NOT NULL,
  input_tokens    INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  estimated_cost  NUMERIC(12,8) DEFAULT 0,
  key_source      TEXT DEFAULT 'env',                     -- 'env', 'own', 'master'
  operation       TEXT DEFAULT 'chat',
  tool_calls      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_consumption_app_org ON mcp_ai_consumption(app_id, org_id);
CREATE INDEX IF NOT EXISTS idx_mcp_consumption_user ON mcp_ai_consumption(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_consumption_created ON mcp_ai_consumption(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_consumption_app_org_month ON mcp_ai_consumption(app_id, org_id, created_at);

-- 2. Cuotas/límites por app+org
CREATE TABLE IF NOT EXISTS mcp_ai_quotas (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  app_id          TEXT NOT NULL,
  org_id          TEXT NOT NULL,
  quota_type      TEXT NOT NULL DEFAULT 'monthly',        -- 'daily', 'monthly'
  max_calls       INTEGER,                                -- null = sin límite
  max_cost_usd    NUMERIC(10,4),                          -- null = sin límite
  max_tokens      BIGINT,                                 -- null = sin límite
  credits_extra   INTEGER DEFAULT 0,
  bypass_user_ids UUID[] DEFAULT '{}',                    -- usuarios sin límite (ej: creador)
  enabled         BOOLEAN DEFAULT TRUE,                   -- kill switch IA para este org+app
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(app_id, org_id, quota_type)
);

-- 3. Precios por modelo (unificado)
CREATE TABLE IF NOT EXISTS mcp_ai_pricing (
  model                    TEXT PRIMARY KEY,
  provider                 TEXT NOT NULL,
  input_price_per_million  NUMERIC(10,6) NOT NULL,
  output_price_per_million NUMERIC(10,6) NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Créditos cargados por proveedor
CREATE TABLE IF NOT EXISTS mcp_ai_provider_credits (
  provider       TEXT PRIMARY KEY,
  initial_amount NUMERIC(10,4) NOT NULL DEFAULT 0,
  credit_type    TEXT NOT NULL DEFAULT 'credit',          -- 'credit' (prepaid) o 'usage'
  notes          TEXT,
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RPC: Verificar cuota (pre-flight, sin registrar)
-- ============================================================
CREATE OR REPLACE FUNCTION mcp_check_quota(
  p_app_id TEXT,
  p_org_id TEXT,
  p_user_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_daily_quota  RECORD;
  v_monthly_quota RECORD;
  v_daily_usage  RECORD;
  v_monthly_usage RECORD;
  v_today        DATE := CURRENT_DATE;
  v_month_start  DATE := DATE_TRUNC('month', CURRENT_DATE)::DATE;
  v_is_bypass    BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_daily_quota FROM mcp_ai_quotas
    WHERE app_id = p_app_id AND org_id = p_org_id AND quota_type = 'daily';

  SELECT * INTO v_monthly_quota FROM mcp_ai_quotas
    WHERE app_id = p_app_id AND org_id = p_org_id AND quota_type = 'monthly';

  -- Si no hay cuotas configuradas, permitir
  IF v_daily_quota IS NULL AND v_monthly_quota IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'no_quotas');
  END IF;

  -- Kill switch
  IF (v_daily_quota IS NOT NULL AND NOT v_daily_quota.enabled) OR
     (v_monthly_quota IS NOT NULL AND NOT v_monthly_quota.enabled) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'ai_disabled');
  END IF;

  -- Verificar bypass
  IF p_user_id IS NOT NULL THEN
    IF (v_daily_quota IS NOT NULL AND p_user_id = ANY(v_daily_quota.bypass_user_ids)) OR
       (v_monthly_quota IS NOT NULL AND p_user_id = ANY(v_monthly_quota.bypass_user_ids)) THEN
      v_is_bypass := TRUE;
    END IF;
  END IF;

  IF v_is_bypass THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'bypass');
  END IF;

  -- Uso diario
  IF v_daily_quota IS NOT NULL AND v_daily_quota.max_calls IS NOT NULL THEN
    SELECT COUNT(*) as calls, COALESCE(SUM(estimated_cost), 0) as cost
    INTO v_daily_usage
    FROM mcp_ai_consumption
    WHERE app_id = p_app_id AND org_id = p_org_id AND created_at >= v_today;

    IF v_daily_usage.calls >= v_daily_quota.max_calls AND COALESCE(v_daily_quota.credits_extra, 0) <= 0 THEN
      RETURN jsonb_build_object(
        'allowed', false, 'reason', 'daily_limit',
        'current', v_daily_usage.calls, 'limit', v_daily_quota.max_calls
      );
    END IF;
  END IF;

  -- Uso mensual
  IF v_monthly_quota IS NOT NULL AND v_monthly_quota.max_calls IS NOT NULL THEN
    SELECT COUNT(*) as calls, COALESCE(SUM(estimated_cost), 0) as cost
    INTO v_monthly_usage
    FROM mcp_ai_consumption
    WHERE app_id = p_app_id AND org_id = p_org_id AND created_at >= v_month_start;

    IF v_monthly_usage.calls >= v_monthly_quota.max_calls AND COALESCE(v_monthly_quota.credits_extra, 0) <= 0 THEN
      RETURN jsonb_build_object(
        'allowed', false, 'reason', 'monthly_limit',
        'current', v_monthly_usage.calls, 'limit', v_monthly_quota.max_calls
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', 'within_limits');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RPC: Verificar cuota + registrar consumo (atómico)
-- ============================================================
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
  -- Pre-check quota
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

  -- Descontar crédito extra si superó límite diario
  SELECT * INTO v_daily_quota FROM mcp_ai_quotas
    WHERE app_id = p_app_id AND org_id = p_org_id AND quota_type = 'daily';

  IF v_daily_quota IS NOT NULL AND v_daily_quota.max_calls IS NOT NULL THEN
    SELECT COUNT(*) as calls INTO v_daily_usage
    FROM mcp_ai_consumption
    WHERE app_id = p_app_id AND org_id = p_org_id AND created_at >= v_today;

    -- Si estamos por encima del límite (usamos crédito extra)
    IF v_daily_usage.calls > v_daily_quota.max_calls AND COALESCE(v_daily_quota.credits_extra, 0) > 0 THEN
      UPDATE mcp_ai_quotas SET credits_extra = credits_extra - 1, updated_at = NOW()
      WHERE app_id = p_app_id AND org_id = p_org_id AND quota_type = 'daily';
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'recorded', true);
END;
$$ LANGUAGE plpgsql;
