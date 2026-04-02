/**
 * MCP AI Tracker — Sistema centralizado de control de consumo IA
 * Módulo compartido entre app180 y construgest-web
 *
 * Uso:
 *   import { createMCPTracker } from './mcp-ai-tracker.js'
 *   const mcpTracker = createMCPTracker({ sql, appId: 'app180' })
 */

/**
 * @param {{ sql: import('postgres').Sql, appId: string }} config
 */
export function createMCPTracker({ sql, appId }) {
  if (!sql) throw new Error('mcp-ai-tracker: sql client is required')
  if (!appId) throw new Error('mcp-ai-tracker: appId is required')

  /**
   * Pre-flight: check if org/user has quota available (no recording)
   * @returns {{ allowed: boolean, reason: string, current?: number, limit?: number }}
   */
  async function checkQuota({ orgId, userId = null }) {
    try {
      const [result] = await sql`
        SELECT mcp_check_quota(${appId}, ${orgId}::text, ${userId}) as result
      `
      return result?.result || { allowed: true, reason: 'no_response' }
    } catch (err) {
      console.warn(`[mcp-tracker] checkQuota error: ${err.message}`)
      // Fail-open: allow if we can't check
      return { allowed: true, reason: 'check_error' }
    }
  }

  /**
   * Record AI usage (fire-and-forget, does NOT check quota)
   */
  async function recordUsage({
    orgId, userId = null, provider, model,
    inputTokens = 0, outputTokens = 0,
    estimatedCost = null, keySource = 'env',
    operation = 'chat', toolCalls = 0
  }) {
    try {
      let cost = estimatedCost
      if (cost === null) {
        cost = await estimateCostFromPricing(model, inputTokens, outputTokens)
      }

      await sql`
        INSERT INTO mcp_ai_consumption (
          app_id, org_id, user_id, provider, model,
          input_tokens, output_tokens, estimated_cost,
          key_source, operation, tool_calls
        ) VALUES (
          ${appId}, ${orgId}::text, ${userId}, ${provider}, ${model},
          ${inputTokens}, ${outputTokens}, ${Math.round((cost || 0) * 1000000) / 1000000},
          ${keySource}, ${operation}, ${toolCalls}
        )
      `
    } catch (err) {
      console.warn(`[mcp-tracker] recordUsage error: ${err.message}`)
    }
  }

  /**
   * Atomic: check quota + record usage in one call via RPC
   * @returns {{ allowed: boolean, recorded?: boolean, reason?: string }}
   */
  async function checkAndRecord({
    orgId, userId = null, provider, model,
    inputTokens = 0, outputTokens = 0,
    estimatedCost = null, keySource = 'env',
    operation = 'chat', toolCalls = 0
  }) {
    try {
      let cost = estimatedCost
      if (cost === null) {
        cost = await estimateCostFromPricing(model, inputTokens, outputTokens)
      }

      const [result] = await sql`
        SELECT mcp_check_and_record_usage(
          ${appId}, ${orgId}::text, ${userId}, ${provider}, ${model},
          ${inputTokens}, ${outputTokens},
          ${Math.round((cost || 0) * 1000000) / 1000000},
          ${keySource}, ${operation}, ${toolCalls}
        ) as result
      `
      return result?.result || { allowed: true, reason: 'no_response' }
    } catch (err) {
      console.warn(`[mcp-tracker] checkAndRecord error: ${err.message}`)
      return { allowed: true, reason: 'rpc_error' }
    }
  }

  /**
   * Get usage summary for dashboard
   * @param {{ orgId?: string, appFilter?: string, period?: 'day'|'month'|'all' }} options
   */
  async function getUsageSummary({ orgId = null, appFilter = null, period = 'month' } = {}) {
    try {
      let dateFilter = sql``
      if (period === 'day') {
        dateFilter = sql`AND created_at >= CURRENT_DATE`
      } else if (period === 'month') {
        dateFilter = sql`AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`
      }

      let orgFilter = sql``
      if (orgId) {
        orgFilter = sql`AND org_id = ${orgId}::text`
      }

      let appFilterSql = sql``
      if (appFilter) {
        appFilterSql = sql`AND app_id = ${appFilter}`
      }

      // Summary totals
      const totals = await sql`
        SELECT
          app_id,
          COUNT(*) as total_calls,
          COALESCE(SUM(input_tokens), 0) as total_input_tokens,
          COALESCE(SUM(output_tokens), 0) as total_output_tokens,
          COALESCE(SUM(estimated_cost), 0) as total_cost
        FROM mcp_ai_consumption
        WHERE 1=1 ${dateFilter} ${orgFilter} ${appFilterSql}
        GROUP BY app_id
        ORDER BY app_id
      `

      // By provider
      const byProvider = await sql`
        SELECT
          app_id, provider,
          COUNT(*) as calls,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(estimated_cost), 0) as cost
        FROM mcp_ai_consumption
        WHERE 1=1 ${dateFilter} ${orgFilter} ${appFilterSql}
        GROUP BY app_id, provider
        ORDER BY app_id, provider
      `

      // By user (top 20)
      const byUser = await sql`
        SELECT
          app_id, user_id,
          COUNT(*) as calls,
          COALESCE(SUM(estimated_cost), 0) as cost
        FROM mcp_ai_consumption
        WHERE 1=1 ${dateFilter} ${orgFilter} ${appFilterSql}
        GROUP BY app_id, user_id
        ORDER BY cost DESC
        LIMIT 20
      `

      return { totals, byProvider, byUser }
    } catch (err) {
      console.error(`[mcp-tracker] getUsageSummary error: ${err.message}`)
      return { totals: [], byProvider: [], byUser: [] }
    }
  }

  /**
   * Get quotas for an org (or all orgs)
   */
  async function getQuotas({ orgId = null, appFilter = null } = {}) {
    try {
      let filters = sql``
      if (orgId) filters = sql`${filters} AND org_id = ${orgId}::text`
      if (appFilter) filters = sql`${filters} AND app_id = ${appFilter}`

      return await sql`
        SELECT * FROM mcp_ai_quotas WHERE 1=1 ${filters} ORDER BY app_id, org_id, quota_type
      `
    } catch (err) {
      console.error(`[mcp-tracker] getQuotas error: ${err.message}`)
      return []
    }
  }

  /**
   * Update or create a quota
   */
  async function upsertQuota({ targetAppId, orgId, quotaType, maxCalls, maxCostUsd, maxTokens, creditsExtra, bypassUserIds, enabled }) {
    try {
      await sql`
        INSERT INTO mcp_ai_quotas (app_id, org_id, quota_type, max_calls, max_cost_usd, max_tokens, credits_extra, bypass_user_ids, enabled)
        VALUES (${targetAppId}, ${orgId}::text, ${quotaType}, ${maxCalls ?? null}, ${maxCostUsd ?? null}, ${maxTokens ?? null}, ${creditsExtra ?? 0}, ${bypassUserIds || []}, ${enabled ?? true})
        ON CONFLICT (app_id, org_id, quota_type)
        DO UPDATE SET
          max_calls = EXCLUDED.max_calls,
          max_cost_usd = EXCLUDED.max_cost_usd,
          max_tokens = EXCLUDED.max_tokens,
          credits_extra = EXCLUDED.credits_extra,
          bypass_user_ids = EXCLUDED.bypass_user_ids,
          enabled = EXCLUDED.enabled,
          updated_at = NOW()
      `
      return { success: true }
    } catch (err) {
      console.error(`[mcp-tracker] upsertQuota error: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  /**
   * Get pricing table
   */
  async function getPricing() {
    try {
      return await sql`SELECT * FROM mcp_ai_pricing ORDER BY provider, model`
    } catch (err) {
      console.error(`[mcp-tracker] getPricing error: ${err.message}`)
      return []
    }
  }

  /**
   * Upsert pricing for a model
   */
  async function upsertPricing({ model, provider, inputPricePerMillion, outputPricePerMillion }) {
    try {
      await sql`
        INSERT INTO mcp_ai_pricing (model, provider, input_price_per_million, output_price_per_million, updated_at)
        VALUES (${model}, ${provider}, ${inputPricePerMillion}, ${outputPricePerMillion}, NOW())
        ON CONFLICT (model)
        DO UPDATE SET
          provider = EXCLUDED.provider,
          input_price_per_million = EXCLUDED.input_price_per_million,
          output_price_per_million = EXCLUDED.output_price_per_million,
          updated_at = NOW()
      `
    } catch (err) {
      console.warn(`[mcp-tracker] upsertPricing error: ${err.message}`)
    }
  }

  /**
   * Get provider credits
   */
  async function getProviderCredits() {
    try {
      const credits = await sql`SELECT * FROM mcp_ai_provider_credits ORDER BY provider`

      // Calculate consumed per provider from mcp_ai_consumption
      const consumed = await sql`
        SELECT provider, COALESCE(SUM(estimated_cost), 0) as total_consumed
        FROM mcp_ai_consumption
        GROUP BY provider
      `
      const consumedMap = {}
      for (const c of consumed) {
        consumedMap[c.provider] = parseFloat(c.total_consumed)
      }

      return credits.map(c => ({
        ...c,
        consumed: consumedMap[c.provider] || 0,
        remaining: parseFloat(c.initial_amount) - (consumedMap[c.provider] || 0)
      }))
    } catch (err) {
      console.error(`[mcp-tracker] getProviderCredits error: ${err.message}`)
      return []
    }
  }

  /**
   * Update provider credits
   */
  async function upsertProviderCredits({ provider, initialAmount, creditType = 'credit', notes = null }) {
    try {
      await sql`
        INSERT INTO mcp_ai_provider_credits (provider, initial_amount, credit_type, notes, updated_at)
        VALUES (${provider}, ${initialAmount}, ${creditType}, ${notes}, NOW())
        ON CONFLICT (provider)
        DO UPDATE SET
          initial_amount = EXCLUDED.initial_amount,
          credit_type = EXCLUDED.credit_type,
          notes = EXCLUDED.notes,
          updated_at = NOW()
      `
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  /**
   * Estimate cost from mcp_ai_pricing table
   */
  async function estimateCostFromPricing(model, inputTokens, outputTokens) {
    try {
      const [pricing] = await sql`
        SELECT input_price_per_million, output_price_per_million
        FROM mcp_ai_pricing WHERE model = ${model} LIMIT 1
      `
      if (!pricing) return 0
      return (inputTokens * parseFloat(pricing.input_price_per_million) +
              outputTokens * parseFloat(pricing.output_price_per_million)) / 1_000_000
    } catch {
      return 0
    }
  }

  /**
   * Get daily consumption for trend charts
   */
  async function getDailyTrend({ orgId = null, appFilter = null, days = 30 } = {}) {
    try {
      let orgFilter = sql``
      if (orgId) orgFilter = sql`AND org_id = ${orgId}::text`
      let appFilterSql = sql``
      if (appFilter) appFilterSql = sql`AND app_id = ${appFilter}`

      return await sql`
        SELECT
          app_id,
          DATE(created_at) as date,
          COUNT(*) as calls,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(estimated_cost), 0) as cost
        FROM mcp_ai_consumption
        WHERE created_at >= CURRENT_DATE - ${days}::integer
        ${orgFilter} ${appFilterSql}
        GROUP BY app_id, DATE(created_at)
        ORDER BY date DESC
      `
    } catch (err) {
      console.error(`[mcp-tracker] getDailyTrend error: ${err.message}`)
      return []
    }
  }

  // ══════════════════════════════════════
  // Gestión de usuarios cross-app
  // ══════════════════════════════════════

  /**
   * Get all users across both apps (via mcp_users_view)
   */
  async function getAllUsers({ appFilter = null, search = null } = {}) {
    try {
      let appFilterSql = sql``
      if (appFilter) appFilterSql = sql`AND source_app = ${appFilter}`
      let searchSql = sql``
      if (search) searchSql = sql`AND (LOWER(email) LIKE ${'%' + search.toLowerCase() + '%'} OR LOWER(full_name) LIKE ${'%' + search.toLowerCase() + '%'})`

      const users = await sql`
        SELECT * FROM mcp_users_view
        WHERE 1=1 ${appFilterSql} ${searchSql}
        ORDER BY created_at DESC
      `

      // Enrich with consumption data
      const userIds = users.map(u => u.user_id).filter(Boolean)
      if (userIds.length === 0) return users

      const consumption = await sql`
        SELECT user_id, app_id,
          COUNT(*) as calls,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(estimated_cost), 0) as cost
        FROM mcp_ai_consumption
        WHERE user_id = ANY(${userIds})
        GROUP BY user_id, app_id
      `

      const consumptionMap = {}
      for (const c of consumption) {
        consumptionMap[`${c.user_id}:${c.app_id}`] = c
      }

      // Get user quotas
      const userQuotas = await sql`
        SELECT * FROM mcp_ai_user_quotas WHERE user_id = ANY(${userIds})
      `
      const quotaMap = {}
      for (const q of userQuotas) {
        if (!quotaMap[q.user_id]) quotaMap[q.user_id] = []
        quotaMap[q.user_id].push(q)
      }

      return users.map(u => {
        const c = consumptionMap[`${u.user_id}:${u.source_app}`] || {}
        return {
          ...u,
          ai_calls: parseInt(c.calls || 0),
          ai_input_tokens: parseInt(c.input_tokens || 0),
          ai_output_tokens: parseInt(c.output_tokens || 0),
          ai_cost: parseFloat(c.cost || 0),
          user_quotas: quotaMap[u.user_id] || []
        }
      })
    } catch (err) {
      console.error(`[mcp-tracker] getAllUsers error: ${err.message}`)
      return []
    }
  }

  /**
   * Get/set user-level quota
   */
  async function getUserQuotas({ userId }) {
    try {
      return await sql`SELECT * FROM mcp_ai_user_quotas WHERE user_id = ${userId}`
    } catch (err) {
      console.error(`[mcp-tracker] getUserQuotas error: ${err.message}`)
      return []
    }
  }

  async function upsertUserQuota({ targetAppId, userId, quotaType, maxCalls, maxTokens, maxCostUsd, enabled }) {
    try {
      await sql`
        INSERT INTO mcp_ai_user_quotas (app_id, user_id, quota_type, max_calls, max_tokens, max_cost_usd, enabled)
        VALUES (${targetAppId}, ${userId}, ${quotaType}, ${maxCalls ?? null}, ${maxTokens ?? null}, ${maxCostUsd ?? null}, ${enabled ?? true})
        ON CONFLICT (app_id, user_id, quota_type)
        DO UPDATE SET
          max_calls = EXCLUDED.max_calls,
          max_tokens = EXCLUDED.max_tokens,
          max_cost_usd = EXCLUDED.max_cost_usd,
          enabled = EXCLUDED.enabled,
          updated_at = NOW()
      `
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  /**
   * Toggle AI enabled for a user (updates source table directly)
   */
  async function toggleUserAI({ userId, sourceApp, enabled }) {
    try {
      if (sourceApp === 'app180') {
        await sql`UPDATE users_180 SET ai_enabled = ${enabled} WHERE id = ${userId}`
      } else if (sourceApp === 'construgest') {
        await sql`UPDATE cons_users SET ai_enabled = ${enabled} WHERE id = ${userId}`
      }
      return { success: true, ai_enabled: enabled }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  /**
   * Update user's app field
   */
  async function updateUserApp({ userId, sourceApp, app }) {
    try {
      if (sourceApp === 'app180') {
        await sql`UPDATE users_180 SET app = ${app} WHERE id = ${userId}`
      } else if (sourceApp === 'construgest') {
        await sql`UPDATE cons_users SET app = ${app} WHERE id = ${userId}`
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  /**
   * Get consumption for a specific user
   */
  async function getUserConsumption({ userId, period = 'month' }) {
    try {
      let dateFilter = sql``
      if (period === 'day') dateFilter = sql`AND created_at >= CURRENT_DATE`
      else if (period === 'month') dateFilter = sql`AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`

      return await sql`
        SELECT app_id, provider, model, operation,
          COUNT(*) as calls,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(estimated_cost), 0) as cost
        FROM mcp_ai_consumption
        WHERE user_id = ${userId} ${dateFilter}
        GROUP BY app_id, provider, model, operation
        ORDER BY cost DESC
      `
    } catch (err) {
      console.error(`[mcp-tracker] getUserConsumption error: ${err.message}`)
      return []
    }
  }

  return {
    checkQuota,
    recordUsage,
    checkAndRecord,
    getUsageSummary,
    getQuotas,
    upsertQuota,
    getPricing,
    upsertPricing,
    getProviderCredits,
    upsertProviderCredits,
    getDailyTrend,
    estimateCost: estimateCostFromPricing,
    // User management
    getAllUsers,
    getUserQuotas,
    upsertUserQuota,
    toggleUserAI,
    updateUserApp,
    getUserConsumption,
  }
}
