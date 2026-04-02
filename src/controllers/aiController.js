import { chatConAgente } from "../services/aiAgentService.js";
import { sql } from "../db.js";
import { processInvoiceFile } from "../services/ocr/qrExtractor.js";
import { ocrExtractTextFromUpload } from "../services/ocr/ocrEngine.js";
import { createMCPTracker } from "../services/mcp-ai-tracker.js";

const mcpTracker = createMCPTracker({ sql, appId: 'app180' });
const FABRICANTE_EMAIL = process.env.FABRICANTE_EMAIL || "susanaybenjamin@gmail.com";

/**
 * Obtiene el ID de la empresa del usuario autenticado
 */
async function getEmpresaId(userIdOrReq) {
  if (typeof userIdOrReq === 'object' && userIdOrReq.user) {
    if (userIdOrReq.user.empresa_id) return userIdOrReq.user.empresa_id;
    userIdOrReq = userIdOrReq.user.id;
  }
  const r = await sql`select id from empresa_180 where user_id=${userIdOrReq} limit 1`;
  if (!r[0]) {
    const e = new Error("Empresa no asociada");
    e.status = 403;
    throw e;
  }
  return r[0].id;
}

/**
 * POST /admin/ai/chat
 * Endpoint para chatear con el agente IA
 */
export async function chat(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { mensaje, historial } = req.body;

    if (!mensaje || typeof mensaje !== 'string') {
      return res.status(400).json({ error: "El mensaje es requerido" });
    }

    const empresaId = await getEmpresaId(userId);

    // Llamar al servicio de IA
    const respuesta = await chatConAgente({
      empresaId,
      userId,
      userRole,
      mensaje,
      historial: historial || []
    });

    // Si se alcanzo el limite, devolver 429
    if (respuesta.limite_alcanzado) {
      return res.status(429).json({
        error: respuesta.mensaje,
        limite_alcanzado: true,
        tipo_limite: respuesta.tipo_limite
      });
    }

    res.json({
      mensaje: respuesta.mensaje,
      timestamp: new Date().toISOString(),
      accion_realizada: respuesta.accion_realizada || false,
      clarificacion: respuesta.clarificacion || null
    });

  } catch (error) {
    console.error("[AI Controller] Error:", error);

    if (error.message?.includes("API key")) {
      return res.status(500).json({
        error: "Servicio de IA no configurado. Contacta al administrador."
      });
    }

    res.status(500).json({
      error: error.message || "Error al procesar tu mensaje"
    });
  }
}

/**
 * POST /admin/ai/chat-with-file
 * Chat con archivo adjunto (PDF/imagen) - extrae QR + texto para CONTENDO
 */
