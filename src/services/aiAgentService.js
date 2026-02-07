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
  // ===== CONSULTA (READ) =====
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

  // ===== CALENDARIO (WRITE) =====
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
      name: "eliminar_evento_calendario",
      description: "Elimina un evento del calendario.",
      parameters: {
        type: "object",
        properties: {
          evento_id: { type: "string", description: "ID del evento a eliminar" }
        },
        required: ["evento_id"]
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

  // ===== FACTURAS (WRITE) =====
  {
    type: "function",
    function: {
      name: "crear_factura",
      description: "Crea una factura en borrador. Requiere cliente_id, fecha y al menos una linea con descripcion, cantidad y precio_unitario.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente (integer)" },
          fecha: { type: "string", description: "Fecha YYYY-MM-DD" },
          lineas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                descripcion: { type: "string" },
                cantidad: { type: "number" },
                precio_unitario: { type: "number" },
                iva: { type: "number", description: "Porcentaje IVA (ej: 21)" }
              },
              required: ["descripcion", "cantidad", "precio_unitario"]
            },
            description: "Lineas de la factura"
          },
          iva_global: { type: "number", description: "IVA global si todas las lineas tienen el mismo" }
        },
        required: ["cliente_id", "fecha", "lineas"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "actualizar_factura",
      description: "Actualiza una factura en borrador. Solo borradores pueden modificarse.",
      parameters: {
        type: "object",
        properties: {
          factura_id: { type: "string", description: "ID de la factura (integer)" },
          cliente_id: { type: "string", description: "Nuevo cliente_id" },
          fecha: { type: "string", description: "Nueva fecha YYYY-MM-DD" },
          lineas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                descripcion: { type: "string" },
                cantidad: { type: "number" },
                precio_unitario: { type: "number" },
                iva: { type: "number" }
              }
            },
            description: "Nuevas lineas (reemplaza las anteriores)"
          }
        },
        required: ["factura_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "validar_factura",
      description: "Valida una factura borrador (la convierte en definitiva con numero). ACCION IRREVERSIBLE que requiere confirmacion.",
      parameters: {
        type: "object",
        properties: {
          factura_id: { type: "string", description: "ID de la factura" }
        },
        required: ["factura_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "anular_factura",
      description: "Anula una factura validada. ACCION PELIGROSA que requiere confirmacion.",
      parameters: {
        type: "object",
        properties: {
          factura_id: { type: "string", description: "ID de la factura a anular" }
        },
        required: ["factura_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_factura",
      description: "Elimina una factura borrador. ACCION PELIGROSA que requiere confirmacion.",
      parameters: {
        type: "object",
        properties: {
          factura_id: { type: "string", description: "ID de la factura borrador a eliminar" }
        },
        required: ["factura_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "enviar_factura_email",
      description: "Envia una factura validada por email con PDF adjunto.",
      parameters: {
        type: "object",
        properties: {
          factura_id: { type: "string", description: "ID de la factura" },
          destinatario: { type: "string", description: "Email del destinatario" },
          asunto: { type: "string", description: "Asunto del email (opcional)" }
        },
        required: ["factura_id", "destinatario"]
      }
    }
  },

  // ===== CLIENTES (WRITE) =====
  {
    type: "function",
    function: {
      name: "crear_cliente",
      description: "Crea un nuevo cliente.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del cliente" },
          email: { type: "string", description: "Email" },
          telefono: { type: "string", description: "Telefono" },
          nif_cif: { type: "string", description: "NIF/CIF" },
          direccion: { type: "string", description: "Direccion" },
          notas: { type: "string", description: "Notas" }
        },
        required: ["nombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "actualizar_cliente",
      description: "Actualiza datos de un cliente existente.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente" },
          nombre: { type: "string" },
          email: { type: "string" },
          telefono: { type: "string" },
          nif_cif: { type: "string" },
          direccion: { type: "string" },
          notas: { type: "string" }
        },
        required: ["cliente_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desactivar_cliente",
      description: "Desactiva un cliente. ACCION que requiere confirmacion.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente a desactivar" }
        },
        required: ["cliente_id"]
      }
    }
  },

  // ===== PAGOS (WRITE) =====
  {
    type: "function",
    function: {
      name: "crear_pago",
      description: "Registra un cobro/pago de un cliente.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente" },
          importe: { type: "number", description: "Importe del pago" },
          metodo: { type: "string", enum: ["transferencia", "efectivo", "tarjeta", "bizum", "otro"], description: "Metodo de pago" },
          fecha_pago: { type: "string", description: "Fecha del pago YYYY-MM-DD" },
          referencia: { type: "string", description: "Referencia o concepto" }
        },
        required: ["cliente_id", "importe", "metodo"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_pago",
      description: "Elimina un pago registrado. ACCION PELIGROSA que requiere confirmacion.",
      parameters: {
        type: "object",
        properties: {
          pago_id: { type: "string", description: "ID del pago a eliminar" }
        },
        required: ["pago_id"]
      }
    }
  },

  // ===== EMPLEADOS (WRITE) =====
  {
    type: "function",
    function: {
      name: "actualizar_empleado",
      description: "Actualiza datos de un empleado.",
      parameters: {
        type: "object",
        properties: {
          empleado_id: { type: "string", description: "ID del empleado" },
          nombre: { type: "string" },
          activo: { type: "string", enum: ["true", "false"] }
        },
        required: ["empleado_id"]
      }
    }
  },

  // ===== TRABAJOS (WRITE) =====
  {
    type: "function",
    function: {
      name: "crear_trabajo",
      description: "Registra un trabajo realizado (work log).",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente" },
          descripcion: { type: "string", description: "Descripcion del trabajo" },
          fecha: { type: "string", description: "Fecha YYYY-MM-DD" },
          minutos: { type: "number", description: "Duracion en minutos" },
          precio: { type: "number", description: "Valor/precio manual (opcional)" }
        },
        required: ["descripcion", "minutos"]
      }
    }
  },

  // ===== AUSENCIAS (WRITE) =====
  {
    type: "function",
    function: {
      name: "crear_ausencia",
      description: "Crea una ausencia (vacaciones, baja medica, etc.) para un empleado.",
      parameters: {
        type: "object",
        properties: {
          empleado_id: { type: "string", description: "ID del empleado" },
          tipo: { type: "string", enum: ["vacaciones", "baja_medica", "asuntos_propios", "permiso"], description: "Tipo de ausencia" },
          fecha_inicio: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_fin: { type: "string", description: "Fecha fin YYYY-MM-DD" },
          motivo: { type: "string", description: "Motivo o comentario" }
        },
        required: ["empleado_id", "tipo", "fecha_inicio", "fecha_fin"]
      }
    }
  },
];

