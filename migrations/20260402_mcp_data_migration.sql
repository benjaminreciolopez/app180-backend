-- ============================================================
-- MCP: Migración de datos históricos
-- Ejecutar DESPUÉS de 20260402_mcp_ai_control.sql
-- ============================================================

-- 1. Migrar historial de consumo de construgest
INSERT INTO mcp_ai_consumption (app_id, org_id, user_id, provider, model,
  input_tokens, output_tokens, estimated_cost, key_source, operation, created_at)
SELECT
  'construgest',
  organization_id::text,
  user_id,
  provider,
  model,
  input_tokens,
  output_tokens,
  estimated_cost,
  key_source,
  operation,
  created_at
FROM cons_ai_consumption
ON CONFLICT DO NOTHING;

-- 2. Migrar precios de construgest
INSERT INTO mcp_ai_pricing (model, provider, input_price_per_million, output_price_per_million, updated_at)
SELECT model, provider, input_price_per_million, output_price_per_million, updated_at
FROM cons_ai_pricing
ON CONFLICT (model) DO UPDATE SET
  provider = EXCLUDED.provider,
  input_price_per_million = EXCLUDED.input_price_per_million,
  output_price_per_million = EXCLUDED.output_price_per_million,
  updated_at = EXCLUDED.updated_at;

-- 3. Migrar créditos de proveedores de construgest
INSERT INTO mcp_ai_provider_credits (provider, initial_amount, credit_type, notes, updated_at)
SELECT provider, initial_amount, credit_type, notes, updated_at
FROM cons_ai_provider_credits
ON CONFLICT (provider) DO UPDATE SET
  initial_amount = EXCLUDED.initial_amount,
  credit_type = EXCLUDED.credit_type,
  notes = EXCLUDED.notes,
  updated_at = EXCLUDED.updated_at;

-- 4. Migrar cuotas de app180 desde empresa_config_180
-- Cuotas diarias
INSERT INTO mcp_ai_quotas (app_id, org_id, quota_type, max_calls, credits_extra, bypass_user_ids, enabled)
SELECT
  'app180',
  c.empresa_id::text,
  'daily',
  COALESCE(c.ai_limite_diario, 10),
  COALESCE(c.ai_creditos_extra, 0),
  ARRAY[e.user_id],  -- creador bypass
  TRUE
FROM empresa_config_180 c
JOIN empresa_180 e ON c.empresa_id = e.id
WHERE c.ai_limite_diario IS NOT NULL
ON CONFLICT (app_id, org_id, quota_type) DO NOTHING;

-- Cuotas mensuales
INSERT INTO mcp_ai_quotas (app_id, org_id, quota_type, max_calls, bypass_user_ids, enabled)
SELECT
  'app180',
  c.empresa_id::text,
  'monthly',
  COALESCE(c.ai_limite_mensual, 300),
  ARRAY[e.user_id],  -- creador bypass
  TRUE
FROM empresa_config_180 c
JOIN empresa_180 e ON c.empresa_id = e.id
WHERE c.ai_limite_mensual IS NOT NULL
ON CONFLICT (app_id, org_id, quota_type) DO NOTHING;

-- 5. Insertar pricing de Claude Haiku (usado por app180) si no existe
INSERT INTO mcp_ai_pricing (model, provider, input_price_per_million, output_price_per_million)
VALUES ('claude-haiku-4-5-20251001', 'anthropic', 0.80, 4.00)
ON CONFLICT (model) DO NOTHING;

-- Insertar pricing de Claude Sonnet (usado por construgest)
INSERT INTO mcp_ai_pricing (model, provider, input_price_per_million, output_price_per_million)
VALUES ('claude-sonnet-4-20250514', 'anthropic', 3.00, 15.00)
ON CONFLICT (model) DO NOTHING;