export async function chatWithFile(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const mensaje = req.body.mensaje || "Analiza este documento y extrae los datos fiscales del QR si lo tiene.";
    const historial = req.body.historial ? JSON.parse(req.body.historial) : [];
    const password = req.body.password || null;

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No se subió ningún archivo" });
    }

    const empresaId = await getEmpresaId(userId);

    // 1. Extraer QR del archivo
    let qrResult = null;
    try {
      qrResult = await processInvoiceFile(file.buffer, file.mimetype, password);
    } catch (err) {
      if (err.code === "PDF_PASSWORD_REQUIRED") {
        return res.status(400).json({ error: err.message, code: "PDF_PASSWORD_REQUIRED" });
      }
      console.warn("[AI+QR] Error extrayendo QR:", err.message);
    }

    // 2. Extraer texto OCR del archivo
    let ocrText = "";
    try {
      ocrText = await ocrExtractTextFromUpload(file);
    } catch (err) {
      console.warn("[AI+QR] Error OCR:", err.message);
      // Si falla OCR, usar el texto del QR extractor
      if (qrResult?.textContent) {
        ocrText = qrResult.textContent;
      }
    }

    // 3. Construir contexto enriquecido para CONTENDO
    let fileContext = `\n\n---\n📎 **Archivo adjunto**: ${file.originalname}\n`;

    if (qrResult?.qrData) {
      const qr = qrResult.qrData;
      fileContext += `\n🔍 **Datos extraídos del QR de la factura**:\n`;
      if (qr.tipo) fileContext += `- Tipo QR: ${qr.tipo}\n`;
      if (qr.nif_emisor) fileContext += `- NIF emisor: ${qr.nif_emisor}\n`;
      if (qr.serie) fileContext += `- Serie: ${qr.serie}\n`;
      if (qr.numero_factura) fileContext += `- Número factura: ${qr.numero_factura}\n`;
      if (qr.fecha) fileContext += `- Fecha: ${qr.fecha}\n`;
      if (qr.importe_total) fileContext += `- Importe total: ${qr.importe_total}€\n`;
      if (qr.url) fileContext += `- URL: ${qr.url}\n`;
    } else if (qrResult?.qrRaw?.length > 0) {
      fileContext += `\n🔍 **QR detectado (sin formato conocido)**: ${qrResult.qrRaw[0]}\n`;
    } else {
      fileContext += `\n⚠️ No se detectó código QR en el documento.\n`;
    }

    if (ocrText && ocrText.length > 10) {
      // Limitar texto OCR para no exceder tokens
      const truncated = ocrText.length > 3000 ? ocrText.substring(0, 3000) + "..." : ocrText;
      fileContext += `\n📄 **Texto extraído del documento**:\n\`\`\`\n${truncated}\n\`\`\`\n`;
    }

    // 4. Enviar al agente con contexto enriquecido
    const mensajeEnriquecido = mensaje + fileContext;

    const respuesta = await chatConAgente({
      empresaId,
      userId,
      userRole,
      mensaje: mensajeEnriquecido,
      historial
    });

    // Si se alcanzo el limite, devolver 429
    if (respuesta.limite_alcanzado) {
      return res.status(429).json({
        error: respuesta.mensaje,
        limite_alcanzado: true,
        tipo_limite: respuesta.tipo_limite
      });
    }

    res.json({
      mensaje: respuesta.mensaje,
      timestamp: new Date().toISOString(),
      accion_realizada: respuesta.accion_realizada || false,
      clarificacion: respuesta.clarificacion || null,
      qr_detectado: !!qrResult?.qrData,
      qr_data: qrResult?.qrData || null
    });

  } catch (error) {
    console.error("[AI+File] Error:", error);
    res.status(500).json({
      error: error.message || "Error al procesar el archivo"
    });
  }
}

/**
 * GET /admin/ai/usage
 * Devuelve el estado de consumo de IA del usuario (desde MCP centralizado)
 */
export async function usage(req, res) {
  try {
    const userId = req.user.id;
    const empresaId = await getEmpresaId(userId);

    // Obtener datos de cuota del MCP
    const quotas = await mcpTracker.getQuotas({ orgId: empresaId, appFilter: 'app180' });
    const dailyQuota = quotas.find(q => q.quota_type === 'daily');
    const monthlyQuota = quotas.find(q => q.quota_type === 'monthly');

    // Obtener consumo actual desde mcp_ai_consumption
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.substring(0, 7) + '-01';

    const [dailyUsage] = await sql`
      SELECT COUNT(*) as calls FROM mcp_ai_consumption
      WHERE app_id = 'app180' AND org_id = ${empresaId}::text AND created_at >= ${today}::date
    `;
    const [monthlyUsage] = await sql`
      SELECT COUNT(*) as calls FROM mcp_ai_consumption
      WHERE app_id = 'app180' AND org_id = ${empresaId}::text AND created_at >= ${monthStart}::date
    `;

    const consultasHoy = parseInt(dailyUsage?.calls || 0);
    const consultasMes = parseInt(monthlyUsage?.calls || 0);
    const limiteDiario = dailyQuota?.max_calls ?? 10;
    const limiteMensual = monthlyQuota?.max_calls ?? 300;
    const creditosExtra = dailyQuota?.credits_extra || 0;
    const esCreador = dailyQuota?.bypass_user_ids?.includes(userId) || monthlyQuota?.bypass_user_ids?.includes(userId) || false;

    res.json({
      consultas_hoy: consultasHoy,
      limite_diario: limiteDiario,
      consultas_mes: consultasMes,
      limite_mensual: limiteMensual,
      creditos_extra: creditosExtra,
      es_creador: esCreador,
      sin_limites: esCreador,
      pct_diario: limiteDiario > 0 ? Math.min(100, Math.round((consultasHoy / limiteDiario) * 100)) : 100,
      pct_mensual: limiteMensual > 0 ? Math.min(100, Math.round((consultasMes / limiteMensual) * 100)) : 100
    });
  } catch (error) {
    console.error("[AI Controller] Error en usage:", error);
    res.status(500).json({ error: error.message });
  }
}