// ============================
// EJECUTAR HERRAMIENTAS
// ============================

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
      // Lectura
      case "consultar_facturas": return await consultarFacturas(args, empresaId);
      case "consultar_empleados": return await consultarEmpleados(args, empresaId);
      case "consultar_clientes": return await consultarClientes(args, empresaId);
      case "estadisticas_facturacion": return await estadisticasFacturacion(args, empresaId);
      case "trabajos_pendientes_facturar": return await trabajosPendientesFacturar(args, empresaId);
      case "consultar_calendario": return await consultarCalendario(args, empresaId);
      case "consultar_ausencias": return await consultarAusencias(args, empresaId);
      case "consultar_conocimiento": return await consultarConocimiento(args, empresaId);
      // Calendario
      case "crear_evento_calendario": return await crearEventoCalendario(args, empresaId);
      case "eliminar_evento_calendario": return await eliminarEventoCalendario(args, empresaId);
      case "sincronizar_google_calendar": return await sincronizarGoogleCalendar(args, empresaId);
      // Facturas
      case "crear_factura": return await crearFactura(args, empresaId);
      case "actualizar_factura": return await actualizarFactura(args, empresaId);
      case "validar_factura": return await validarFactura(args, empresaId);
      case "anular_factura": return await anularFactura(args, empresaId);
      case "eliminar_factura": return await eliminarFacturaBorrador(args, empresaId);
      case "enviar_factura_email": return await enviarFacturaEmail(args, empresaId);
      // Clientes
      case "crear_cliente": return await crearCliente(args, empresaId);
      case "actualizar_cliente": return await actualizarCliente(args, empresaId);
      case "desactivar_cliente": return await desactivarCliente(args, empresaId);
      // Pagos
      case "crear_pago": return await crearPago(args, empresaId);
      case "eliminar_pago": return await eliminarPago(args, empresaId);
      // Empleados
      case "actualizar_empleado": return await actualizarEmpleado(args, empresaId);
      // Trabajos
      case "crear_trabajo": return await crearTrabajo(args, empresaId);
      // Ausencias
      case "crear_ausencia": return await crearAusencia(args, empresaId);
      default: return { error: "Herramienta no encontrada" };
    }
  } catch (err) {
    console.error(`[AI] Error en herramienta ${nombreHerramienta}:`, err);
    return { error: err.message || "Error ejecutando herramienta" };
  }
}

