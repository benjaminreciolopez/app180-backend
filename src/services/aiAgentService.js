import Groq from "groq-sdk";
import { sql } from "../db.js";
import { getCalendarConfig } from "./googleCalendarService.js";
import { syncToGoogle, syncFromGoogle, syncBidirectional } from "./calendarSyncService.js";
import { createGoogleEvent, app180ToGoogleEvent } from "./googleCalendarService.js";

// Inicializar cliente de Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "gsk_demo_key_replace_me"
});

/**
 * Herramientas disponibles para el agente IA
 */
const TOOLS = [
  {
    type: "function",
    function: {
      name: "consultar_facturas",
      description: "Obtiene información sobre facturas de la empresa. Puede filtrar por estado de factura (validada/borrador/anulada) y estado de pago (pendiente/parcial/pagado).",
      parameters: {
        type: "object",
        properties: {
          estado: {
            type: "string",
            enum: ["VALIDADA", "BORRADOR", "ANULADA", "TODOS"],
            description: "Estado de emisión de la factura: VALIDADA (confirmada), BORRADOR (en edición), ANULADA (cancelada), o TODOS"
          },
          estado_pago: {
            type: "string",
            enum: ["pendiente", "parcial", "pagado", "todos"],
            description: "Estado de cobro: pendiente (sin cobrar), parcial (parcialmente cobrada), pagado (totalmente cobrada), o todos"
          },
          cliente_id: {
            type: "string",
            description: "ID del cliente (UUID) para filtrar facturas"
          },
          limite: {
            type: "number",
            description: "Número máximo de facturas a devolver (default: 10)"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_empleados",
      description: "Obtiene información sobre empleados de la empresa, como nombre, email, estado, horas trabajadas.",
      parameters: {
        type: "object",
        properties: {
          activos_solo: {
            type: "boolean",
            description: "Si es true, solo devuelve empleados activos"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_clientes",
      description: "Obtiene información sobre clientes de la empresa.",
      parameters: {
        type: "object",
        properties: {
          activos_solo: {
            type: "boolean",
            description: "Si es true, solo devuelve clientes activos"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "estadisticas_facturacion",
      description: "Devuelve estadísticas de facturación: total facturado, total pendiente, facturas por estado, etc.",
      parameters: {
        type: "object",
        properties: {
          mes: {
            type: "number",
            description: "Mes a consultar (1-12). Si no se proporciona, usa el mes actual"
          },
          anio: {
            type: "number",
            description: "Año a consultar. Si no se proporciona, usa el año actual"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "trabajos_pendientes_facturar",
      description: "Lista trabajos completados que aún no han sido facturados.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: {
            type: "string",
            description: "ID del cliente para filtrar trabajos"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_calendario",
      description: "Consulta eventos del calendario de la empresa (festivos, cierres) en un rango de fechas.",
      parameters: {
        type: "object",
        properties: {
          fecha_inicio: {
            type: "string",
            description: "Fecha de inicio en formato YYYY-MM-DD"
          },
          fecha_fin: {
            type: "string",
            description: "Fecha de fin en formato YYYY-MM-DD"
          },
          tipo: {
            type: "string",
            enum: ["todos", "festivos", "cierres", "laborables"],
            description: "Filtrar por tipo de evento"
          }
        },
        required: ["fecha_inicio", "fecha_fin"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "crear_evento_calendario",
      description: "Crea un nuevo evento en el calendario y lo sincroniza automáticamente con Google Calendar si está configurado.",
      parameters: {
        type: "object",
        properties: {
          fecha: {
            type: "string",
            description: "Fecha del evento en formato YYYY-MM-DD"
          },
          nombre: {
            type: "string",
            description: "Nombre del evento"
          },
          tipo: {
            type: "string",
            enum: ["festivo_local", "festivo_empresa", "cierre_empresa"],
            description: "Tipo de evento"
          },
          es_laborable: {
            type: "boolean",
            description: "Si el día es laborable o no (default: false para festivos/cierres)"
          },
          descripcion: {
            type: "string",
            description: "Descripción opcional del evento"
          }
        },
        required: ["fecha", "nombre", "tipo"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "sincronizar_google_calendar",
      description: "Fuerza una sincronización manual con Google Calendar.",
      parameters: {
        type: "object",
        properties: {
          direccion: {
            type: "string",
            enum: ["to_google", "from_google", "bidirectional"],
            description: "Dirección de sincronización"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_ausencias",
      description: "Consulta ausencias de empleados (vacaciones, bajas médicas) en un rango de fechas.",
      parameters: {
        type: "object",
        properties: {
          fecha_inicio: {
            type: "string",
            description: "Fecha de inicio en formato YYYY-MM-DD"
          },
          fecha_fin: {
            type: "string",
            description: "Fecha de fin en formato YYYY-MM-DD"
          },
          empleado_id: {
            type: "string",
            description: "ID del empleado para filtrar ausencias"
          },
          tipo: {
            type: "string",
            enum: ["todos", "vacaciones", "baja_medica"],
            description: "Filtrar por tipo de ausencia"
          }
        },
        required: ["fecha_inicio", "fecha_fin"]
      }
    }
  }
];

/**
 * Ejecuta una herramienta del agente
 */
async function ejecutarHerramienta(nombreHerramienta, argumentos, empresaId) {
  console.log(`[AI] Ejecutando herramienta: ${nombreHerramienta}`, argumentos);

  switch (nombreHerramienta) {
    case "consultar_facturas":
      return await consultarFacturas(argumentos, empresaId);

    case "consultar_empleados":
      return await consultarEmpleados(argumentos, empresaId);

    case "consultar_clientes":
      return await consultarClientes(argumentos, empresaId);

    case "estadisticas_facturacion":
      return await estadisticasFacturacion(argumentos, empresaId);

    case "trabajos_pendientes_facturar":
      return await trabajosPendientesFacturar(argumentos, empresaId);

    case "consultar_calendario":
      return await consultarCalendario(argumentos, empresaId);

    case "crear_evento_calendario":
      return await crearEventoCalendario(argumentos, empresaId);

    case "sincronizar_google_calendar":
      return await sincronizarGoogleCalendar(argumentos, empresaId);

    case "consultar_ausencias":
      return await consultarAusencias(argumentos, empresaId);

    default:
      return { error: "Herramienta no encontrada" };
  }
}

/**
 * Herramienta: Consultar facturas
 */
async function consultarFacturas({ estado = "TODOS", estado_pago = "todos", cliente_id, limite = 10 }, empresaId) {
  try {
    let query = sql`
      SELECT
        f.id, f.numero, f.fecha, f.total, f.estado,
        f.pagado, f.estado_pago,
        c.nombre as cliente_nombre
      FROM factura_180 f
      LEFT JOIN clients_180 c ON f.cliente_id = c.id
      WHERE f.empresa_id = ${empresaId}
    `;

    if (estado !== "TODOS") {
      query = sql`${query} AND f.estado = ${estado}`;
    }

    if (estado_pago !== "todos") {
      query = sql`${query} AND COALESCE(f.estado_pago, 'pendiente') = ${estado_pago}`;
    }

    if (cliente_id) {
      query = sql`${query} AND f.cliente_id = ${cliente_id}`;
    }

    query = sql`${query} ORDER BY f.fecha DESC LIMIT ${limite}`;

    const facturas = await query;

    return {
      total: facturas.length,
      facturas: facturas.map(f => ({
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
  } catch (error) {
    console.error("[AI] Error en consultarFacturas:", error);
    return { error: error.message };
  }
}

/**
 * Herramienta: Consultar empleados
 */
async function consultarEmpleados({ activos_solo = true }, empresaId) {
  try {
    let query = sql`
      SELECT id, nombre, email, active
      FROM employees_180
      WHERE empresa_id = ${empresaId}
    `;

    if (activos_solo) {
      query = sql`${query} AND active = true`;
    }

    query = sql`${query} ORDER BY nombre ASC`;

    const empleados = await query;

    return {
      total: empleados.length,
      empleados: empleados.map(e => ({
        nombre: e.nombre,
        email: e.email,
        activo: e.active
      }))
    };
  } catch (error) {
    console.error("[AI] Error en consultarEmpleados:", error);
    return { error: error.message };
  }
}

/**
 * Herramienta: Consultar clientes
 */
async function consultarClientes({ activos_solo = true }, empresaId) {
  try {
    let query = sql`
      SELECT id, nombre, email, telefono, active
      FROM clients_180
      WHERE empresa_id = ${empresaId}
    `;

    if (activos_solo) {
      query = sql`${query} AND active = true`;
    }

    query = sql`${query} ORDER BY nombre ASC`;

    const clientes = await query;

    return {
      total: clientes.length,
      clientes: clientes.map(c => ({
        nombre: c.nombre,
        email: c.email,
        telefono: c.telefono,
        activo: c.active
      }))
    };
  } catch (error) {
    console.error("[AI] Error en consultarClientes:", error);
    return { error: error.message };
  }
}

/**
 * Herramienta: Estadísticas de facturación
 */
async function estadisticasFacturacion({ mes, anio }, empresaId) {
  try {
    const now = new Date();
    const mesActual = mes || (now.getMonth() + 1);
    const anioActual = anio || now.getFullYear();

    // Total facturado en el período
    const stats = await sql`
      SELECT
        COUNT(*) as total_facturas,
        COALESCE(SUM(total), 0) as total_facturado,
        COALESCE(SUM(pagado), 0) as total_cobrado,
        COALESCE(SUM(total - COALESCE(pagado, 0)), 0) as total_pendiente
      FROM factura_180
      WHERE empresa_id = ${empresaId}
        AND estado = 'VALIDADA'
        AND EXTRACT(MONTH FROM fecha) = ${mesActual}
        AND EXTRACT(YEAR FROM fecha) = ${anioActual}
    `;

    // Facturas por estado de pago
    const porEstado = await sql`
      SELECT
        COALESCE(estado_pago, 'pendiente') as estado,
        COUNT(*) as cantidad,
        COALESCE(SUM(total), 0) as importe
      FROM factura_180
      WHERE empresa_id = ${empresaId}
        AND estado = 'VALIDADA'
        AND EXTRACT(MONTH FROM fecha) = ${mesActual}
        AND EXTRACT(YEAR FROM fecha) = ${anioActual}
      GROUP BY estado_pago
    `;

    return {
      periodo: `${mesActual}/${anioActual}`,
      total_facturas: Number(stats[0].total_facturas),
      total_facturado: Number(stats[0].total_facturado),
      total_cobrado: Number(stats[0].total_cobrado),
      total_pendiente: Number(stats[0].total_pendiente),
      por_estado: porEstado.map(e => ({
        estado: e.estado,
        cantidad: Number(e.cantidad),
        importe: Number(e.importe)
      }))
    };
  } catch (error) {
    console.error("[AI] Error en estadisticasFacturacion:", error);
    return { error: error.message };
  }
}

/**
 * Herramienta: Trabajos pendientes de facturar
 */
async function trabajosPendientesFacturar({ cliente_id }, empresaId) {
  try {
    let query = sql`
      SELECT
        w.id, w.descripcion, w.fecha, w.valor,
        c.nombre as cliente_nombre
      FROM work_logs_180 w
      LEFT JOIN clients_180 c ON w.cliente_id = c.id
      WHERE w.empresa_id = ${empresaId}
        AND w.factura_id IS NULL
    `;

    if (cliente_id) {
      query = sql`${query} AND w.cliente_id = ${cliente_id}`;
    }

    query = sql`${query} ORDER BY w.fecha DESC LIMIT 20`;

    const trabajos = await query;

    return {
      total: trabajos.length,
      total_valor: trabajos.reduce((sum, t) => sum + Number(t.valor), 0),
      trabajos: trabajos.map(t => ({
        descripcion: t.descripcion,
        fecha: t.fecha,
        cliente: t.cliente_nombre,
        valor: Number(t.valor)
      }))
    };
  } catch (error) {
    console.error("[AI] Error en trabajosPendientesFacturar:", error);
    return { error: error.message };
  }
}

/**
 * Herramienta: Consultar calendario
 */
async function consultarCalendario({ fecha_inicio, fecha_fin, tipo = "todos" }, empresaId) {
  try {
    let query = sql`
      SELECT
        id, fecha, tipo, nombre, descripcion, es_laborable, origen
      FROM calendario_empresa_180
      WHERE empresa_id = ${empresaId}
        AND fecha >= ${fecha_inicio}
        AND fecha <= ${fecha_fin}
        AND activo = true
    `;

    // Filtrar por tipo
    if (tipo === "festivos") {
      query = sql`${query} AND tipo IN ('festivo_local', 'festivo_nacional', 'festivo_empresa', 'convenio')`;
    } else if (tipo === "cierres") {
      query = sql`${query} AND tipo IN ('cierre_empresa', 'no_laborable')`;
    } else if (tipo === "laborables") {
      query = sql`${query} AND es_laborable = true`;
    }

    query = sql`${query} ORDER BY fecha ASC`;

    const eventos = await query;

    return {
      total: eventos.length,
      rango: { desde: fecha_inicio, hasta: fecha_fin },
      eventos: eventos.map(e => ({
        fecha: e.fecha,
        tipo: e.tipo,
        nombre: e.nombre,
        descripcion: e.descripcion,
        es_laborable: e.es_laborable,
        origen: e.origen
      }))
    };
  } catch (error) {
    console.error("[AI] Error en consultarCalendario:", error);
    return { error: error.message };
  }
}

/**
 * Herramienta: Crear evento calendario
 */
async function crearEventoCalendario({ fecha, nombre, tipo, es_laborable = false, descripcion = "" }, empresaId) {
  try {
    // 1. Crear en APP180
    const result = await sql`
      INSERT INTO calendario_empresa_180 (
        empresa_id, fecha, tipo, nombre, descripcion, es_laborable, origen, activo, confirmado
      )
      VALUES (
        ${empresaId}, ${fecha}, ${tipo}, ${nombre}, ${descripcion}, ${es_laborable}, 'ai_agent', true, true
      )
      RETURNING id
    `;

    // 2. Verificar si Google Calendar está conectado
    const calendarConfig = await getCalendarConfig(empresaId);
    let sincronizado = false;

    if (calendarConfig && calendarConfig.sync_enabled) {
      try {
        // 3. Crear en Google Calendar
        const evento = {
          id: result[0].id,
          fecha,
          tipo,
          nombre,
          descripcion,
          es_laborable
        };

        const googleEventData = app180ToGoogleEvent(evento);
        await createGoogleEvent(empresaId, googleEventData);

        // 4. Crear mapping (simplificado)
        await sql`
          INSERT INTO calendar_event_mapping_180 (
            empresa_id, app180_source, app180_event_id, google_calendar_id, google_event_id, sync_direction
          )
          VALUES (
            ${empresaId}, 'calendario_empresa', ${result[0].id}, ${calendarConfig.calendar_id || 'primary'}, ${result[0].id}, 'to_google'
          )
          ON CONFLICT (empresa_id, app180_source, app180_event_id) DO NOTHING
        `;

        sincronizado = true;
      } catch (syncErr) {
        console.error("[AI] Error sincronizando con Google:", syncErr);
        // Continuar, el evento se creó en APP180
      }
    }

    return {
      success: true,
      mensaje: `Evento "${nombre}" creado para el ${fecha}${sincronizado ? ' y sincronizado con Google Calendar' : ''}`,
      evento: {
        id: result[0].id,
        fecha,
        nombre,
        tipo
      }
    };
  } catch (error) {
    console.error("[AI] Error en crearEventoCalendario:", error);
    return { error: error.message };
  }
}

/**
 * Herramienta: Sincronizar Google Calendar
 */
async function sincronizarGoogleCalendar({ direccion = "bidirectional" }, empresaId) {
  try {
    const dateFrom = new Date().toISOString().split('T')[0];
    const dateTo = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 12);
      return d.toISOString().split('T')[0];
    })();

    let stats;

    if (direccion === "to_google") {
      stats = await syncToGoogle(empresaId, { dateFrom, dateTo, userId: null });
    } else if (direccion === "from_google") {
      stats = await syncFromGoogle(empresaId, { dateFrom, dateTo, userId: null });
    } else {
      stats = await syncBidirectional(empresaId, { dateFrom, dateTo, userId: null });
    }

    return {
      success: true,
      mensaje: "Sincronización completada",
      estadisticas: stats
    };
  } catch (error) {
    console.error("[AI] Error en sincronizarGoogleCalendar:", error);
    return { error: error.message };
  }
}

/**
 * Herramienta: Consultar ausencias
 */
async function consultarAusencias({ fecha_inicio, fecha_fin, empleado_id, tipo = "todos" }, empresaId) {
  try {
    let query = sql`
      SELECT
        a.id, a.tipo, a.fecha_inicio, a.fecha_fin, a.estado, a.comentario_empleado, a.motivo,
        e.nombre as empleado_nombre
      FROM ausencias_180 a
      LEFT JOIN employee_180 e ON a.empleado_id = e.id
      WHERE a.empresa_id = ${empresaId}
        AND a.fecha_inicio <= ${fecha_fin}
        AND a.fecha_fin >= ${fecha_inicio}
    `;

    if (empleado_id) {
      query = sql`${query} AND a.empleado_id = ${empleado_id}`;
    }

    if (tipo !== "todos") {
      query = sql`${query} AND a.tipo = ${tipo}`;
    }

    query = sql`${query} ORDER BY a.fecha_inicio ASC`;

    const ausencias = await query;

    return {
      total: ausencias.length,
      rango: { desde: fecha_inicio, hasta: fecha_fin },
      ausencias: ausencias.map(a => ({
        empleado: a.empleado_nombre,
        tipo: a.tipo,
        desde: a.fecha_inicio,
        hasta: a.fecha_fin,
        estado: a.estado,
        motivo: a.motivo || a.comentario_empleado
      }))
    };
  } catch (error) {
    console.error("[AI] Error en consultarAusencias:", error);
    return { error: error.message };
  }
}

/**
 * Carga memoria reciente de conversaciones
 */
async function cargarMemoria(empresaId, userId, limite = 5) {
  try {
    const memoria = await sql`
      SELECT mensaje, respuesta, created_at
      FROM contendo_memory_180
      WHERE empresa_id = ${empresaId} AND user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limite}
    `;

    // Formatear como mensajes de chat (más recientes primero, luego invertir)
    return memoria.reverse().flatMap(m => [
      { role: "user", content: m.mensaje },
      { role: "assistant", content: m.respuesta }
    ]);
  } catch (error) {
    console.error("[AI] Error cargando memoria:", error);
    return [];
  }
}

/**
 * Guarda conversación en memoria persistente
 */
async function guardarConversacion(empresaId, userId, userRole, mensaje, respuesta) {
  try {
    await sql`
      INSERT INTO contendo_memory_180
      (empresa_id, user_id, role, mensaje, respuesta, metadata)
      VALUES (
        ${empresaId},
        ${userId},
        ${userRole},
        ${mensaje},
        ${respuesta},
        ${JSON.stringify({ timestamp: new Date().toISOString() })}
      )
    `;
    console.log("[AI] Conversación guardada en memoria");
  } catch (error) {
    console.error("[AI] Error guardando memoria:", error);
    // No lanzar error, la memoria es opcional
  }
}

/**
 * Servicio principal de chat con IA
 */
export async function chatConAgente({ empresaId, userId, userRole, mensaje, historial = [] }) {
  try {
    console.log(`[AI] Chat iniciado - EmpresaID: ${empresaId}, Mensaje: ${mensaje}`);

    // 🆕 Cargar memoria de conversaciones anteriores
    const memoriaReciente = await cargarMemoria(empresaId, userId, 3);

    // Construir mensajes para Groq
    const mensajes = [
      {
        role: "system",
        content: `Eres CONTENDO, el asistente inteligente de gestión empresarial de APP180.

Tu función es ayudar a los usuarios a:
- Consultar información sobre facturas, empleados, clientes y pagos
- Analizar estadísticas de facturación
- Gestionar calendario de eventos (festivos, cierres, ausencias)
- Sincronizar automáticamente con Google Calendar
- Responder preguntas sobre el estado del negocio
- Dar recomendaciones basadas en datos

IMPORTANTE - Diferencia entre estados:
1. **Estado de factura** (emisión):
   - VALIDADA: Factura confirmada y emitida
   - BORRADOR: Factura en edición
   - ANULADA: Factura cancelada

2. **Estado de pago** (cobro):
   - pendiente: Sin cobrar
   - parcial: Parcialmente cobrada
   - pagado: Totalmente cobrada

Cuando el usuario pregunte por facturas "pendientes" o "por cobrar", usa el filtro estado_pago="pendiente".
Cuando pregunte por facturas "emitidas" o "validadas", usa el filtro estado="VALIDADA".

CALENDARIO Y EVENTOS:
- Puedes consultar eventos del calendario usando "consultar_calendario"
- Puedes crear nuevos eventos usando "crear_evento_calendario"
- Los eventos se sincronizan AUTOMÁTICAMENTE con Google Calendar si está configurado
- Puedes forzar una sincronización manual con "sincronizar_google_calendar"
- Las ausencias (vacaciones, bajas) se consultan con "consultar_ausencias"

TIPOS DE EVENTOS:
- festivo_local: Festivo específico de la localidad
- festivo_empresa: Festivo establecido por la empresa
- cierre_empresa: Días de cierre (ej: puente, Navidad)
- convenio: Días del convenio colectivo
- laborable_extra: Días especiales laborables

Cuando el usuario pida "crea un festivo", usa tipo "festivo_local".
Cuando pida "cierra la empresa", usa tipo "cierre_empresa".

FORMATO:
- Siempre responde en español
- Sé conciso pero completo
- Usa formato markdown para mejorar la legibilidad
- Si no tienes información suficiente, usa las herramientas disponibles
- Los importes siempre en euros (€)
- Las fechas en formato español (DD/MM/YYYY)

El usuario es ${userRole === 'admin' ? 'administrador' : 'empleado'}.`
      },
      ...memoriaReciente,
      ...historial,
      {
        role: "user",
        content: mensaje
      }
    ];

    // Llamar a Groq con tool calling
    let response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: mensajes,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.7,
      max_tokens: 1024
    });

    let mensajeRespuesta = response.choices[0].message;

    // Si el modelo quiere usar herramientas
    if (mensajeRespuesta.tool_calls && mensajeRespuesta.tool_calls.length > 0) {
      console.log(`[AI] ${mensajeRespuesta.tool_calls.length} herramientas solicitadas`);

      // Ejecutar todas las herramientas solicitadas
      const toolMessages = [];

      for (const toolCall of mensajeRespuesta.tool_calls) {
        const nombreHerramienta = toolCall.function.name;
        const argumentos = JSON.parse(toolCall.function.arguments);

        const resultado = await ejecutarHerramienta(nombreHerramienta, argumentos, empresaId);

        toolMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(resultado)
        });
      }

      // Continuar la conversación con los resultados de las herramientas
      const mensajesConHerramientas = [
        ...mensajes,
        mensajeRespuesta,
        ...toolMessages
      ];

      response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: mensajesConHerramientas,
        temperature: 0.7,
        max_tokens: 1024
      });

      mensajeRespuesta = response.choices[0].message;
    }

    const respuestaFinal = mensajeRespuesta.content;

    // 🆕 Guardar conversación en memoria para futuras interacciones
    await guardarConversacion(empresaId, userId, userRole, mensaje, respuestaFinal);

    return {
      mensaje: respuestaFinal,
      tool_calls: mensajeRespuesta.tool_calls || []
    };

  } catch (error) {
    console.error("[AI] Error en chatConAgente:", error);
    throw error;
  }
}