// ==========================================
// MCP: Endpoints de control centralizado
// ==========================================

/**
 * GET /admin/ai/mcp/consumption
 * Consumo cross-app (ambas apps)
 */
export async function mcpConsumption(req, res) {
  try {
    const { period = 'month', app_id } = req.query;
    const userId = req.user.id;
    const empresaId = await getEmpresaId(userId);

    const summary = await mcpTracker.getUsageSummary({
      orgId: empresaId,
      appFilter: app_id || null,
      period
    });

    res.json(summary);
  } catch (error) {
    console.error("[MCP] Error en consumption:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /admin/ai/mcp/consumption/global
 * Consumo global (todas las orgs, solo para fabricante/super-admin)
 */
export async function mcpConsumptionGlobal(req, res) {
  try {
    const { period = 'month', app_id } = req.query;

    const summary = await mcpTracker.getUsageSummary({
      appFilter: app_id || null,
      period
    });

    res.json(summary);
  } catch (error) {
    console.error("[MCP] Error en consumption global:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /admin/ai/mcp/quotas
 * Cuotas configuradas
 */
export async function mcpQuotas(req, res) {
  try {
    const { app_id } = req.query;
    const userId = req.user.id;
    const empresaId = await getEmpresaId(userId);

    const quotas = await mcpTracker.getQuotas({
      orgId: empresaId,
      appFilter: app_id || null
    });

    res.json(quotas);
  } catch (error) {
    console.error("[MCP] Error en quotas:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * PUT /admin/ai/mcp/quotas
 * Actualizar cuota
 */
export async function mcpUpdateQuota(req, res) {
  try {
    const { targetAppId, orgId, quotaType, maxCalls, maxCostUsd, maxTokens, creditsExtra, bypassUserIds, enabled } = req.body;

    if (!targetAppId || !orgId || !quotaType) {
      return res.status(400).json({ error: 'targetAppId, orgId y quotaType son requeridos' });
    }

    const result = await mcpTracker.upsertQuota({
      targetAppId, orgId, quotaType,
      maxCalls, maxCostUsd, maxTokens,
      creditsExtra, bypassUserIds, enabled
    });

    res.json(result);
  } catch (error) {
    console.error("[MCP] Error en updateQuota:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /admin/ai/mcp/pricing
 * Tabla de precios
 */
export async function mcpPricing(req, res) {
  try {
    const pricing = await mcpTracker.getPricing();
    res.json(pricing);
  } catch (error) {
    console.error("[MCP] Error en pricing:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /admin/ai/mcp/provider-credits
 * Créditos por proveedor con consumido
 */
export async function mcpProviderCredits(req, res) {
  try {
    const credits = await mcpTracker.getProviderCredits();
    res.json(credits);
  } catch (error) {
    console.error("[MCP] Error en provider-credits:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * PUT /admin/ai/mcp/provider-credits
 * Actualizar créditos de proveedor
 */
export async function mcpUpdateProviderCredits(req, res) {
  try {
    const { provider, initialAmount, creditType, notes } = req.body;
    if (!provider || initialAmount === undefined) {
      return res.status(400).json({ error: 'provider e initialAmount son requeridos' });
    }
    const result = await mcpTracker.upsertProviderCredits({ provider, initialAmount, creditType, notes });
    res.json(result);
  } catch (error) {
    console.error("[MCP] Error en updateProviderCredits:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /admin/ai/mcp/trend
 * Tendencia diaria de consumo
 */
export async function mcpTrend(req, res) {
  try {
    const { days = 30, app_id } = req.query;
    const userId = req.user.id;
    const empresaId = await getEmpresaId(userId);

    const trend = await mcpTracker.getDailyTrend({
      orgId: empresaId,
      appFilter: app_id || null,
      days: parseInt(days)
    });

    res.json(trend);
  } catch (error) {
    console.error("[MCP] Error en trend:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /admin/ai/status
 * Verifica si el servicio de IA está disponible
 */
export async function status(req, res) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    res.json({
      disponible: !!apiKey && apiKey.length > 10,
      modelo: "claude-haiku-4-5-20251001",
      proveedor: "Anthropic"
    });
  } catch (error) {
    console.error("[AI Controller] Error en status:", error);
    res.status(500).json({ error: error.message });
  }
}

// ==========================================
// MCP: Superadmin - Gestión de usuarios cross-app
// ==========================================

/**
 * Verifica que el usuario es el fabricante (superadmin)
 */
async function requireFabricante(req) {
  const [user] = await sql`SELECT email FROM users_180 WHERE id = ${req.user.id} LIMIT 1`;
  if (!user || user.email !== FABRICANTE_EMAIL) {
    const err = new Error('No tienes permisos de superadministrador');
    err.status = 403;
    throw err;
  }
}

/**
 * GET /admin/ai/mcp/users
 * Lista todos los usuarios de ambas apps con consumo IA
 */
export async function mcpUsers(req, res) {
  try {
    await requireFabricante(req);
    const { app, search } = req.query;
    const users = await mcpTracker.getAllUsers({
      appFilter: app || null,
      search: search || null
    });
    res.json(users);
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error("[MCP] Error en users:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /admin/ai/mcp/users/:userId/consumption
 * Consumo detallado de un usuario específico
 */
export async function mcpUserConsumption(req, res) {
  try {
    await requireFabricante(req);
    const { userId } = req.params;
    const { period = 'month' } = req.query;
    const consumption = await mcpTracker.getUserConsumption({ userId, period });
    res.json(consumption);
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error("[MCP] Error en user consumption:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /admin/ai/mcp/users/:userId/quotas
 * Cuotas individuales de un usuario
 */
export async function mcpUserQuotas(req, res) {
  try {
    await requireFabricante(req);
    const { userId } = req.params;
    const quotas = await mcpTracker.getUserQuotas({ userId });
    res.json(quotas);
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error("[MCP] Error en user quotas:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * PUT /admin/ai/mcp/users/:userId/quotas
 * Establecer cuota individual de un usuario
 */
export async function mcpUpdateUserQuota(req, res) {
  try {
    await requireFabricante(req);
    const { userId } = req.params;
    const { targetAppId, quotaType, maxCalls, maxTokens, maxCostUsd, enabled } = req.body;

    if (!targetAppId || !quotaType) {
      return res.status(400).json({ error: 'targetAppId y quotaType son requeridos' });
    }

    const result = await mcpTracker.upsertUserQuota({
      targetAppId, userId, quotaType,
      maxCalls, maxTokens, maxCostUsd, enabled
    });
    res.json(result);
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error("[MCP] Error en updateUserQuota:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * PUT /admin/ai/mcp/users/:userId/toggle-ai
 * Habilitar/deshabilitar IA para un usuario
 */
export async function mcpToggleUserAI(req, res) {
  try {
    await requireFabricante(req);
    const { userId } = req.params;
    const { sourceApp, enabled } = req.body;

    if (!sourceApp || enabled === undefined) {
      return res.status(400).json({ error: 'sourceApp y enabled son requeridos' });
    }

    const result = await mcpTracker.toggleUserAI({ userId, sourceApp, enabled });
    res.json(result);
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error("[MCP] Error en toggleUserAI:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * PUT /admin/ai/mcp/users/:userId/app
 * Actualizar qué app tiene asignada un usuario
 */
export async function mcpUpdateUserApp(req, res) {
  try {
    await requireFabricante(req);
    const { userId } = req.params;
    const { sourceApp, app } = req.body;

    if (!sourceApp || !app) {
      return res.status(400).json({ error: 'sourceApp y app son requeridos' });
    }

    const result = await mcpTracker.updateUserApp({ userId, sourceApp, app });
    res.json(result);
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error("[MCP] Error en updateUserApp:", error);
    res.status(500).json({ error: error.message });
  }
}