// ============================
// HERRAMIENTAS DE LECTURA
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
      id: f.id, numero: f.numero || "Borrador", fecha: f.fecha, cliente: f.cliente_nombre,
      total: Number(f.total), pagado: Number(f.pagado || 0),
      saldo: Number(f.total) - Number(f.pagado || 0),
      estado: f.estado, estado_pago: f.estado_pago || "pendiente"
    }))
  };
}

async function consultarEmpleados({ activos_solo = true }, empresaId) {
  let query = sql`
    SELECT e.id, e.nombre, e.activo, e.tipo_trabajo, u.email
    FROM employees_180 e
    LEFT JOIN users_180 u ON e.user_id = u.id
    WHERE e.empresa_id = ${empresaId}`;
  if (activos_solo) query = sql`${query} AND e.activo = true`;
  query = sql`${query} ORDER BY e.nombre ASC`;
  const empleados = await query;
  return { total: empleados.length, empleados: empleados.map(e => ({ id: e.id, nombre: e.nombre, email: e.email, tipo: e.tipo_trabajo, activo: e.activo })) };
}

async function consultarClientes({ activos_solo = true }, empresaId) {
  let query = sql`SELECT id, nombre, email, telefono, activo FROM clients_180 WHERE empresa_id = ${empresaId}`;
  if (activos_solo) query = sql`${query} AND activo = true`;
  query = sql`${query} ORDER BY nombre ASC`;
  const clientes = await query;
  return { total: clientes.length, clientes: clientes.map(c => ({ id: c.id, nombre: c.nombre, email: c.email, telefono: c.telefono, activo: c.activo })) };
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
  return { total: eventos.length, rango: { desde: fecha_inicio, hasta: fecha_fin }, eventos: eventos.map(e => ({ id: e.id, fecha: e.fecha, tipo: e.tipo, nombre: e.nombre, descripcion: e.descripcion, es_laborable: e.es_laborable })) };
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
  if (hits.length === 0) return { mensaje: null };
  return { respuesta_directa: hits[0].respuesta, tema: hits[0].token };
}

// ============================
// HERRAMIENTAS DE ESCRITURA - CALENDARIO
// ============================

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

