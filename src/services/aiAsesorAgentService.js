// backend/src/services/aiAsesorAgentService.js
// Agente IA del portal asesor — multi-cliente.
// Reutiliza infraestructura común (Anthropic SDK, MCP tracker, formato de tools)
// pero ejecuta sobre asesoria_clientes_180 y delega herramientas por-cliente
// validando vínculo activo asesoria↔empresa antes de cada operación.

import Anthropic from "@anthropic-ai/sdk";
import { sql } from "../db.js";
import { ASESOR_TOOLS } from "./ai/asesorToolDefinitions.js";
import { buildAsesorSystemPrompt } from "./ai/asesorSystemPrompt.js";
import { createMCPTracker } from "./mcp-ai-tracker.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const mcpTracker = createMCPTracker({ sql, appId: 'app180' });

// ============================================================
// Conversión de tool definitions OpenAI-style → Anthropic-style
// ============================================================
function convertToolsToAnthropic(tools) {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters || { type: "object", properties: {} }
  }));
}

// ============================================================
// Validación de vínculo asesoria ↔ empresa
// ============================================================
async function validateAsesorClienteAccess(asesoriaId, empresaId) {
  if (!asesoriaId || !empresaId) {
    return { ok: false, error: "asesoria_id o empresa_id no proporcionados" };
  }
  const rows = await sql`
    SELECT permisos
    FROM asesoria_clientes_180
    WHERE asesoria_id = ${asesoriaId}
      AND empresa_id = ${empresaId}
      AND estado = 'activo'
    LIMIT 1
  `;
  if (rows.length === 0) {
    // ¿Es la propia empresa de la asesoría?
    const [asesoria] = await sql`SELECT empresa_id FROM asesorias_180 WHERE id = ${asesoriaId}`;
    if (asesoria && asesoria.empresa_id === empresaId) {
      return { ok: true, permisos: null, esEmpresaPropia: true };
    }
    return { ok: false, error: "vinculo_no_activo", message: "Cliente no vinculado a esta asesoría" };
  }
  return { ok: true, permisos: rows[0].permisos || {}, esEmpresaPropia: false };
}

// ============================================================
// HERRAMIENTAS — descubrimiento
// ============================================================

async function listarMisClientes({ incluir_inactivos = "false", limite = 50 }, asesoriaId) {
  const incluirInactivos = String(incluir_inactivos).toLowerCase() === "true";
  const lim = Math.max(1, Math.min(parseInt(limite) || 50, 200));

  const rows = await sql`
    SELECT
      ac.empresa_id,
      ac.estado,
      ac.created_at,
      e.nombre,
      em.nif,
      em.tipo_contribuyente
    FROM asesoria_clientes_180 ac
    LEFT JOIN empresa_180 e ON ac.empresa_id = e.id
    LEFT JOIN emisor_180 em ON em.empresa_id = e.id
    WHERE ac.asesoria_id = ${asesoriaId}
      ${incluirInactivos ? sql`` : sql`AND ac.estado = 'activo'`}
    ORDER BY e.nombre ASC
    LIMIT ${lim}
  `;

  return {
    total: rows.length,
    clientes: rows.map(r => ({
      empresa_id: r.empresa_id,
      nombre: r.nombre || "(sin nombre)",
      nif: r.nif,
      tipo_contribuyente: r.tipo_contribuyente,
      estado: r.estado,
      vinculado_desde: r.created_at
    }))
  };
}

async function buscarCliente({ consulta }, asesoriaId) {
  if (!consulta || consulta.trim().length < 2) {
    return { error: "Consulta demasiado corta. Mínimo 2 caracteres." };
  }
  const q = `%${consulta.trim().toLowerCase()}%`;
  const rows = await sql`
    SELECT ac.empresa_id, e.nombre, em.nif, em.tipo_contribuyente, ac.estado
    FROM asesoria_clientes_180 ac
    LEFT JOIN empresa_180 e ON ac.empresa_id = e.id
    LEFT JOIN emisor_180 em ON em.empresa_id = e.id
    WHERE ac.asesoria_id = ${asesoriaId}
      AND ac.estado = 'activo'
      AND (LOWER(e.nombre) LIKE ${q} OR LOWER(COALESCE(em.nif, '')) LIKE ${q})
    ORDER BY e.nombre ASC
    LIMIT 20
  `;
  return {
    total: rows.length,
    coincidencias: rows.map(r => ({
      empresa_id: r.empresa_id,
      nombre: r.nombre,
      nif: r.nif,
      tipo_contribuyente: r.tipo_contribuyente
    }))
  };
}

