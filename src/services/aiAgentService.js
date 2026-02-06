import Groq from "groq-sdk";
import { sql } from "../db.js";
import { getCalendarConfig } from "./googleCalendarService.js";
import { syncToGoogle, syncFromGoogle, syncBidirectional } from "./calendarSyncService.js";
import { createGoogleEvent, app180ToGoogleEvent } from "./googleCalendarService.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || ""
});

/**
 * Herramientas disponibles para el agente IA
 */
const TOOLS = [
  {
    type: "function",
    function: {
      name: "consultar_facturas",
      description: "Obtiene facturas de la empresa. SIEMPRE usa esta herramienta antes de responder sobre facturas.",
      parameters: {
        type: "object",
        properties: {
          estado: { type: "string", enum: ["VALIDADA", "BORRADOR", "ANULADA", "TODOS"], description: "Estado de emisión" },
          estado_pago: { type: "string", enum: ["pendiente", "parcial", "pagado", "todos"], description: "Estado de cobro" },
          cliente_id: { type: "string", description: "ID del cliente (UUID)" },
          limite: { type: "number", description: "Máximo de facturas (default: 10)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_empleados",
      description: "Obtiene empleados de la empresa. SIEMPRE usa esta herramienta antes de responder sobre empleados.",
      parameters: {
        type: "object",
        properties: {
          activos_solo: { type: "string", enum: ["true", "false"], description: "Si 'true', solo activos" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_clientes",
      description: "Obtiene clientes de la empresa. SIEMPRE usa esta herramienta antes de responder sobre clientes.",
      parameters: {
        type: "object",
        properties: {
          activos_solo: { type: "string", enum: ["true", "false"], description: "Si 'true', solo activos" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "estadisticas_facturacion",
      description: "Estadísticas de facturación: total facturado, pendiente, por estado.",
      parameters: {
        type: "object",
        properties: {
          mes: { type: "number", description: "Mes (1-12)" },
          anio: { type: "number", description: "Año" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "trabajos_pendientes_facturar",
      description: "Lista trabajos completados sin facturar.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_calendario",
      description: "Consulta eventos del calendario en un rango de fechas.",
      parameters: {
        type: "object",
        properties: {
          fecha_inicio: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_fin: { type: "string", description: "Fecha fin YYYY-MM-DD" },
          tipo: { type: "string", enum: ["todos", "festivos", "cierres", "laborables"], description: "Tipo de evento" }
        },
        required: ["fecha_inicio", "fecha_fin"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "crear_evento_calendario",
      description: "Crea evento en el calendario (sincroniza con Google Calendar si configurado).",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha YYYY-MM-DD" },
          nombre: { type: "string", description: "Nombre del evento" },
          tipo: { type: "string", enum: ["festivo_local", "festivo_empresa", "cierre_empresa"], description: "Tipo" },
          es_laborable: { type: "string", enum: ["true", "false"], description: "Si laborable (default: false)" },
          descripcion: { type: "string", description: "Descripción" }
        },
        required: ["fecha", "nombre", "tipo"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "sincronizar_google_calendar",
      description: "Fuerza sincronización con Google Calendar.",
      parameters: {
        type: "object",
        properties: {
          direccion: { type: "string", enum: ["to_google", "from_google", "bidirectional"], description: "Dirección" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_ausencias",
      description: "Consulta ausencias de empleados en un rango de fechas.",
      parameters: {
        type: "object",
        properties: {
          fecha_inicio: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_fin: { type: "string", description: "Fecha fin YYYY-MM-DD" },
          empleado_id: { type: "string", description: "ID del empleado" },
          tipo: { type: "string", enum: ["todos", "vacaciones", "baja_medica"], description: "Tipo" }
        },
        required: ["fecha_inicio", "fecha_fin"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_conocimiento",
      description: "Busca en la base de conocimientos manuales, procedimientos o información específica de la empresa. Úsala si no encuentras respuesta con las otras herramientas o para preguntas generales.",
      parameters: {
        type: "object",
        properties: {
          busqueda: { type: "string", description: "Término de búsqueda, palabra clave o pregunta breve" }
        },
        required: ["busqueda"]
      }
    }
  },
];

// ============================
// EJECUTAR HERRAMIENTAS
// ============================

// Coerce string booleans to real booleans (LLMs often generate "true"/"false" as strings)
function coerceBooleans(args) {
  const result = { ...args };
  for (const key of Object.keys(result)) {
    if (result[key] === "true") result[key] = true;
    else if (result[key] === "false") result[key] = false;
  }
  return result;
}

async function ejecutarHerramienta(nombreHerramienta, argumentos, empresaId) {
  const args = coerceBooleans(argumentos);
  console.log(`[AI] Ejecutando: ${nombreHerramienta}`, args);
  try {
    switch (nombreHerramienta) {
      case "consultar_facturas": return await consultarFacturas(args, empresaId);
      case "consultar_empleados": return await consultarEmpleados(args, empresaId);
      case "consultar_clientes": return await consultarClientes(args, empresaId);
      case "estadisticas_facturacion": return await estadisticasFacturacion(args, empresaId);
      case "trabajos_pendientes_facturar": return await trabajosPendientesFacturar(args, empresaId);
      case "consultar_calendario": return await consultarCalendario(args, empresaId);
      case "crear_evento_calendario": return await crearEventoCalendario(args, empresaId);
      case "sincronizar_google_calendar": return await sincronizarGoogleCalendar(args, empresaId);
      case "consultar_ausencias": return await consultarAusencias(args, empresaId);
      case "consultar_conocimiento": return await consultarConocimiento(args, empresaId);
      default: return { error: "Herramienta no encontrada" };
    }
  } catch (err) {
    console.error(`[AI] Error en herramienta ${nombreHerramienta}:`, err);
    return { error: err.message || "Error ejecutando herramienta" };
  }
}

// ============================
// HERRAMIENTAS
// ============================

async function consultarFacturas({ estado = "TODOS", estado_pago = "todos", cliente_id, limite = 10 }, empresaId) {
  let query = sql`
    SELECT f.id, f.numero, f.fecha, f.total, f.estado, f.pagado, f.estado_pago, c.nombre as cliente_nombre
    FROM factura_180 f LEFT JOIN clients_180 c ON f.cliente_id = c.id
    WHERE f.empresa_id = ${empresaId}
  `;
  if (estado !== "TODOS") query = sql`${query} AND f.estado = ${estado}`;
  if (estado_pago !== "todos") query = sql`${query} AND COALESCE(f.estado_pago, 'pendiente') = ${estado_pago}`;
  if (cliente_id) query = sql`${query} AND f.cliente_id = ${cliente_id}`;
  query = sql`${query} ORDER BY f.fecha DESC LIMIT ${limite}`;
  const facturas = await query;
  return {
    total: facturas.length,
    facturas: facturas.map(f => ({
      numero: f.numero || "Borrador", fecha: f.fecha, cliente: f.cliente_nombre,
      total: Number(f.total), pagado: Number(f.pagado || 0),
      saldo: Number(f.total) - Number(f.pagado || 0),
      estado: f.estado, estado_pago: f.estado_pago || "pendiente"
    }))
  };
}

async function consultarEmpleados({ activos_solo = true }, empresaId) {
  let query = sql`SELECT id, nombre, email, active FROM employees_180 WHERE empresa_id = ${empresaId}`;
  if (activos_solo) query = sql`${query} AND active = true`;
  query = sql`${query} ORDER BY nombre ASC`;
  const empleados = await query;
  return { total: empleados.length, empleados: empleados.map(e => ({ nombre: e.nombre, email: e.email, activo: e.active })) };
}

async function consultarClientes({ activos_solo = true }, empresaId) {
  let query = sql`SELECT id, nombre, email, telefono, active FROM clients_180 WHERE empresa_id = ${empresaId}`;
  if (activos_solo) query = sql`${query} AND active = true`;
  query = sql`${query} ORDER BY nombre ASC`;
  const clientes = await query;
  return { total: clientes.length, clientes: clientes.map(c => ({ nombre: c.nombre, email: c.email, telefono: c.telefono, activo: c.active })) };
}

async function estadisticasFacturacion({ mes, anio }, empresaId) {
  const now = new Date();
  const m = mes || (now.getMonth() + 1);
  const a = anio || now.getFullYear();
  const stats = await sql`
    SELECT COUNT(*) as total_facturas, COALESCE(SUM(total), 0) as total_facturado,
           COALESCE(SUM(pagado), 0) as total_cobrado, COALESCE(SUM(total - COALESCE(pagado, 0)), 0) as total_pendiente
    FROM factura_180 WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
      AND EXTRACT(MONTH FROM fecha) = ${m} AND EXTRACT(YEAR FROM fecha) = ${a}
  `;
  const porEstado = await sql`
    SELECT COALESCE(estado_pago, 'pendiente') as estado, COUNT(*) as cantidad, COALESCE(SUM(total), 0) as importe
    FROM factura_180 WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
      AND EXTRACT(MONTH FROM fecha) = ${m} AND EXTRACT(YEAR FROM fecha) = ${a}
    GROUP BY estado_pago
  `;
  return {
    periodo: `${m}/${a}`, total_facturas: Number(stats[0].total_facturas),
    total_facturado: Number(stats[0].total_facturado), total_cobrado: Number(stats[0].total_cobrado),
    total_pendiente: Number(stats[0].total_pendiente),
    por_estado: porEstado.map(e => ({ estado: e.estado, cantidad: Number(e.cantidad), importe: Number(e.importe) }))
  };
}

async function trabajosPendientesFacturar({ cliente_id }, empresaId) {
  let query = sql`
    SELECT w.id, w.descripcion, w.fecha, w.valor, c.nombre as cliente_nombre
    FROM work_logs_180 w LEFT JOIN clients_180 c ON w.cliente_id = c.id
    WHERE w.empresa_id = ${empresaId} AND w.factura_id IS NULL
  `;
  if (cliente_id) query = sql`${query} AND w.cliente_id = ${cliente_id}`;
  query = sql`${query} ORDER BY w.fecha DESC LIMIT 20`;
  const trabajos = await query;
  return {
    total: trabajos.length,
    total_valor: trabajos.reduce((sum, t) => sum + Number(t.valor || 0), 0),
    trabajos: trabajos.map(t => ({ descripcion: t.descripcion, fecha: t.fecha, cliente: t.cliente_nombre, valor: Number(t.valor || 0) }))
  };
}

async function consultarCalendario({ fecha_inicio, fecha_fin, tipo = "todos" }, empresaId) {
  let query = sql`
    SELECT id, fecha, tipo, nombre, descripcion, es_laborable, origen
    FROM calendario_empresa_180
    WHERE empresa_id = ${empresaId} AND fecha >= ${fecha_inicio} AND fecha <= ${fecha_fin} AND activo = true
  `;
  if (tipo === "festivos") query = sql`${query} AND tipo IN ('festivo_local', 'festivo_nacional', 'festivo_empresa', 'convenio')`;
  else if (tipo === "cierres") query = sql`${query} AND tipo IN ('cierre_empresa', 'no_laborable')`;
  else if (tipo === "laborables") query = sql`${query} AND es_laborable = true`;
  query = sql`${query} ORDER BY fecha ASC`;
  const eventos = await query;
  return { total: eventos.length, rango: { desde: fecha_inicio, hasta: fecha_fin }, eventos: eventos.map(e => ({ fecha: e.fecha, tipo: e.tipo, nombre: e.nombre, descripcion: e.descripcion, es_laborable: e.es_laborable })) };
}

async function crearEventoCalendario({ fecha, nombre, tipo, es_laborable = false, descripcion = "" }, empresaId) {
  const result = await sql`
    INSERT INTO calendario_empresa_180 (empresa_id, fecha, tipo, nombre, descripcion, es_laborable, origen, activo, confirmado)
    VALUES (${empresaId}, ${fecha}, ${tipo}, ${nombre}, ${descripcion}, ${es_laborable}, 'ai_agent', true, true)
    RETURNING id
  `;
  const calendarConfig = await getCalendarConfig(empresaId);
  let sincronizado = false;
  if (calendarConfig && calendarConfig.sync_enabled) {
    try {
      const googleEventData = app180ToGoogleEvent({ id: result[0].id, fecha, tipo, nombre, descripcion, es_laborable });
      await createGoogleEvent(empresaId, googleEventData);
      await sql`
        INSERT INTO calendar_event_mapping_180 (empresa_id, app180_source, app180_event_id, google_calendar_id, google_event_id, sync_direction)
        VALUES (${empresaId}, 'calendario_empresa', ${result[0].id}, ${calendarConfig.calendar_id || 'primary'}, ${result[0].id}, 'to_google')
        ON CONFLICT (empresa_id, app180_source, app180_event_id) DO NOTHING
      `;
      sincronizado = true;
    } catch (syncErr) { console.error("[AI] Error sync Google:", syncErr); }
  }
  return { success: true, mensaje: `Evento "${nombre}" creado para el ${fecha}${sincronizado ? ' y sincronizado con Google Calendar' : ''}`, evento: { id: result[0].id, fecha, nombre, tipo } };
}

async function sincronizarGoogleCalendar({ direccion = "bidirectional" }, empresaId) {
  const dateFrom = new Date().toISOString().split('T')[0];
  const dateTo = (() => { const d = new Date(); d.setMonth(d.getMonth() + 12); return d.toISOString().split('T')[0]; })();
  let stats;
  if (direccion === "to_google") stats = await syncToGoogle(empresaId, { dateFrom, dateTo, userId: null });
  else if (direccion === "from_google") stats = await syncFromGoogle(empresaId, { dateFrom, dateTo, userId: null });
  else stats = await syncBidirectional(empresaId, { dateFrom, dateTo, userId: null });
  return { success: true, mensaje: "Sincronización completada", estadisticas: stats };
}

async function consultarAusencias({ fecha_inicio, fecha_fin, empleado_id, tipo = "todos" }, empresaId) {
  let query = sql`
    SELECT a.id, a.tipo, a.fecha_inicio, a.fecha_fin, a.estado, a.comentario_empleado, a.motivo, e.nombre as empleado_nombre
    FROM ausencias_180 a LEFT JOIN employees_180 e ON a.empleado_id = e.id
    WHERE a.empresa_id = ${empresaId} AND a.fecha_inicio <= ${fecha_fin} AND a.fecha_fin >= ${fecha_inicio}
  `;
  if (empleado_id) query = sql`${query} AND a.empleado_id = ${empleado_id}`;
  if (tipo !== "todos") query = sql`${query} AND a.tipo = ${tipo}`;
  query = sql`${query} ORDER BY a.fecha_inicio ASC`;
  const ausencias = await query;
  return { total: ausencias.length, rango: { desde: fecha_inicio, hasta: fecha_fin }, ausencias: ausencias.map(a => ({ empleado: a.empleado_nombre, tipo: a.tipo, desde: a.fecha_inicio, hasta: a.fecha_fin, estado: a.estado, motivo: a.motivo || a.comentario_empleado })) };
}

async function consultarConocimiento({ busqueda }, empresaId) {
  const term = busqueda.trim();

  // Búsqueda con prioridad: match exacto del token > token contenido en búsqueda > búsqueda contenida en token
  const hits = await sql`
    SELECT token, respuesta, prioridad,
      CASE
        WHEN LOWER(token) = LOWER(${term}) THEN 3
        WHEN ${term} ILIKE ('%' || token || '%') THEN 2
        WHEN token ILIKE ${'%' + term + '%'} THEN 1
        ELSE 0
      END as relevancia
    FROM conocimiento_180
    WHERE empresa_id = ${empresaId}
      AND activo = true
      AND (
        LOWER(token) = LOWER(${term})
        OR ${term} ILIKE ('%' || token || '%')
        OR token ILIKE ${'%' + term + '%'}
      )
    ORDER BY relevancia DESC, prioridad DESC
    LIMIT 1
  `;

  if (hits.length === 0) {
    return { mensaje: null };
  }

  return {
    respuesta_directa: hits[0].respuesta,
    tema: hits[0].token
  };
}

// ============================
// MEMORIA
// ============================

async function cargarMemoria(empresaId, userId, limite = 3) {
  try {
    const memoria = await sql`
      SELECT mensaje, respuesta FROM contendo_memory_180
      WHERE empresa_id = ${empresaId} AND user_id = ${userId}
      ORDER BY created_at DESC LIMIT ${limite}
    `;
    return memoria.reverse().flatMap(m => [
      { role: "user", content: m.mensaje },
      { role: "assistant", content: m.respuesta }
    ]);
  } catch { return []; }
}

async function guardarConversacion(empresaId, userId, userRole, mensaje, respuesta) {
  try {
    await sql`
      INSERT INTO contendo_memory_180 (empresa_id, user_id, role, mensaje, respuesta, metadata)
      VALUES (${empresaId}, ${userId}, ${userRole}, ${mensaje}, ${respuesta}, ${JSON.stringify({ timestamp: new Date().toISOString() })})
    `;
  } catch (err) { console.error("[AI] Error guardando memoria:", err); }
}

// ============================
// CHAT PRINCIPAL
// ============================

export async function chatConAgente({ empresaId, userId, userRole, mensaje, historial = [] }) {
  try {
    console.log(`[AI] Chat - Empresa: ${empresaId}, Mensaje: ${mensaje}`);

    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY.length < 10) {
      return { mensaje: "El servicio de IA no está configurado. Contacta al administrador." };
    }

    const memoriaReciente = await cargarMemoria(empresaId, userId, 3);

    const mensajes = [
      {
        role: "system",
        content: `Eres CONTENDO, el asistente inteligente de APP180, una plataforma de gestión empresarial. Responde siempre en español, de forma natural y profesional.

TU PERSONALIDAD:
- Eres amable, cercano y profesional. Hablas con naturalidad.
- Cuando te saludan ("hola", "buenas", "qué tal", etc.), responde con un saludo cordial y ofrece tu ayuda. NO llames a ninguna herramienta para saludos.
- Si te dan las gracias o se despiden, responde con amabilidad.

SOBRE APP180 (lo que puedes hacer):
- Consultar facturas (validadas, borradores, anuladas) y su estado de cobro
- Ver empleados y clientes registrados
- Estadísticas de facturación por mes
- Trabajos pendientes de facturar
- Consultar el calendario de la empresa (festivos, cierres)
- Consultar ausencias de empleados
- Buscar en la base de conocimiento de la empresa

CUÁNDO USAR HERRAMIENTAS (solo para consultar datos reales):
- Preguntas sobre facturas → consultar_facturas o estadisticas_facturacion
- Preguntas sobre empleados ("¿cuántos empleados tenemos?") → consultar_empleados
- Preguntas sobre clientes → consultar_clientes
- Preguntas sobre calendario, festivos, cierres → consultar_calendario
- Preguntas sobre ausencias, vacaciones, bajas → consultar_ausencias
- Preguntas sobre trabajos sin facturar → trabajos_pendientes_facturar
- Información específica de la empresa o procedimientos → consultar_conocimiento

CUÁNDO NO USAR HERRAMIENTAS (responde directamente):
- Saludos y despedidas (hola, buenas, adiós, hasta luego)
- Agradecimientos (gracias, perfecto, ok)
- Preguntas sobre qué puedes hacer o cómo funcionas
- Conversación casual que no pide datos empresariales

REGLAS DE DATOS:
1. NUNCA inventes datos, cifras, nombres o importes. Solo responde con lo que devuelvan las herramientas.
2. Si una herramienta devuelve total: 0 o lista vacía, di claramente: "No hay [tipo de dato] registrados actualmente."
3. Si la pregunta es ambigua, pregunta al usuario qué necesita exactamente.

ESTADOS DE FACTURA:
- Emisión: VALIDADA, BORRADOR, ANULADA
- Cobro: pendiente, parcial, pagado
- "Pendientes de cobro" = estado_pago="pendiente"

FORMATO: Usa Markdown. Importes en € con 2 decimales. Fechas en formato DD/MM/YYYY.
El usuario es ${userRole === 'admin' ? 'administrador con acceso completo' : 'empleado'}.`
      },
      ...memoriaReciente,
      ...historial,
      { role: "user", content: mensaje }
    ];

    // Primera llamada con tools
    let response;
    try {
      response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: mensajes,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.3,
        max_tokens: 1024
      });
    } catch (apiErr) {
      console.error("[AI] Error API Groq:", apiErr.message);

      // FALLBACK: Si falla la API (Quota, Error 500, etc), intentamos usar el conocimiento local
      console.log("[AI] Activando modo fallback local...");
      const fallback = await consultarConocimiento({ busqueda: mensaje }, empresaId);

      if (fallback.respuesta_directa) {
        await guardarConversacion(empresaId, userId, userRole, mensaje, fallback.respuesta_directa);
        return { mensaje: fallback.respuesta_directa };
      }

      return { mensaje: "No pude procesar tu mensaje en este momento. Inténtalo de nuevo en unos minutos." };
    }

    let msg = response.choices?.[0]?.message;
    if (!msg) {
      // Si la respuesta es vacía pero no dio error (caso raro), también intentamos fallback
      const fallback = await consultarConocimiento({ busqueda: mensaje }, empresaId);
      if (fallback.respuesta_directa) {
        return { mensaje: fallback.respuesta_directa };
      }
      return { mensaje: "No pude procesar tu mensaje." };
    }

    // Procesar tool calls (máximo 3 iteraciones)
    // Acumulamos todos los mensajes de herramientas para no perder contexto entre iteraciones
    let iterations = 0;
    const toolHistory = [];
    while (msg.tool_calls && msg.tool_calls.length > 0 && iterations < 3) {
      iterations++;
      console.log(`[AI] Iteración ${iterations}: ${msg.tool_calls.length} herramientas`);

      toolHistory.push(msg);
      for (const tc of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }
        const resultado = await ejecutarHerramienta(tc.function.name, args, empresaId);
        toolHistory.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(resultado)
        });
      }

      // Llamada con historial completo de herramientas
      try {
        response = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [...mensajes, ...toolHistory],
          tools: TOOLS,
          tool_choice: "auto",
          temperature: 0.1,
          max_tokens: 1024
        });
      } catch (apiErr) {
        console.error("[AI] Error API Groq (tool response):", apiErr);
        return { mensaje: "Error al procesar los datos. Inténtalo de nuevo." };
      }

      msg = response.choices?.[0]?.message;
      if (!msg) {
        return { mensaje: "No pude generar una respuesta con los datos obtenidos." };
      }
    }

    const respuestaFinal = msg.content || "No pude generar una respuesta.";

    await guardarConversacion(empresaId, userId, userRole, mensaje, respuestaFinal);

    return { mensaje: respuestaFinal };

  } catch (error) {
    console.error("[AI] Error general:", error);
    return { mensaje: "Ha ocurrido un error inesperado. Inténtalo de nuevo más tarde." };
  }
}