async function eliminarEventoCalendario({ evento_id }, empresaId) {
  const [evento] = await sql`SELECT id, nombre, fecha FROM calendario_empresa_180 WHERE id = ${evento_id} AND empresa_id = ${empresaId}`;
  if (!evento) return { error: "Evento no encontrado" };
  await sql`UPDATE calendario_empresa_180 SET activo = false WHERE id = ${evento_id} AND empresa_id = ${empresaId}`;
  return { success: true, mensaje: `Evento "${evento.nombre}" del ${evento.fecha} eliminado.` };
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

// ============================
// HERRAMIENTAS DE ESCRITURA - FACTURAS
// ============================

async function crearFactura({ cliente_id, fecha, lineas, iva_global = 0 }, empresaId) {
  const [cliente] = await sql`SELECT id, nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  if (!cliente) return { error: "Cliente no encontrado" };
  if (!Array.isArray(lineas) || lineas.length === 0) return { error: "Debe incluir al menos una linea" };

  let createdId;
  let total;
  await sql.begin(async (tx) => {
    let subtotal = 0;
    let iva_total = 0;
    const [factura] = await tx`
      INSERT INTO factura_180 (empresa_id, cliente_id, fecha, estado, iva_global, subtotal, iva_total, total, created_at)
      VALUES (${empresaId}, ${cliente_id}, ${fecha}::date, 'BORRADOR', ${iva_global || 0}, 0, 0, 0, now())
      RETURNING id
    `;
    createdId = factura.id;

    for (const linea of lineas) {
      const descripcion = (linea.descripcion || "").trim();
      if (!descripcion) continue;
      const cantidad = parseFloat(linea.cantidad || 0);
      const precio_unitario = parseFloat(linea.precio_unitario || 0);
      const iva_pct = parseFloat(linea.iva || iva_global || 0);
      const base = cantidad * precio_unitario;
      const importe_iva = base * iva_pct / 100;
      subtotal += base;
      iva_total += importe_iva;
      await tx`
        INSERT INTO lineafactura_180 (factura_id, descripcion, cantidad, precio_unitario, total, iva_percent)
        VALUES (${factura.id}, ${descripcion}, ${cantidad}, ${precio_unitario}, ${base + importe_iva}, ${iva_pct})
      `;
    }
    total = Math.round((subtotal + iva_total) * 100) / 100;
    await tx`
      UPDATE factura_180 SET subtotal = ${Math.round(subtotal * 100) / 100},
        iva_total = ${Math.round(iva_total * 100) / 100}, total = ${total}
      WHERE id = ${factura.id}
    `;
  });

  return { success: true, mensaje: `Factura borrador creada para ${cliente.nombre}. Total: ${total.toFixed(2)} EUR. ID: ${createdId}`, factura: { id: createdId, cliente: cliente.nombre, total, estado: "BORRADOR" } };
}

async function actualizarFactura({ factura_id, cliente_id, fecha, lineas }, empresaId) {
  const [factura] = await sql`SELECT * FROM factura_180 WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;
  if (!factura) return { error: "Factura no encontrada" };
  if (factura.estado !== "BORRADOR") return { error: "Solo se pueden editar facturas en borrador" };

  await sql.begin(async (tx) => {
    if (cliente_id || fecha) {
      await tx`
        UPDATE factura_180 SET
          cliente_id = ${cliente_id || factura.cliente_id},
          fecha = ${fecha ? sql`${fecha}::date` : factura.fecha}
        WHERE id = ${factura_id}
      `;
    }
    if (Array.isArray(lineas) && lineas.length > 0) {
      await tx`DELETE FROM lineafactura_180 WHERE factura_id = ${factura_id}`;
      let subtotal = 0, iva_total = 0;
      const iva_global = factura.iva_global || 0;
      for (const linea of lineas) {
        const descripcion = (linea.descripcion || "").trim();
        if (!descripcion) continue;
        const cantidad = parseFloat(linea.cantidad || 0);
        const precio_unitario = parseFloat(linea.precio_unitario || 0);
        const iva_pct = parseFloat(linea.iva || iva_global || 0);
        const base = cantidad * precio_unitario;
        const importe_iva = base * iva_pct / 100;
        subtotal += base;
        iva_total += importe_iva;
        await tx`
          INSERT INTO lineafactura_180 (factura_id, descripcion, cantidad, precio_unitario, total, iva_percent)
          VALUES (${factura_id}, ${descripcion}, ${cantidad}, ${precio_unitario}, ${base + importe_iva}, ${iva_pct})
        `;
      }
      await tx`
        UPDATE factura_180 SET subtotal = ${Math.round(subtotal * 100) / 100},
          iva_total = ${Math.round(iva_total * 100) / 100},
          total = ${Math.round((subtotal + iva_total) * 100) / 100}
        WHERE id = ${factura_id}
      `;
    }
  });

  return { success: true, mensaje: `Factura borrador #${factura_id} actualizada.` };
}

async function validarFactura({ factura_id }, empresaId) {
  const [factura] = await sql`SELECT * FROM factura_180 WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;
  if (!factura) return { error: "Factura no encontrada" };
  if (factura.estado !== "BORRADOR") return { error: "Solo se pueden validar facturas en borrador" };

  // Generar numero: F-YYYY-NNNN
  const year = new Date().getFullYear();
  const [max] = await sql`
    SELECT MAX(CAST(SUBSTRING(numero FROM '[0-9]+$') AS INTEGER)) as ultimo
    FROM factura_180 WHERE empresa_id = ${empresaId}
      AND estado IN ('VALIDADA', 'ANULADA')
      AND numero LIKE ${'F-' + year + '-%'}
  `;
  const siguiente = (Number(max?.ultimo) || 0) + 1;
  const numero = `F-${year}-${String(siguiente).padStart(4, '0')}`;

  await sql`
    UPDATE factura_180 SET estado = 'VALIDADA', numero = ${numero}, fecha = ${new Date().toISOString().split('T')[0]}::date
    WHERE id = ${factura_id} AND empresa_id = ${empresaId}
  `;

  return { success: true, mensaje: `Factura validada con numero ${numero}. Total: ${Number(factura.total).toFixed(2)} EUR.` };
}

async function anularFactura({ factura_id }, empresaId) {
  const [factura] = await sql`SELECT * FROM factura_180 WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;
  if (!factura) return { error: "Factura no encontrada" };
  if (factura.estado !== "VALIDADA") return { error: "Solo se pueden anular facturas validadas" };

  await sql`UPDATE factura_180 SET estado = 'ANULADA' WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;

  return { success: true, mensaje: `Factura ${factura.numero} anulada correctamente.` };
}

async function eliminarFacturaBorrador({ factura_id }, empresaId) {
  const [factura] = await sql`SELECT id, estado, total FROM factura_180 WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;
  if (!factura) return { error: "Factura no encontrada" };
  if (factura.estado !== "BORRADOR") return { error: "Solo se pueden eliminar facturas en borrador" };

  await sql.begin(async (tx) => {
    await tx`UPDATE work_logs_180 SET factura_id = NULL WHERE factura_id = ${factura_id} AND empresa_id = ${empresaId}`;
    await tx`DELETE FROM lineafactura_180 WHERE factura_id = ${factura_id}`;
    await tx`DELETE FROM factura_180 WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;
  });

  return { success: true, mensaje: `Factura borrador #${factura_id} eliminada.` };
}

async function enviarFacturaEmail({ factura_id, destinatario, asunto }, empresaId) {
  const [factura] = await sql`
    SELECT f.*, c.nombre as cliente_nombre FROM factura_180 f
    LEFT JOIN clients_180 c ON f.cliente_id = c.id
    WHERE f.id = ${factura_id} AND f.empresa_id = ${empresaId}
  `;
  if (!factura) return { error: "Factura no encontrada" };
  if (factura.estado !== "VALIDADA") return { error: "Solo se pueden enviar facturas validadas" };

  // Importar servicio de email dinamicamente
  try {
    const emailService = await import("./emailService.js");
    const { generarPdfFactura } = await import("./facturaPdfService.js");

    const pdfBuffer = await generarPdfFactura(factura_id, empresaId);
    const subject = asunto || `Factura ${factura.numero} - APP180`;

    await emailService.enviarEmail({
      empresaId,
      to: destinatario,
      subject,
      html: `<p>Adjunta encontrará la factura ${factura.numero}.</p>`,
      attachments: [{ filename: `Factura_${factura.numero}.pdf`, content: pdfBuffer }]
    });

    return { success: true, mensaje: `Factura ${factura.numero} enviada por email a ${destinatario}.` };
  } catch (err) {
    console.error("[AI] Error enviando email:", err);
    return { error: `Error enviando email: ${err.message}` };
  }
}

// ============================
// HERRAMIENTAS DE ESCRITURA - CLIENTES
// ============================

async function crearCliente({ nombre, email, telefono, nif_cif, direccion, notas }, empresaId) {
  // Generar codigo automatico
  const [seq] = await sql`
    SELECT last_num FROM cliente_seq_180 WHERE empresa_id = ${empresaId}
  `;
  let nextNum = 1;
  if (seq) {
    nextNum = (seq.last_num || 0) + 1;
    await sql`UPDATE cliente_seq_180 SET last_num = ${nextNum} WHERE empresa_id = ${empresaId}`;
  } else {
    await sql`INSERT INTO cliente_seq_180 (empresa_id, last_num) VALUES (${empresaId}, 1)`;
  }
  const codigo = `CLI-${String(nextNum).padStart(5, '0')}`;

  const [cliente] = await sql`
    INSERT INTO clients_180 (empresa_id, nombre, codigo, email, telefono, nif_cif, direccion, notas, activo)
    VALUES (${empresaId}, ${nombre}, ${codigo}, ${email || null}, ${telefono || null}, ${nif_cif || null}, ${direccion || null}, ${notas || null}, true)
    RETURNING id, nombre, codigo
  `;

  return { success: true, mensaje: `Cliente "${nombre}" creado con codigo ${codigo}.`, cliente: { id: cliente.id, nombre: cliente.nombre, codigo: cliente.codigo } };
}

async function actualizarCliente({ cliente_id, nombre, email, telefono, nif_cif, direccion, notas }, empresaId) {
  const [cliente] = await sql`SELECT id, nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  if (!cliente) return { error: "Cliente no encontrado" };

  const updates = {};
  if (nombre !== undefined) updates.nombre = nombre;
  if (email !== undefined) updates.email = email;
  if (telefono !== undefined) updates.telefono = telefono;
  if (nif_cif !== undefined) updates.nif_cif = nif_cif;
  if (direccion !== undefined) updates.direccion = direccion;
  if (notas !== undefined) updates.notas = notas;

  if (Object.keys(updates).length === 0) return { error: "No hay campos para actualizar" };

  await sql`
    UPDATE clients_180 SET
      nombre = COALESCE(${updates.nombre || null}, nombre),
      email = COALESCE(${updates.email || null}, email),
      telefono = COALESCE(${updates.telefono || null}, telefono),
      nif_cif = COALESCE(${updates.nif_cif || null}, nif_cif),
      direccion = COALESCE(${updates.direccion || null}, direccion),
      notas = COALESCE(${updates.notas || null}, notas)
    WHERE id = ${cliente_id} AND empresa_id = ${empresaId}
  `;

  return { success: true, mensaje: `Cliente "${cliente.nombre}" actualizado.` };
}

async function desactivarCliente({ cliente_id }, empresaId) {
  const [cliente] = await sql`SELECT nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  if (!cliente) return { error: "Cliente no encontrado" };
  await sql`UPDATE clients_180 SET activo = false WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  return { success: true, mensaje: `Cliente "${cliente.nombre}" desactivado.` };
}

// ============================
// HERRAMIENTAS DE ESCRITURA - PAGOS
// ============================

async function crearPago({ cliente_id, importe, metodo, fecha_pago, referencia }, empresaId) {
  const [cliente] = await sql`SELECT id, nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  if (!cliente) return { error: "Cliente no encontrado" };
  if (Number(importe) <= 0) return { error: "Importe debe ser mayor que 0" };

  const metodosValidos = ["transferencia", "efectivo", "tarjeta", "bizum", "otro"];
  if (!metodosValidos.includes(metodo)) return { error: `Metodo invalido. Usa: ${metodosValidos.join(', ')}` };

  const [pago] = await sql`
    INSERT INTO payments_180 (empresa_id, cliente_id, importe, metodo, fecha_pago, referencia)
    VALUES (${empresaId}, ${cliente_id}, ${importe}, ${metodo}, ${fecha_pago || new Date().toISOString().split('T')[0]}, ${referencia || null})
    RETURNING id
  `;

  return { success: true, mensaje: `Pago de ${Number(importe).toFixed(2)} EUR registrado para ${cliente.nombre}. ID: ${pago.id}. Metodo: ${metodo}.` };
}

async function eliminarPago({ pago_id }, empresaId) {
  const [pago] = await sql`SELECT id, importe, cliente_id FROM payments_180 WHERE id = ${pago_id} AND empresa_id = ${empresaId}`;
  if (!pago) return { error: "Pago no encontrado" };

  await sql.begin(async (tx) => {
    // Revertir imputaciones
    const allocations = await tx`SELECT * FROM payment_allocations_180 WHERE payment_id = ${pago_id} AND empresa_id = ${empresaId}`;
    for (const alloc of allocations) {
      if (alloc.factura_id) {
        await tx`
          UPDATE factura_180 SET pagado = GREATEST(0, COALESCE(pagado, 0) - ${alloc.importe}),
            estado_pago = CASE WHEN GREATEST(0, COALESCE(pagado, 0) - ${alloc.importe}) <= 0 THEN 'pendiente'
              WHEN GREATEST(0, COALESCE(pagado, 0) - ${alloc.importe}) < total THEN 'parcial' ELSE 'pagado' END
          WHERE id = ${alloc.factura_id} AND empresa_id = ${empresaId}
        `;
      }
    }
    await tx`DELETE FROM payment_allocations_180 WHERE payment_id = ${pago_id} AND empresa_id = ${empresaId}`;
    await tx`DELETE FROM payments_180 WHERE id = ${pago_id} AND empresa_id = ${empresaId}`;
  });

  return { success: true, mensaje: `Pago de ${Number(pago.importe).toFixed(2)} EUR eliminado y imputaciones revertidas.` };
}

// ============================
// HERRAMIENTAS DE ESCRITURA - EMPLEADOS
// ============================

async function actualizarEmpleado({ empleado_id, nombre, activo }, empresaId) {
  const [empleado] = await sql`SELECT id, nombre FROM employees_180 WHERE id = ${empleado_id} AND empresa_id = ${empresaId}`;
  if (!empleado) return { error: "Empleado no encontrado" };

  if (nombre !== undefined) {
    await sql`UPDATE employees_180 SET nombre = ${nombre} WHERE id = ${empleado_id} AND empresa_id = ${empresaId}`;
  }
  if (activo !== undefined) {
    await sql`UPDATE employees_180 SET activo = ${activo} WHERE id = ${empleado_id} AND empresa_id = ${empresaId}`;
  }

  return { success: true, mensaje: `Empleado "${empleado.nombre}" actualizado.` };
}

// ============================
// HERRAMIENTAS DE ESCRITURA - TRABAJOS
// ============================

async function crearTrabajo({ cliente_id, descripcion, fecha, minutos, precio }, empresaId) {
  const fechaTrabajo = fecha || new Date().toISOString().split('T')[0];
  const valor = precio || null;

  const insertData = {
    empresa_id: empresaId,
    descripcion,
    fecha: fechaTrabajo,
    minutos: minutos || 0,
    valor
  };

  let clienteNombre = null;
  if (cliente_id) {
    const [c] = await sql`SELECT id, nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
    if (!c) return { error: "Cliente no encontrado" };
    clienteNombre = c.nombre;
  }

  const [trabajo] = await sql`
    INSERT INTO work_logs_180 (empresa_id, cliente_id, descripcion, fecha, minutos, valor)
    VALUES (${empresaId}, ${cliente_id || null}, ${descripcion}, ${fechaTrabajo}::date, ${minutos || 0}, ${valor})
    RETURNING id
  `;

  return { success: true, mensaje: `Trabajo registrado${clienteNombre ? ` para ${clienteNombre}` : ''}. ${minutos} minutos. ID: ${trabajo.id}` };
}

// ============================
// HERRAMIENTAS DE ESCRITURA - AUSENCIAS
// ============================

async function crearAusencia({ empleado_id, tipo, fecha_inicio, fecha_fin, motivo }, empresaId) {
  const [empleado] = await sql`SELECT id, nombre FROM employees_180 WHERE id = ${empleado_id} AND empresa_id = ${empresaId}`;
  if (!empleado) return { error: "Empleado no encontrado" };

  const [ausencia] = await sql`
    INSERT INTO ausencias_180 (empresa_id, empleado_id, tipo, fecha_inicio, fecha_fin, motivo, estado)
    VALUES (${empresaId}, ${empleado_id}, ${tipo}, ${fecha_inicio}::date, ${fecha_fin}::date, ${motivo || null}, 'aprobada')
    RETURNING id
  `;

  const tipoLabel = { vacaciones: "Vacaciones", baja_medica: "Baja médica", asuntos_propios: "Asuntos propios", permiso: "Permiso" };
  return { success: true, mensaje: `${tipoLabel[tipo] || tipo} registrada para ${empleado.nombre} del ${fecha_inicio} al ${fecha_fin}. ID: ${ausencia.id}` };
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
// SYSTEM PROMPTS
// ============================

function buildSystemPrompt(userRole) {
  let prompt = `Eres CONTENDO, el asistente inteligente de APP180, una plataforma de gestión empresarial. Responde siempre en español, de forma natural y profesional.

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
- Crear facturas en borrador, actualizar y validar facturas
- Crear y gestionar clientes
- Registrar pagos/cobros
- Registrar trabajos (work logs)
- Crear ausencias para empleados
- Crear y eliminar eventos del calendario

CUÁNDO USAR HERRAMIENTAS DE CONSULTA:
- Preguntas sobre facturas → consultar_facturas o estadisticas_facturacion
- Preguntas sobre empleados → consultar_empleados
- Preguntas sobre clientes → consultar_clientes
- Preguntas sobre calendario, festivos, cierres → consultar_calendario
- Preguntas sobre ausencias, vacaciones, bajas → consultar_ausencias
- Preguntas sobre trabajos sin facturar → trabajos_pendientes_facturar
- Información de la empresa o procedimientos → consultar_conocimiento

CUÁNDO USAR HERRAMIENTAS DE ESCRITURA:
- "Crea una factura para X" → primero consultar_clientes para obtener el ID, luego crear_factura
- "Registra un pago" → primero consultar_clientes, luego crear_pago
- "Crea un cliente nuevo" → crear_cliente
- "Registra un trabajo" → crear_trabajo
- "Pon vacaciones a X" → primero consultar_empleados para el ID, luego crear_ausencia
- "Valida la factura X" → validar_factura
- "Anula la factura X" → anular_factura

CUÁNDO NO USAR HERRAMIENTAS (responde directamente):
- Saludos y despedidas
- Agradecimientos
- Preguntas sobre qué puedes hacer o cómo funcionas
- Conversación casual

REGLAS DE DATOS:
1. NUNCA inventes datos, cifras, nombres o importes. Solo responde con lo que devuelvan las herramientas.
2. Si una herramienta devuelve total: 0 o lista vacía, di claramente: "No hay [tipo de dato] registrados actualmente."
3. Si la pregunta es ambigua, pregunta al usuario qué necesita exactamente.
4. Para acciones de escritura, SIEMPRE consulta primero los datos necesarios (ID de cliente, ID de empleado, etc.) antes de crear.

ESTADOS DE FACTURA:
- Emisión: VALIDADA, BORRADOR, ANULADA
- Cobro: pendiente, parcial, pagado
- "Pendientes de cobro" = estado_pago="pendiente"

El usuario es ${userRole === 'admin' ? 'administrador con acceso completo' : 'empleado'}.

FORMATO: Usa Markdown. Importes en € con 2 decimales. Fechas en formato DD/MM/YYYY.`;

  return prompt;
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
      { role: "system", content: buildSystemPrompt(userRole) },
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
      const fallback = await consultarConocimiento({ busqueda: mensaje }, empresaId);
      if (fallback.respuesta_directa) {
        return { mensaje: fallback.respuesta_directa };
      }
      return { mensaje: "No pude procesar tu mensaje." };
    }

    // Procesar tool calls (máximo 3 iteraciones)
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