async function infoCliente({ empresa_id }, asesoriaId) {
  const access = await validateAsesorClienteAccess(asesoriaId, empresa_id);
  if (!access.ok) return { error: access.error, message: access.message };

  const [empresa] = await sql`
    SELECT e.id, e.nombre, em.nif, em.tipo_contribuyente, em.regimen_iva, em.prorrata_iva_pct
    FROM empresa_180 e
    LEFT JOIN emisor_180 em ON em.empresa_id = e.id
    WHERE e.id = ${empresa_id} LIMIT 1
  `;
  if (!empresa) return { error: "empresa_no_encontrada" };

  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const trimestre = Math.ceil(month / 3);

  // KPIs trimestre actual
  const [agg] = await sql`
    SELECT
      COALESCE(SUM(CASE WHEN f.estado = 'VALIDADA' THEN f.total ELSE 0 END), 0) AS facturado_q,
      COALESCE(SUM(CASE WHEN f.estado = 'VALIDADA' AND COALESCE(f.estado_pago, 'pendiente') != 'pagado' THEN f.total - COALESCE(f.pagado, 0) ELSE 0 END), 0) AS pendiente_cobro
    FROM factura_180 f
    WHERE f.empresa_id = ${empresa_id}
      AND EXTRACT(YEAR FROM f.fecha) = ${year}
      AND EXTRACT(QUARTER FROM f.fecha) = ${trimestre}
  `;

  // Modelos del trimestre
  const modelos = await sql`
    SELECT modelo, periodo, estado, created_at, presentado_at
    FROM fiscal_models_180
    WHERE empresa_id = ${empresa_id}
      AND ejercicio = ${year}
      AND (periodo = ${trimestre + 'T'} OR periodo = 'OA')
    ORDER BY modelo
  `;

  return {
    cliente: {
      empresa_id: empresa.id,
      nombre: empresa.nombre,
      nif: empresa.nif,
      tipo_contribuyente: empresa.tipo_contribuyente,
      regimen_iva: empresa.regimen_iva,
      prorrata_iva_pct: empresa.prorrata_iva_pct
    },
    kpis_trimestre: {
      year,
      trimestre,
      facturado: Number(agg?.facturado_q || 0),
      pendiente_cobro: Number(agg?.pendiente_cobro || 0)
    },
    modelos_periodo: modelos.map(m => ({
      modelo: m.modelo,
      periodo: m.periodo,
      estado: m.estado,
      fecha_calculo: m.created_at,
      fecha_presentacion: m.presentado_at
    }))
  };
}

// ============================================================
// HERRAMIENTAS — análisis transversal
// ============================================================

async function compararClientesFiscal({ empresa_ids = [], trimestre, year }, asesoriaId) {
  if (!Array.isArray(empresa_ids) || empresa_ids.length < 2 || empresa_ids.length > 5) {
    return { error: "Debes proporcionar entre 2 y 5 empresa_ids" };
  }
  const yr = year || new Date().getFullYear();

  // Validar todos los vínculos en paralelo
  const validations = await Promise.all(
    empresa_ids.map(id => validateAsesorClienteAccess(asesoriaId, id))
  );
  const invalidIdx = validations.findIndex(v => !v.ok);
  if (invalidIdx !== -1) {
    return { error: `Cliente sin vínculo activo: ${empresa_ids[invalidIdx]}` };
  }

  const resultados = [];
  for (const empresa_id of empresa_ids) {
    const [empresa] = await sql`
      SELECT e.id, e.nombre, em.nif, em.tipo_contribuyente
      FROM empresa_180 e
      LEFT JOIN emisor_180 em ON em.empresa_id = e.id
      WHERE e.id = ${empresa_id}
    `;
    if (!empresa) continue;

    const [agg] = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN f.estado = 'VALIDADA' THEN f.total ELSE 0 END), 0) AS total,
        COALESCE(SUM(CASE WHEN f.estado = 'VALIDADA' THEN f.iva_total ELSE 0 END), 0) AS iva_repercutido
      FROM factura_180 f
      WHERE f.empresa_id = ${empresa_id}
        AND EXTRACT(YEAR FROM f.fecha) = ${yr}
        AND EXTRACT(QUARTER FROM f.fecha) = ${trimestre}
    `;

    const modelos = await sql`
      SELECT modelo, estado FROM fiscal_models_180
      WHERE empresa_id = ${empresa_id} AND ejercicio = ${yr} AND periodo = ${trimestre + 'T'}
    `;

    resultados.push({
      empresa_id,
      nombre: empresa.nombre,
      nif: empresa.nif,
      tipo_contribuyente: empresa.tipo_contribuyente,
      facturacion: Number(agg?.total || 0),
      iva_repercutido: Number(agg?.iva_repercutido || 0),
      modelos: modelos.map(m => ({ modelo: m.modelo, estado: m.estado }))
    });
  }

  return { trimestre, year: yr, total: resultados.length, comparativa: resultados };
}

async function topClientesRiesgo({ limite = 10, tipo_riesgo = "todos" }, asesoriaId) {
  const lim = Math.max(1, Math.min(parseInt(limite) || 10, 50));
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const trimestre = Math.ceil(month / 3);

  // Subqueries: facturación pendiente cobro, modelos pendientes
  const rows = await sql`
    WITH clientes AS (
      SELECT ac.empresa_id, e.nombre, em.nif
      FROM asesoria_clientes_180 ac
      LEFT JOIN empresa_180 e ON ac.empresa_id = e.id
      LEFT JOIN emisor_180 em ON em.empresa_id = e.id
      WHERE ac.asesoria_id = ${asesoriaId} AND ac.estado = 'activo'
    ),
    deuda AS (
      SELECT empresa_id,
        SUM(GREATEST(total - COALESCE(pagado, 0), 0)) AS pendiente
      FROM factura_180
      WHERE estado = 'VALIDADA'
        AND COALESCE(estado_pago, 'pendiente') != 'pagado'
      GROUP BY empresa_id
    ),
    modelos_pendientes AS (
      SELECT empresa_id, COUNT(*)::int AS n_pendientes
      FROM fiscal_models_180
      WHERE ejercicio = ${year}
        AND periodo = ${trimestre + 'T'}
        AND estado IN ('BORRADOR', 'ERROR')
      GROUP BY empresa_id
    )
    SELECT
      c.empresa_id, c.nombre, c.nif,
      COALESCE(d.pendiente, 0) AS pendiente_cobro,
      COALESCE(mp.n_pendientes, 0) AS modelos_pendientes
    FROM clientes c
    LEFT JOIN deuda d ON c.empresa_id = d.empresa_id
    LEFT JOIN modelos_pendientes mp ON c.empresa_id = mp.empresa_id
  `;

  // Score sintético
  const scored = rows.map(r => {
    const debt = Number(r.pendiente_cobro || 0);
    const fis = Number(r.modelos_pendientes || 0);
    const debtScore = Math.min(debt / 1000, 50);   // 1€ deuda = 0.001 punto, máx 50
    const fisScore = fis * 25;                       // cada modelo pendiente = 25 puntos
    const score = (tipo_riesgo === 'fiscal') ? fisScore
                : (tipo_riesgo === 'cobros') ? debtScore
                : debtScore + fisScore;
    return { ...r, score, pendiente_cobro: debt, modelos_pendientes: fis };
  }).filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, lim);

  return {
    tipo_riesgo,
    total: scored.length,
    clientes: scored.map(r => ({
      empresa_id: r.empresa_id,
      nombre: r.nombre,
      nif: r.nif,
      pendiente_cobro: r.pendiente_cobro,
      modelos_pendientes: r.modelos_pendientes,
      score_riesgo: Math.round(r.score * 10) / 10
    }))
  };
}

async function consultarClientesEstadoModelos({ modelo = "todos", trimestre, year, solo_pendientes = "false" }, asesoriaId) {
  const yr = year || new Date().getFullYear();
  const periodo = trimestre + 'T';
  const soloPend = String(solo_pendientes).toLowerCase() === "true";

  const rows = await sql`
    SELECT ac.empresa_id, e.nombre, em.nif
    FROM asesoria_clientes_180 ac
    LEFT JOIN empresa_180 e ON ac.empresa_id = e.id
    LEFT JOIN emisor_180 em ON em.empresa_id = e.id
    WHERE ac.asesoria_id = ${asesoriaId} AND ac.estado = 'activo'
    ORDER BY e.nombre ASC
  `;

  const results = [];
  for (const r of rows) {
    let modelosQuery = sql`
      SELECT modelo, estado, presentado_at
      FROM fiscal_models_180
      WHERE empresa_id = ${r.empresa_id} AND ejercicio = ${yr} AND periodo = ${periodo}
    `;
    if (modelo !== "todos") {
      modelosQuery = sql`${modelosQuery} AND modelo = ${modelo}`;
    }
    const modelos = await modelosQuery;

    const presentados = modelos.filter(m => m.estado === 'PRESENTADO');
    const pendientes = modelos.filter(m => m.estado !== 'PRESENTADO');

    if (soloPend && pendientes.length === 0 && modelo === "todos") continue;
    if (soloPend && modelo !== "todos" && presentados.length > 0) continue;

    results.push({
      empresa_id: r.empresa_id,
      nombre: r.nombre,
      nif: r.nif,
      modelos: modelos.map(m => ({ modelo: m.modelo, estado: m.estado, fecha_presentacion: m.presentado_at }))
    });
  }

  return { modelo, trimestre, year: yr, total: results.length, clientes: results };
}

async function rankingFacturacionClientes({ year, trimestre, limite = 10 }, asesoriaId) {
  const yr = year || new Date().getFullYear();
  const lim = Math.max(1, Math.min(parseInt(limite) || 10, 50));

  let timeFilter = sql`AND EXTRACT(YEAR FROM f.fecha) = ${yr}`;
  if (trimestre) {
    timeFilter = sql`${timeFilter} AND EXTRACT(QUARTER FROM f.fecha) = ${trimestre}`;
  }

  const rows = await sql`
    SELECT
      ac.empresa_id, e.nombre, em.nif,
      COALESCE(SUM(CASE WHEN f.estado = 'VALIDADA' THEN f.total ELSE 0 END), 0) AS total
    FROM asesoria_clientes_180 ac
    LEFT JOIN empresa_180 e ON ac.empresa_id = e.id
    LEFT JOIN emisor_180 em ON em.empresa_id = e.id
    LEFT JOIN factura_180 f ON f.empresa_id = ac.empresa_id ${timeFilter}
    WHERE ac.asesoria_id = ${asesoriaId} AND ac.estado = 'activo'
    GROUP BY ac.empresa_id, e.nombre, em.nif
    ORDER BY total DESC
    LIMIT ${lim}
  `;

  return {
    year: yr,
    trimestre: trimestre || null,
    total: rows.length,
    ranking: rows.map((r, i) => ({
      posicion: i + 1,
      empresa_id: r.empresa_id,
      nombre: r.nombre,
      nif: r.nif,
      facturacion: Number(r.total)
    }))
  };
}

// ============================================================
// HERRAMIENTAS — wrappers de lectura por cliente
// ============================================================

async function consultarFacturasCliente(args, asesoriaId) {
  const { empresa_id, ...rest } = args;
  const access = await validateAsesorClienteAccess(asesoriaId, empresa_id);
  if (!access.ok) return { error: access.error, message: access.message };

  let query = sql`
    SELECT f.id, f.numero, f.fecha, f.total, f.estado, f.pagado, f.estado_pago, c.nombre as cliente_nombre
    FROM factura_180 f LEFT JOIN clients_180 c ON f.cliente_id = c.id
    WHERE f.empresa_id = ${empresa_id}
  `;
  const estado = rest.estado || "TODOS";
  const estadoPago = rest.estado_pago || "todos";
  const lim = Math.max(1, Math.min(parseInt(rest.limite) || 10, 100));
  if (estado !== "TODOS") query = sql`${query} AND f.estado = ${estado}`;
  if (estadoPago !== "todos") query = sql`${query} AND COALESCE(f.estado_pago, 'pendiente') = ${estadoPago}`;
  query = sql`${query} ORDER BY f.fecha DESC LIMIT ${lim}`;
  const facturas = await query;
  return {
    total: facturas.length,
    facturas: facturas.map(f => ({
      id: f.id,
      numero: f.numero || "Borrador",
      fecha: f.fecha,
      cliente: f.cliente_nombre,
      total: Number(f.total),
      pagado: Number(f.pagado || 0),
      saldo: Number(f.total) - Number(f.pagado || 0),
      estado: f.estado,
      estado_pago: f.estado_pago || "pendiente"
    }))
  };
}

async function consultarModelosFiscalesCliente(args, asesoriaId) {
  const { empresa_id, year, modelo = "todos" } = args;
  const access = await validateAsesorClienteAccess(asesoriaId, empresa_id);
  if (!access.ok) return { error: access.error, message: access.message };

  const yr = year || new Date().getFullYear();
  let q = sql`
    SELECT id, modelo, periodo, ejercicio, estado, resultado_tipo, resultado_importe, created_at, presentado_at
    FROM fiscal_models_180
    WHERE empresa_id = ${empresa_id} AND ejercicio = ${yr}
  `;
  if (modelo !== "todos") q = sql`${q} AND modelo = ${modelo}`;
  q = sql`${q} ORDER BY periodo, modelo`;
  const rows = await q;

  return {
    empresa_id,
    year: yr,
    total: rows.length,
    modelos: rows.map(m => ({
      id: m.id,
      modelo: m.modelo,
      periodo: m.periodo,
      estado: m.estado,
      resultado_tipo: m.resultado_tipo,
      resultado_importe: m.resultado_importe ? Number(m.resultado_importe) : null,
      fecha_calculo: m.created_at,
      fecha_presentacion: m.presentado_at
    }))
  };
}

async function consultarResumenFinancieroCliente(args, asesoriaId) {
  const { empresa_id, year, trimestre } = args;
  const access = await validateAsesorClienteAccess(asesoriaId, empresa_id);
  if (!access.ok) return { error: access.error, message: access.message };

  const yr = year || new Date().getFullYear();

  const ventasFilter = trimestre
    ? sql`AND EXTRACT(YEAR FROM fecha) = ${yr} AND EXTRACT(QUARTER FROM fecha) = ${trimestre}`
    : sql`AND EXTRACT(YEAR FROM fecha) = ${yr}`;

  const gastosFilter = trimestre
    ? sql`AND EXTRACT(YEAR FROM fecha_compra) = ${yr} AND EXTRACT(QUARTER FROM fecha_compra) = ${trimestre}`
    : sql`AND EXTRACT(YEAR FROM fecha_compra) = ${yr}`;

  const [ingresos] = await sql`
    SELECT
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN total ELSE 0 END), 0) AS facturado,
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN iva_total ELSE 0 END), 0) AS iva_repercutido
    FROM factura_180 WHERE empresa_id = ${empresa_id} ${ventasFilter}
  `;

  const [gastos] = await sql`
    SELECT
      COALESCE(SUM(total), 0) AS gastos_total,
      COALESCE(SUM(iva_importe), 0) AS iva_soportado
    FROM purchases_180 WHERE empresa_id = ${empresa_id} ${gastosFilter}
  `;

  const facturado = Number(ingresos?.facturado || 0);
  const ivaRep = Number(ingresos?.iva_repercutido || 0);
  const gastosT = Number(gastos?.gastos_total || 0);
  const ivaSop = Number(gastos?.iva_soportado || 0);

  return {
    empresa_id, year: yr, trimestre: trimestre || null,
    ingresos: { facturado, iva_repercutido: ivaRep },
    gastos: { total: gastosT, iva_soportado: ivaSop },
    beneficio_estimado: facturado - gastosT,
    iva_neto: ivaRep - ivaSop
  };
}

// ============================================================
// Dispatcher de herramientas
// ============================================================

async function ejecutarHerramientaAsesor(nombre, args, asesoriaId, userId) {
  if (nombre === 'solicitar_aclaracion') {
    return {
      __tipo: "clarification",
      pregunta: args.pregunta,
      opciones: args.opciones || [],
      contexto: args.contexto || ""
    };
  }

  console.log(`[AI Asesor] Ejecutando: ${nombre}`, args);
  try {
    switch (nombre) {
      case "listar_mis_clientes":           return await listarMisClientes(args, asesoriaId);
      case "buscar_cliente":                return await buscarCliente(args, asesoriaId);
      case "info_cliente":                  return await infoCliente(args, asesoriaId);
      case "comparar_clientes_fiscal":      return await compararClientesFiscal(args, asesoriaId);
      case "top_clientes_riesgo":           return await topClientesRiesgo(args, asesoriaId);
      case "consultar_clientes_estado_modelos": return await consultarClientesEstadoModelos(args, asesoriaId);
      case "ranking_facturacion_clientes":  return await rankingFacturacionClientes(args, asesoriaId);
      case "consultar_facturas_cliente":    return await consultarFacturasCliente(args, asesoriaId);
      case "consultar_modelos_fiscales_cliente": return await consultarModelosFiscalesCliente(args, asesoriaId);
      case "consultar_resumen_financiero_cliente": return await consultarResumenFinancieroCliente(args, asesoriaId);
      default:
        return { error: `Herramienta desconocida: ${nombre}` };
    }
  } catch (err) {
    console.error(`[AI Asesor] Error en ${nombre}:`, err);
    return { error: err.message || "Error interno ejecutando herramienta" };
  }
}

// ============================================================
// Persistencia de conversación (tabla compartida con agente empresa)
// ============================================================
async function guardarConversacionAsesor(asesoriaId, userId, mensaje, respuesta) {
  try {
    // Usamos la tabla compartida con el agente empresa.
    // Para asesores, asociamos la conversación a la empresa propia de la asesoría
    // (asesorias_180.empresa_id) para no romper la integridad multi-tenant.
    const [asesoria] = await sql`SELECT empresa_id FROM asesorias_180 WHERE id = ${asesoriaId} LIMIT 1`;
    const empresaIdAsesoria = asesoria?.empresa_id || null;
    if (!empresaIdAsesoria) return; // sin empresa propia no persistimos
    await sql`
      INSERT INTO contendo_memory_180 (empresa_id, user_id, role, mensaje, respuesta, metadata)
      VALUES (${empresaIdAsesoria}, ${userId}, 'asesor', ${mensaje}, ${respuesta},
              ${JSON.stringify({ timestamp: new Date().toISOString(), asesoria_id: asesoriaId, agent: 'asesor' })})
    `;
  } catch (err) {
    console.warn("[AI Asesor] No se pudo guardar conversación:", err.message);
  }
}

async function cargarMemoriaAsesor(userId, limite = 3) {
  try {
    const rows = await sql`
      SELECT mensaje, respuesta
      FROM contendo_memory_180
      WHERE user_id = ${userId} AND role = 'asesor'
      ORDER BY created_at DESC
      LIMIT ${limite}
    `;
    const out = [];
    for (const r of rows.reverse()) {
      out.push({ role: "user", content: r.mensaje });
      out.push({ role: "assistant", content: r.respuesta });
    }
    return out;
  } catch {
    return [];
  }
}

// ============================================================
// Entry point principal
// ============================================================

export async function chatConAgenteAsesor({ asesoriaId, userId, mensaje, historial = [] }) {
  try {
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.length < 10) {
      return { mensaje: "El servicio de IA no está configurado. Contacta al administrador." };
    }
    if (!asesoriaId) {
      return { mensaje: "No se ha identificado tu asesoría. Vuelve a iniciar sesión." };
    }

    // Quota MCP — usamos el orgId = asesoriaId para contabilizar consumos del asesor
    const quotaCheck = await mcpTracker.checkQuota({ orgId: asesoriaId, userId });
    if (!quotaCheck.allowed) {
      const limite = quotaCheck.limit || 0;
      const tipo = quotaCheck.reason === 'daily_limit' ? 'diario' : 'mensual';
      return {
        mensaje: `Has alcanzado tu límite de ${limite} consultas ${tipo === 'diario' ? 'diarias' : 'mensuales'}.`,
        limite_alcanzado: true,
        tipo_limite: tipo
      };
    }

    // Contexto: nombre asesor, asesoría, total clientes
    const [userInfo] = await sql`SELECT nombre FROM users_180 WHERE id = ${userId} LIMIT 1`;
    const [asesoria] = await sql`SELECT nombre FROM asesorias_180 WHERE id = ${asesoriaId} LIMIT 1`;
    const [totales] = await sql`SELECT COUNT(*)::int AS n FROM asesoria_clientes_180 WHERE asesoria_id = ${asesoriaId} AND estado = 'activo'`;

    const systemPrompt = buildAsesorSystemPrompt({
      userName: userInfo?.nombre,
      asesoriaName: asesoria?.nombre,
      totalClientes: totales?.n || 0
    });

    const memoriaReciente = await cargarMemoriaAsesor(userId, 3);
    const anthropicMessages = [];
    for (const m of [...memoriaReciente, ...historial]) {
      if (m.role === "user" || m.role === "assistant") {
        anthropicMessages.push({ role: m.role, content: m.content });
      }
    }
    anthropicMessages.push({ role: "user", content: mensaje });

    const anthropicTools = convertToolsToAnthropic(ASESOR_TOOLS);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    let response;
    try {
      response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: systemPrompt,
        messages: anthropicMessages,
        tools: anthropicTools,
        tool_choice: { type: "auto" },
        temperature: 0.4
      });
      totalInputTokens += response.usage?.input_tokens || 0;
      totalOutputTokens += response.usage?.output_tokens || 0;
    } catch (apiErr) {
      console.error("[AI Asesor] Error API Anthropic:", apiErr.message);
      return { mensaje: "No pude procesar tu mensaje. Inténtalo de nuevo en unos minutos." };
    }

    let iterations = 0;
    while (response.stop_reason === "tool_use" && iterations < 8) {
      iterations++;
      const toolUseBlocks = response.content.filter(b => b.type === "tool_use");
      anthropicMessages.push({ role: "assistant", content: response.content });

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const resultado = await ejecutarHerramientaAsesor(toolUse.name, toolUse.input || {}, asesoriaId, userId);
        if (resultado?.__tipo === "clarification") {
          return {
            mensaje: resultado.pregunta,
            clarificacion: { pregunta: resultado.pregunta, opciones: resultado.opciones },
            accion_realizada: false
          };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(resultado)
        });
      }
      anthropicMessages.push({ role: "user", content: toolResults });

      try {
        response = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          system: systemPrompt,
          messages: anthropicMessages,
          tools: anthropicTools,
          tool_choice: { type: "auto" },
          temperature: 0.2
        });
        totalInputTokens += response.usage?.input_tokens || 0;
        totalOutputTokens += response.usage?.output_tokens || 0;
      } catch (apiErr) {
        console.error("[AI Asesor] Error API Anthropic (loop):", apiErr.message);
        return { mensaje: "Error al procesar los datos. Inténtalo de nuevo." };
      }
    }

    const textBlocks = response.content.filter(b => b.type === "text");
    const respuestaFinal = textBlocks.map(b => b.text).join("\n") || "No pude generar una respuesta.";
    await guardarConversacionAsesor(asesoriaId, userId, mensaje, respuestaFinal);

    mcpTracker.recordUsage({
      orgId: asesoriaId,
      userId,
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      keySource: 'env',
      operation: 'asesor_agent_chat',
      toolCalls: iterations
    }).catch(err => console.warn('[AI Asesor] Error registrando consumo:', err.message));

    return { mensaje: respuestaFinal, accion_realizada: false };

  } catch (error) {
    console.error("[AI Asesor] Error general:", error);
    return { mensaje: "Ha ocurrido un error inesperado. Inténtalo de nuevo más tarde." };
  }
}
