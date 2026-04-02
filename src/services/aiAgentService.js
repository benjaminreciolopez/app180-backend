import Anthropic from "@anthropic-ai/sdk";
import { sql } from "../db.js";
import { getCalendarConfig } from "./googleCalendarService.js";
import { syncToGoogle, syncFromGoogle, syncBidirectional } from "./calendarSyncService.js";
import { createGoogleEvent, app180ToGoogleEvent } from "./googleCalendarService.js";
import { analyzeCurrentQuarter, simulateImpact } from "./fiscalAlertService.js";
import { TOOLS } from "./ai/toolDefinitions.js";
import { buildSystemPrompt } from "./ai/systemPrompt.js";
import { createMCPTracker } from "./mcp-ai-tracker.js";

const mcpTracker = createMCPTracker({ sql, appId: 'app180' });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ""
});

/**
 * Convierte tools del formato OpenAI/Groq al formato Anthropic
 */
function convertToolsToAnthropic(tools) {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters || { type: "object", properties: {} }
  }));
}

const ANTHROPIC_TOOLS = null; // Se inicializa lazy

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

/**
 * Parsea una tool call fallida de Groq (error tool_use_failed)
 * y coerce los tipos string→number según el schema de la herramienta.
 * Devuelve { name, args } o null si no se puede recuperar.
 */
function parseFailedGeneration(errorMessage) {
  try {
    const jsonStr = errorMessage.replace(/^\d+\s*/, '');
    const errorBody = JSON.parse(jsonStr);
    const failedGen = errorBody?.error?.failed_generation;
    if (!failedGen || errorBody?.error?.code !== 'tool_use_failed') return null;

    const match = failedGen.match(/<function=(\w+)>\s*(\{[\s\S]*?\})\s*<\/function>/);
    if (!match) return null;

    const [, name, argsJson] = match;
    const args = JSON.parse(argsJson);

    const tool = TOOLS.find(t => t.function.name === name);
    if (tool) {
      const props = tool.function.parameters.properties || {};
      for (const [key, schema] of Object.entries(props)) {
        if (schema.type === 'number' && typeof args[key] === 'string') {
          const num = Number(args[key]);
          if (!isNaN(num)) args[key] = num;
        }
      }
    }

    for (const [key, val] of Object.entries(args)) {
      if (key.endsWith('_id') && typeof val === 'string' && !UUID_RE.test(val) && !INT_RE.test(val)) {
        console.warn(`[AI] Argumento placeholder o nombre detectado en campo ID: ${key}="${val}" - se intentará resolver`);
        // Si el valor no es un ID válido, lo tratamos como un nombre para intentar resolverlo
        const baseKey = key.replace('_id', '');
        args[`nombre_${baseKey}`] = val;
        delete args[key];
      }
    }

    return { name, args };
  } catch {
    return null;
  }
}

/**
 * Resuelve nombre_cliente → cliente_id y nombre_empleado → empleado_id
 * buscando en la BD por coincidencia parcial (ILIKE).
 */
async function resolveIds(args, empresaId) {
  // Rechazar nombres genéricos antes de buscar en BD
  const GENERIC_NAME_RE = /^(nombre|cliente|empleado|el cliente|la empresa|usuario|persona|test|ejemplo|prueba)/i;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Si cliente_id viene con un nombre (no UUID), moverlo a nombre_cliente
  if (args.cliente_id && typeof args.cliente_id === 'string' && !UUID_RE.test(args.cliente_id) && !/^\d+$/.test(args.cliente_id)) {
    args.nombre_cliente = args.cliente_id;
    delete args.cliente_id;
  }
  // Lo mismo para empleado_id
  if (args.empleado_id && typeof args.empleado_id === 'string' && !UUID_RE.test(args.empleado_id) && !/^\d+$/.test(args.empleado_id)) {
    args.nombre_empleado = args.empleado_id;
    delete args.empleado_id;
  }

  if (args.nombre_cliente && GENERIC_NAME_RE.test(args.nombre_cliente.trim())) {
    return { error: `"${args.nombre_cliente}" no es un nombre real de cliente. Pregunta al usuario el nombre específico.` };
  }
  if (args.nombre_empleado && GENERIC_NAME_RE.test(args.nombre_empleado.trim())) {
    return { error: `"${args.nombre_empleado}" no es un nombre real de empleado. Pregunta al usuario el nombre específico.` };
  }

  if (args.nombre_cliente && !args.cliente_id) {
    const clientes = await sql`
      SELECT id, nombre FROM clients_180
      WHERE empresa_id = ${empresaId} AND activo = true
        AND nombre ILIKE ${'%' + args.nombre_cliente + '%'}
      LIMIT 5
    `;
    if (clientes.length === 1) {
      args.cliente_id = clientes[0].id;
      console.log(`[AI] Resuelto cliente: "${args.nombre_cliente}" → ${args.cliente_id} (${clientes[0].nombre})`);
    } else if (clientes.length > 1) {
      return { error: `Se encontraron ${clientes.length} clientes con "${args.nombre_cliente}": ${clientes.map(c => c.nombre).join(', ')}. Especifica cuál.` };
    } else {
      return { error: `No se encontró ningún cliente activo con el nombre "${args.nombre_cliente}".` };
    }
    delete args.nombre_cliente;
  }
  if (args.nombre_empleado && !args.empleado_id) {
    const empleados = await sql`
      SELECT id, nombre FROM empleados_180
      WHERE empresa_id = ${empresaId} AND activo = true
        AND nombre ILIKE ${'%' + args.nombre_empleado + '%'}
      LIMIT 5
    `;
    if (empleados.length === 1) {
      args.empleado_id = empleados[0].id;
      console.log(`[AI] Resuelto empleado: "${args.nombre_empleado}" → ${args.empleado_id} (${empleados[0].nombre})`);
    } else if (empleados.length > 1) {
      return { error: `Se encontraron ${empleados.length} empleados con "${args.nombre_empleado}": ${empleados.map(e => e.nombre).join(', ')}. Especifica cuál.` };
    } else {
      return { error: `No se encontró ningún empleado activo con el nombre "${args.nombre_empleado}".` };
    }
    delete args.nombre_empleado;
  }
  return null;
}

/**
 * Meta-herramienta: devuelve los requisitos de una acción en lenguaje natural.
 */
function consultarRequisitos({ accion }) {
  const tool = TOOLS.find(t => t.function.name === accion);
  if (!tool) return { error: `Herramienta "${accion}" no encontrada.` };

  const params = tool.function.parameters;
  const props = params.properties || {};
  const required = params.required || [];

  const campos = Object.entries(props).map(([key, schema]) => {
    const obligatorio = required.includes(key);
    const desc = schema.description || key;
    const tipo = schema.type === 'array' ? 'lista' : schema.type === 'number' ? 'número' : schema.type;
    const opciones = schema.enum ? ` (opciones: ${schema.enum.join(', ')})` : '';
    return `- **${key}** (${tipo}${obligatorio ? ', OBLIGATORIO' : ', opcional'}): ${desc}${opciones}`;
  });

  return {
    herramienta: accion,
    descripcion: tool.function.description,
    parametros: campos.join('\n'),
    nota: "Pide al usuario los datos obligatorios antes de ejecutar la acción. Puedes usar nombre_cliente o nombre_empleado en vez de IDs."
  };
}

/**
 * Detecta valores placeholder/genéricos en los argumentos.
 * Devuelve un mensaje de error si detecta placeholders, o null si todo ok.
 */
function detectPlaceholders(args, nombreHerramienta) {
  const PLACEHOLDER_PATTERNS = [
    /^nombre\s+del?\s+(cliente|empleado|empresa|usuario)/i,
    /^id\s+del?\s+(cliente|empleado|factura|pago)/i,
    /^datos?\s+del?\s/i,
    /^(el|la|los|las|un|una)\s+(cliente|empleado|nombre|id|factura)/i,
    /^<[^>]+>$/,  // <valor>
    /^\[.+\]$/,   // [valor]
    /^{.+}$/,     // {valor}
    /^(ejemplo|test|prueba|sample|placeholder|xxx|yyy|zzz)$/i,
    /^(tu|su|mi)\s+(nombre|cliente|id)/i,
    /^aqui\s+(va|el|la)/i,
    /^insertar?\s/i,
    /^completar?\s/i,
  ];

  for (const [key, val] of Object.entries(args)) {
    if (typeof val !== 'string') continue;
    const trimmed = val.trim();
    if (!trimmed) continue;

    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(trimmed)) {
        console.warn(`[AI] Placeholder detectado en ${nombreHerramienta}: ${key}="${val}"`);
        return {
          error: `El parámetro "${key}" contiene un valor genérico ("${val}"). Necesito el dato real del usuario. Pregúntale directamente.`,
          sugerencia: `Pregunta al usuario: ¿Cuál es el ${key.replace(/_/g, ' ')} que quieres usar?`
        };
      }
    }
  }

  return null;
}

async function ejecutarHerramienta(nombreHerramienta, argumentos, empresaId, userId = null) {
  const args = coerceBooleans(argumentos);

  // Human-in-the-loop: pausa y devuelve sentinel al loop principal
  if (nombreHerramienta === 'solicitar_aclaracion') {
    return {
      __tipo: "clarification",
      pregunta: argumentos.pregunta,
      opciones: argumentos.opciones || [],
      contexto: argumentos.contexto || ""
    };
  }

  // Meta-herramienta: consultar requisitos (no necesita validación)
  if (nombreHerramienta === 'consultar_requisitos') {
    return consultarRequisitos(args);
  }

  // 🛡️ Detectar placeholders ANTES de ejecutar
  const placeholderError = detectPlaceholders(args, nombreHerramienta);
  if (placeholderError) {
    return placeholderError;
  }

  // Resolver nombres → IDs automáticamente
  const resolveError = await resolveIds(args, empresaId);
  if (resolveError) {
    console.log(`[AI] Error resolviendo IDs para ${nombreHerramienta}:`, resolveError);
    return resolveError;
  }

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
      case "consultar_historial_trabajos": return await consultarHistorialTrabajos(args, empresaId);
      case "marcar_trabajo_cobrado": return await marcarTrabajoCobrado(args, empresaId);
      // Gastos
      case "registrar_gasto": return await registrarGasto(args, empresaId);
      case "registrar_factura_existente": return await registrarFacturaExistente(args, empresaId);
      // Análisis Avanzado
      case "consultar_resumen_financiero": return await consultarResumenFinanciero(args, empresaId);
      // Ausencias
      case "crear_ausencia": return await crearAusencia(args, empresaId);
      // Nuevos skills: Analytics financiero
      case "top_clientes": return await topClientes(args, empresaId);
      case "resumen_ejecutivo": return await resumenEjecutivo(args, empresaId);
      case "consultar_deuda": return await consultarDeuda(args, empresaId);
      case "consultar_pagos": return await consultarPagos(args, empresaId);
      case "comparar_periodos": return await compararPeriodos(args, empresaId);
      case "tendencia_facturacion": return await tendenciaFacturacion(args, empresaId);
      case "clientes_en_riesgo": return await clientesEnRiesgo(args, empresaId);
      case "alertas_negocio": return await alertasNegocio(args, empresaId);
      // Nuevos skills: RRHH
      case "consultar_fichajes": return await consultarFichajes(args, empresaId);
      case "resumen_horas_empleado": return await resumenHorasEmpleado(args, empresaId);
      case "consultar_ausencias_resumen": return await consultarAusenciasResumen(args, empresaId);
      case "productividad_empleado": return await productividadEmpleado(args, empresaId);
      // Nuevos skills: Automatización
      case "facturar_trabajos_pendientes": return await facturarTrabajosPendientes(args, empresaId);
      case "cierre_mensual": return await cierreMensual(args, empresaId);
      // Fichajes
      case "consultar_fichajes_sospechosos": return await consultarFichajesSospechosos(args, empresaId);
      case "crear_fichaje_manual": return await crearFichajeManual(args, empresaId);
      case "validar_fichaje": return await validarFichajeIA(args, empresaId);
      // Jornadas
      case "consultar_jornadas": return await consultarJornadas(args, empresaId);
      // Plantillas
      case "consultar_plantillas": return await consultarPlantillas(args, empresaId);
      case "crear_plantilla": return await crearPlantillaIA(args, empresaId);
      case "asignar_plantilla": return await asignarPlantillaIA(args, empresaId);
      // Nóminas
      case "consultar_nominas": return await consultarNominas(args, empresaId);
      case "crear_nomina": return await crearNominaIA(args, empresaId);
      // Partes de día
      case "consultar_partes_dia": return await consultarPartesDia(args, empresaId);
      case "validar_parte_dia": return await validarParteDiaIA(args, empresaId);
      // Knowledge Base
      case "crear_conocimiento": return await crearConocimientoIA(args, empresaId);
      case "actualizar_conocimiento": return await actualizarConocimientoIA(args, empresaId);
      case "eliminar_conocimiento": return await eliminarConocimientoIA(args, empresaId);
      // Configuración
      case "consultar_configuracion": return await consultarConfiguracion(args, empresaId);
      case "consultar_modulos": return await consultarModulos(args, empresaId);
      // Sugerencias
      case "consultar_sugerencias": return await consultarSugerenciasIA(args, empresaId, userId);
      case "responder_sugerencia": return await responderSugerenciaIA(args, empresaId, userId);
      // Storage
      case "listar_archivos": return await listarArchivos(args, empresaId);
      // Auditoría
      case "consultar_audit_log": return await consultarAuditLog(args, empresaId);
      case "consultar_estadisticas_audit": return await consultarEstadisticasAudit(args, empresaId);
      // Reportes avanzados
      case "reporte_rentabilidad": return await reporteRentabilidad(args, empresaId);
      // Fiscal
      case "calcular_modelo_fiscal": return await calcularModeloFiscal(args, empresaId);
      // Banco
      case "consultar_movimientos_banco": return await consultarMovimientosBanco(args, empresaId);
      case "match_pago_banco": return await matchPagoBanco(args, empresaId);
      case "sugerir_matches_banco": return await sugerirMatchesBanco(args, empresaId);
      // Configuración fiscal QR
      case "configurar_facturacion_qr": return await configurarFacturacionQR(args, empresaId);
      // FASE 2 adicionales
      case "crear_excepcion_jornada": return await crearExcepcionJornada(args, empresaId);
      case "actualizar_configuracion": return await actualizarConfiguracion(args, empresaId);
      case "eliminar_archivo": return await eliminarArchivo(args, empresaId);
      case "exportar_modulo": return await exportarModulo(args, empresaId);
      case "reporte_desviacion": return await reporteDesviacion(args, empresaId);
      // FASE 3 fiscales
      case "consultar_modelos_fiscales": return await consultarModelosFiscales(args, empresaId);
      case "consultar_libro_ventas": return await consultarLibroVentas(args, empresaId);
      case "consultar_libro_gastos": return await consultarLibroGastos(args, empresaId);
      case "consultar_libro_nominas": return await consultarLibroNominas(args, empresaId);
      case "alertas_fiscales": return await alertasFiscales(args, empresaId);
      // Declaración de la Renta
      case "consultar_renta_historica": return await consultarRentaHistorica(args, empresaId);
      case "consultar_datos_personales_renta": return await consultarDatosPersonalesRenta(args, empresaId);
      case "generar_dossier_prerenta": return await generarDossierPrerenta(args, empresaId);
      // FASE 4 reconciliación
      case "reconciliar_extracto": return await reconciliarExtracto(args, empresaId);
      // Certificados digitales (VeriFactu)
      case "verificar_certificado_renovacion": return await verificarCertificadoRenovacion(empresaId);
      case "obtener_instrucciones_renovacion": return await obtenerInstruccionesRenovacion(args, empresaId);
      // Asesoría
      case "consultar_asesoria_estado": return await consultarAsesoriaEstado(empresaId);
      case "enviar_mensaje_asesoria": return await enviarMensajeAsesoria(args, empresaId, userId);
      case "listar_mensajes_asesoria": return await listarMensajesAsesoria(args, empresaId);
      case "exportar_para_asesoria": return await exportarParaAsesoria(args, empresaId);
      // Contabilidad
      case "crear_asiento_contable": return await crearAsientoContable(args, empresaId, userId);
      case "generar_asientos_periodo": return await generarAsientosPeriodo(args, empresaId, userId);
      case "consultar_balance": return await consultarBalance(args, empresaId);
      case "consultar_pyg": return await consultarPyG(args, empresaId);
      case "consultar_libro_mayor": return await consultarLibroMayor(args, empresaId);
      case "revisar_cuentas_asientos": return await revisarCuentasAsientosIA(args, empresaId);
      // Proformas
      case "crear_proforma": return await crearProformaIA(args, empresaId);
      case "anular_proforma": return await anularProformaIA(args, empresaId);
      case "reactivar_proforma": return await reactivarProformaIA(args, empresaId);
      case "enviar_nomina": return await enviarNominaIA(args, empresaId);
      case "consultar_entregas_nominas": return await consultarEntregasNominasIA(args, empresaId);
      // Inteligencia fiscal
      case "analizar_riesgo_fiscal": return await analizarRiesgoFiscalIA(args, empresaId);
      case "simular_impacto_fiscal": return await simularImpactoFiscalIA(args, empresaId);
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
    WHERE w.empresa_id = ${empresaId} AND w.factura_id IS NULL AND COALESCE(w.estado_pago, 'pendiente') != 'pagado'
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

async function crearFactura({ cliente_id, fecha, lineas, iva_global = 0, tipo_factura = 'NORMAL' }, empresaId) {
  const [cliente] = await sql`SELECT id, nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  if (!cliente) return { error: "Cliente no encontrado" };
  if (!Array.isArray(lineas) || lineas.length === 0) return { error: "Debe incluir al menos una linea" };

  let createdId;
  let total;
  const tipoTexto = tipo_factura === 'PROFORMA' ? ' PROFORMA' : '';
  await sql.begin(async (tx) => {
    let subtotal = 0;
    let iva_total = 0;
    const [factura] = await tx`
      INSERT INTO factura_180 (empresa_id, cliente_id, fecha, estado, iva_global, tipo_factura, subtotal, iva_total, total, created_at)
      VALUES (${empresaId}, ${cliente_id}, ${fecha}::date, 'BORRADOR', ${iva_global || 0}, ${tipo_factura}, 0, 0, 0, now())
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

  return { success: true, mensaje: `Factura${tipoTexto} borrador creada para ${cliente.nombre}. Total: ${total.toFixed(2)} EUR. ID: ${createdId}${tipo_factura === 'PROFORMA' ? ' (No consumirá numeración oficial)' : ''}`, factura: { id: createdId, cliente: cliente.nombre, total, estado: "BORRADOR", tipo: tipo_factura } };
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
    await tx`UPDATE factura_180 SET deleted_at = NOW() WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;
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

async function crearTrabajo({ cliente_id, descripcion, concepto_facturacion, detalles, fecha, horas, minutos, precio }, empresaId) {
  const fechaTrabajo = fecha || new Date().toISOString().split('T')[0];
  const valor = precio || null;
  // Aceptar horas como alternativa a minutos
  const totalMinutos = minutos || (horas ? Math.round(horas * 60) : 0);

  let clienteNombre = null;
  if (cliente_id) {
    const [c] = await sql`SELECT id, nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
    if (!c) return { error: "Cliente no encontrado" };
    clienteNombre = c.nombre;
  }

  const [trabajo] = await sql`
    INSERT INTO work_logs_180 (empresa_id, cliente_id, descripcion, concepto_facturacion, detalles, fecha, minutos, valor)
    VALUES (${empresaId}, ${cliente_id || null}, ${descripcion}, ${concepto_facturacion || null}, ${detalles || null}, ${fechaTrabajo}::date, ${totalMinutos}, ${valor})
    RETURNING id
  `;

  const horasDisplay = totalMinutos >= 60 ? `${Math.floor(totalMinutos / 60)}h ${totalMinutos % 60 > 0 ? `${totalMinutos % 60}min` : ''}` : `${totalMinutos} min`;
  return { success: true, mensaje: `Trabajo registrado${clienteNombre ? ` para ${clienteNombre}` : ''}. Duración: ${horasDisplay.trim()}. Fecha: ${fechaTrabajo}. ID: ${trabajo.id}` };
}

async function consultarHistorialTrabajos({ cliente_id, limite = 5 }, empresaId) {
  if (!cliente_id) return { error: "ID del cliente es necesario para consultar el historial." };

  const limitNum = parseInt(String(limite)) || 5;

  const trabajos = await sql`
    SELECT id, fecha, descripcion, concepto_facturacion, detalles
    FROM work_logs_180
    WHERE empresa_id = ${empresaId} AND cliente_id = ${cliente_id}
    ORDER BY fecha DESC, created_at DESC
    LIMIT ${limitNum}
  `;

  if (trabajos.length === 0) return { mensaje: "No hay trabajos registrados anteriormente para este cliente." };

  return {
    total: trabajos.length,
    trabajos: trabajos.map(t => ({
      id: t.id,
      fecha: t.fecha,
      trabajo: t.descripcion,
      concepto_corto: t.concepto_facturacion || "No indicado",
      detalles: t.detalles || ""
    })),
    instruccion: "Muestra esta tabla al usuario y pregúntale si quiere usar uno de estos como base o prefiere registrar un TRABAJO NUEVO."
  };
}

async function marcarTrabajoCobrado({ trabajo_id, metodo_pago }, empresaId) {
  const [trabajo] = await sql`
    UPDATE work_logs_180
    SET estado_pago = 'pagado', 
        metodo_pago_directo = ${metodo_pago || 'efectivo'},
        pagado_at = NOW()
    WHERE id = ${trabajo_id} AND empresa_id = ${empresaId}
    RETURNING id, descripcion
  `;
  if (!trabajo) return { error: "Trabajo no encontrado." };
  return { success: true, mensaje: `Trabajo "${trabajo.descripcion}" marcado como COBRADO DIRECTAMENTE.` };
}

// ============================
// HERRAMIENTAS DE ESCRITURA - GASTOS
// ============================

async function registrarGasto({ proveedor, descripcion, total, base_imponible, iva_importe, iva_porcentaje, fecha, categoria, metodo_pago }, empresaId) {
  const fechaGasto = fecha || new Date().toISOString().split('T')[0];
  const [gasto] = await sql`
    INSERT INTO purchases_180 (
      empresa_id, proveedor, descripcion, total, base_imponible, 
      iva_importe, iva_porcentaje, fecha_compra, categoria, metodo_pago, activo
    ) VALUES (
      ${empresaId}, ${proveedor || null}, ${descripcion}, ${total}, 
      ${base_imponible || total}, ${iva_importe || 0}, ${iva_porcentaje || 0}, 
      ${fechaGasto}, ${categoria || 'general'}, ${metodo_pago || 'otro'}, true
    ) RETURNING id
  `;
  return { success: true, mensaje: `Gasto registrado: "${descripcion}" por un total de ${total}€. ID: ${gasto.id}` };
}

async function registrarFacturaExistente({ numero_factura, nombre_cliente, fecha_emision, total, estado_pago }, empresaId) {
  const fecha = fecha_emision || new Date().toISOString().split('T')[0];

  // Buscar cliente
  const [cliente] = await sql`
    SELECT id FROM clients_180 WHERE nombre ILIKE ${'%' + nombre_cliente + '%'} AND empresa_id = ${empresaId} LIMIT 1
  `;
  if (!cliente) return { error: `No se encontró al cliente "${nombre_cliente}".` };

  const [idExistente] = await sql`
    SELECT id FROM invoices_180 WHERE numero_factura = ${numero_factura} AND empresa_id = ${empresaId}
  `;
  if (idExistente) return { error: `La factura ${numero_factura} ya está registrada.` };

  const [factura] = await sql`
    INSERT INTO invoices_180 (
      empresa_id, numero_factura, cliente_id, fecha_emision, total, estado_pago, estado_emision, activo
    ) VALUES (
      ${empresaId}, ${numero_factura}, ${cliente.id}, ${fecha}, ${total}, 
      ${estado_pago || 'pendiente'}, 'VALIDADA', true
    ) RETURNING id
  `;

  return { success: true, mensaje: `Factura ${numero_factura} recuperada con éxito. ID: ${factura.id}` };
}

// ============================
// HERRAMIENTAS DE ANÁLISIS AVANZADO
// ============================

async function consultarResumenFinanciero({ periodo = 'mes_actual' }, empresaId) {
  let startDate, endDate;
  const now = new Date();

  if (periodo === 'mes_actual') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (periodo === 'mes_anterior') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0);
  } else {
    startDate = new Date(now.getFullYear(), 0, 1);
    endDate = new Date(now.getFullYear(), 11, 31);
  }

  // 1. Ingresos por Facturas (Pagadas o Parcialmente)
  const [ingresosFacturas] = await sql`
    SELECT COALESCE(SUM(total), 0) as total
    FROM invoices_180
    WHERE empresa_id = ${empresaId} 
      AND fecha_emision BETWEEN ${startDate} AND ${endDate}
      AND estado_pago IN ('pagado', 'parcial')
  `;

  // 2. Ingresos por Cobros Directos (Trabajos pagados sin factura)
  const [ingresosDirectos] = await sql`
    SELECT COALESCE(SUM(valor), 0) as total
    FROM work_logs_180
    WHERE empresa_id = ${empresaId}
      AND pagado_at BETWEEN ${startDate} AND ${endDate}
      AND estado_pago = 'pagado'
  `;

  // 3. Gastos
  const [gastos] = await sql`
    SELECT COALESCE(SUM(total), 0) as total
    FROM purchases_180
    WHERE empresa_id = ${empresaId}
      AND fecha_compra BETWEEN ${startDate} AND ${endDate}
      AND activo = true
  `;

  const totalIngresos = Number(ingresosFacturas.total) + Number(ingresosDirectos.total);
  const totalGastos = Number(gastos.total);
  const beneficio = totalIngresos - totalGastos;

  return {
    periodo: `${startDate.toLocaleDateString()} al ${endDate.toLocaleDateString()}`,
    ingresos: {
      facturados: Number(ingresosFacturas.total),
      cobros_directos: Number(ingresosDirectos.total),
      total: totalIngresos
    },
    gastos: totalGastos,
    beneficio_neto: beneficio,
    mensaje: beneficio >= 0 ? "El negocio está en positivo." : "Atención: Los gastos superan a los ingresos en este periodo."
  };
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
// NUEVOS SKILLS: ANALYTICS FINANCIERO
// ============================

async function topClientes({ limite = 5, periodo = "todo", criterio = "facturado" }, empresaId) {
  const now = new Date();
  let dateFilter = sql``;
  if (periodo === "mes") {
    dateFilter = sql`AND EXTRACT(MONTH FROM f.fecha) = ${now.getMonth() + 1} AND EXTRACT(YEAR FROM f.fecha) = ${now.getFullYear()}`;
  } else if (periodo === "trimestre") {
    const trimStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    dateFilter = sql`AND f.fecha >= ${trimStart.toISOString().split('T')[0]}`;
  } else if (periodo === "anio") {
    dateFilter = sql`AND EXTRACT(YEAR FROM f.fecha) = ${now.getFullYear()}`;
  }

  const orderCol = criterio === "pendiente" ? "total_pendiente" : criterio === "pagado" ? "total_cobrado" : "total_facturado";

  const rows = await sql`
    SELECT c.id, c.nombre,
      COALESCE(SUM(f.total), 0) as total_facturado,
      COALESCE(SUM(f.pagado), 0) as total_cobrado,
      COALESCE(SUM(f.total - COALESCE(f.pagado, 0)), 0) as total_pendiente,
      COUNT(f.id) as num_facturas
    FROM clients_180 c
    LEFT JOIN factura_180 f ON f.cliente_id = c.id AND f.empresa_id = ${empresaId} AND f.estado = 'VALIDADA' ${dateFilter}
    WHERE c.empresa_id = ${empresaId} AND c.activo = true
    GROUP BY c.id, c.nombre
    HAVING COALESCE(SUM(f.total), 0) > 0
    ORDER BY ${sql(orderCol)} DESC
    LIMIT ${limite}
  `;

  return {
    periodo, criterio, total_clientes: rows.length,
    ranking: rows.map((r, i) => ({
      posicion: i + 1, nombre: r.nombre, total_facturado: Number(r.total_facturado),
      total_cobrado: Number(r.total_cobrado), total_pendiente: Number(r.total_pendiente),
      num_facturas: Number(r.num_facturas)
    }))
  };
}

async function resumenEjecutivo(_args, empresaId) {
  const now = new Date();
  const mesActual = now.getMonth() + 1;
  const anioActual = now.getFullYear();

  const [stats] = await sql`
    SELECT
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN total ELSE 0 END), 0) as total_facturado,
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN COALESCE(pagado, 0) ELSE 0 END), 0) as total_cobrado,
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN total - COALESCE(pagado, 0) ELSE 0 END), 0) as total_pendiente,
      COUNT(CASE WHEN estado = 'VALIDADA' THEN 1 END) as facturas_validadas,
      COUNT(CASE WHEN estado = 'BORRADOR' THEN 1 END) as facturas_borrador
    FROM factura_180
    WHERE empresa_id = ${empresaId}
      AND EXTRACT(MONTH FROM fecha) = ${mesActual} AND EXTRACT(YEAR FROM fecha) = ${anioActual}
  `;

  const [clientes] = await sql`SELECT COUNT(*) as total FROM clients_180 WHERE empresa_id = ${empresaId} AND activo = true`;
  const [empleados] = await sql`SELECT COUNT(*) as total FROM employees_180 WHERE empresa_id = ${empresaId} AND activo = true`;
  const [trabajosPend] = await sql`SELECT COUNT(*) as total, COALESCE(SUM(valor), 0) as valor FROM work_logs_180 WHERE empresa_id = ${empresaId} AND factura_id IS NULL AND COALESCE(estado_pago, 'pendiente') != 'pagado'`;

  const [vencidas] = await sql`
    SELECT COUNT(*) as total, COALESCE(SUM(total - COALESCE(pagado, 0)), 0) as importe
    FROM factura_180 WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
      AND COALESCE(estado_pago, 'pendiente') != 'pagado' AND fecha < NOW() - INTERVAL '30 days'
  `;

  return {
    periodo: `${mesActual}/${anioActual}`,
    facturacion: {
      total_facturado: Number(stats.total_facturado), total_cobrado: Number(stats.total_cobrado),
      total_pendiente: Number(stats.total_pendiente), facturas_validadas: Number(stats.facturas_validadas),
      facturas_borrador: Number(stats.facturas_borrador)
    },
    empresa: { clientes_activos: Number(clientes.total), empleados_activos: Number(empleados.total) },
    pendientes: {
      trabajos_sin_facturar: Number(trabajosPend.total), valor_sin_facturar: Number(trabajosPend.valor),
      facturas_vencidas: Number(vencidas.total), importe_vencido: Number(vencidas.importe)
    }
  };
}

async function consultarDeuda({ dias_vencido = 30, cliente_id }, empresaId) {
  let query = sql`
    SELECT f.id, f.numero, f.fecha, f.total, COALESCE(f.pagado, 0) as pagado,
      f.total - COALESCE(f.pagado, 0) as saldo, c.nombre as cliente_nombre, c.email,
      EXTRACT(DAY FROM NOW() - f.fecha)::int as dias_antiguedad
    FROM factura_180 f
    LEFT JOIN clients_180 c ON f.cliente_id = c.id
    WHERE f.empresa_id = ${empresaId} AND f.estado = 'VALIDADA'
      AND COALESCE(f.estado_pago, 'pendiente') != 'pagado'
      AND f.fecha < NOW() - INTERVAL '1 day' * ${dias_vencido}
  `;
  if (cliente_id) query = sql`${query} AND f.cliente_id = ${cliente_id}`;
  query = sql`${query} ORDER BY f.fecha ASC LIMIT 30`;

  const deudas = await query;
  const totalDeuda = deudas.reduce((sum, d) => sum + Number(d.saldo), 0);

  return {
    total_facturas_vencidas: deudas.length, total_deuda: totalDeuda,
    dias_minimo: dias_vencido,
    deudas: deudas.map(d => ({
      factura: d.numero || `Borrador #${d.id}`, fecha: d.fecha, cliente: d.cliente_nombre,
      total: Number(d.total), pagado: Number(d.pagado), saldo: Number(d.saldo),
      dias_antiguedad: d.dias_antiguedad
    }))
  };
}

async function consultarPagos({ cliente_id, fecha_desde, fecha_hasta, limite = 20 }, empresaId) {
  let query = sql`
    SELECT p.id, p.importe, p.metodo, p.fecha_pago, p.referencia, c.nombre as cliente_nombre
    FROM payments_180 p
    LEFT JOIN clients_180 c ON p.cliente_id = c.id
    WHERE p.empresa_id = ${empresaId}
  `;
  if (cliente_id) query = sql`${query} AND p.cliente_id = ${cliente_id}`;
  if (fecha_desde) query = sql`${query} AND p.fecha_pago >= ${fecha_desde}`;
  if (fecha_hasta) query = sql`${query} AND p.fecha_pago <= ${fecha_hasta}`;
  query = sql`${query} ORDER BY p.fecha_pago DESC LIMIT ${limite}`;

  const pagos = await query;
  const totalImporte = pagos.reduce((sum, p) => sum + Number(p.importe), 0);

  return {
    total_pagos: pagos.length, total_importe: totalImporte,
    pagos: pagos.map(p => ({
      id: p.id, cliente: p.cliente_nombre, importe: Number(p.importe),
      metodo: p.metodo, fecha: p.fecha_pago, referencia: p.referencia
    }))
  };
}

async function compararPeriodos({ periodo_a, periodo_b }, empresaId) {
  async function getStats(periodo) {
    const [anio, mes] = periodo.split('-').map(Number);
    const [s] = await sql`
      SELECT COUNT(*) as num_facturas,
        COALESCE(SUM(total), 0) as facturado,
        COALESCE(SUM(COALESCE(pagado, 0)), 0) as cobrado,
        COALESCE(SUM(total - COALESCE(pagado, 0)), 0) as pendiente
      FROM factura_180
      WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
        AND EXTRACT(MONTH FROM fecha) = ${mes} AND EXTRACT(YEAR FROM fecha) = ${anio}
    `;
    return { periodo, num_facturas: Number(s.num_facturas), facturado: Number(s.facturado), cobrado: Number(s.cobrado), pendiente: Number(s.pendiente) };
  }

  const a = await getStats(periodo_a);
  const b = await getStats(periodo_b);
  const variacion = a.facturado > 0 ? ((b.facturado - a.facturado) / a.facturado * 100) : (b.facturado > 0 ? 100 : 0);

  return {
    periodo_a: a, periodo_b: b,
    variacion_facturado_pct: Math.round(variacion * 10) / 10,
    variacion_cobrado_pct: a.cobrado > 0 ? Math.round((b.cobrado - a.cobrado) / a.cobrado * 1000) / 10 : 0
  };
}

async function tendenciaFacturacion({ meses = 6 }, empresaId) {
  const rows = await sql`
    SELECT TO_CHAR(fecha, 'YYYY-MM') as mes,
      COUNT(*) as num_facturas,
      COALESCE(SUM(total), 0) as facturado,
      COALESCE(SUM(COALESCE(pagado, 0)), 0) as cobrado,
      COALESCE(SUM(total - COALESCE(pagado, 0)), 0) as pendiente
    FROM factura_180
    WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
      AND fecha >= NOW() - INTERVAL '1 month' * ${meses}
    GROUP BY TO_CHAR(fecha, 'YYYY-MM')
    ORDER BY mes ASC
  `;

  const tendencia = rows.map(r => ({
    mes: r.mes, num_facturas: Number(r.num_facturas),
    facturado: Number(r.facturado), cobrado: Number(r.cobrado), pendiente: Number(r.pendiente)
  }));

  // Calculate trend
  let tendenciaTexto = "estable";
  if (tendencia.length >= 2) {
    const ultimosMeses = tendencia.slice(-3);
    const primerMes = ultimosMeses[0]?.facturado || 0;
    const ultimoMes = ultimosMeses[ultimosMeses.length - 1]?.facturado || 0;
    if (primerMes > 0) {
      const cambio = ((ultimoMes - primerMes) / primerMes) * 100;
      tendenciaTexto = cambio > 10 ? "creciente" : cambio < -10 ? "decreciente" : "estable";
    }
  }

  return { meses_analizados: meses, tendencia: tendenciaTexto, datos: tendencia };
}

async function clientesEnRiesgo(_args, empresaId) {
  // Clients with invoices >60 days unpaid
  const morosos = await sql`
    SELECT c.id, c.nombre,
      COUNT(f.id) as facturas_pendientes,
      COALESCE(SUM(f.total - COALESCE(f.pagado, 0)), 0) as deuda_total,
      MIN(f.fecha) as factura_mas_antigua
    FROM clients_180 c
    JOIN factura_180 f ON f.cliente_id = c.id AND f.empresa_id = ${empresaId}
    WHERE c.empresa_id = ${empresaId} AND f.estado = 'VALIDADA'
      AND COALESCE(f.estado_pago, 'pendiente') != 'pagado'
      AND f.fecha < NOW() - INTERVAL '60 days'
    GROUP BY c.id, c.nombre
    ORDER BY deuda_total DESC LIMIT 10
  `;

  // Clients with no activity in 90 days
  const inactivos = await sql`
    SELECT c.id, c.nombre,
      MAX(COALESCE(f.fecha, w.fecha)) as ultima_actividad
    FROM clients_180 c
    LEFT JOIN factura_180 f ON f.cliente_id = c.id AND f.empresa_id = ${empresaId}
    LEFT JOIN work_logs_180 w ON w.cliente_id = c.id AND w.empresa_id = ${empresaId}
    WHERE c.empresa_id = ${empresaId} AND c.activo = true
    GROUP BY c.id, c.nombre
    HAVING MAX(COALESCE(f.fecha, w.fecha)) < NOW() - INTERVAL '90 days'
       OR MAX(COALESCE(f.fecha, w.fecha)) IS NULL
    ORDER BY ultima_actividad ASC NULLS FIRST
    LIMIT 10
  `;

  return {
    morosos: morosos.map(m => ({
      nombre: m.nombre, facturas_pendientes: Number(m.facturas_pendientes),
      deuda_total: Number(m.deuda_total), factura_mas_antigua: m.factura_mas_antigua
    })),
    inactivos: inactivos.map(i => ({ nombre: i.nombre, ultima_actividad: i.ultima_actividad })),
    total_en_riesgo: morosos.length + inactivos.length
  };
}

async function alertasNegocio(_args, empresaId) {
  const alertas = [];

  // Facturas vencidas >30 días
  const [vencidas] = await sql`
    SELECT COUNT(*) as total, COALESCE(SUM(total - COALESCE(pagado, 0)), 0) as importe
    FROM factura_180 WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
      AND COALESCE(estado_pago, 'pendiente') != 'pagado'
      AND fecha < NOW() - INTERVAL '30 days'
  `;
  if (Number(vencidas.total) > 0) {
    alertas.push({ tipo: "urgente", icono: "🔴", mensaje: `${vencidas.total} facturas vencidas (>30 días) por ${Number(vencidas.importe).toFixed(2)} €` });
  }

  // Borradores sin validar >7 días
  const [borradores] = await sql`
    SELECT COUNT(*) as total
    FROM factura_180 WHERE empresa_id = ${empresaId} AND estado = 'BORRADOR'
      AND created_at < NOW() - INTERVAL '7 days'
  `;
  if (Number(borradores.total) > 0) {
    alertas.push({ tipo: "aviso", icono: "🟡", mensaje: `${borradores.total} borradores sin validar (>7 días)` });
  }

  // Trabajos sin facturar >15 días
  const [trabajos] = await sql`
    SELECT COUNT(*) as total, COALESCE(SUM(valor), 0) as valor
    FROM work_logs_180 WHERE empresa_id = ${empresaId} AND factura_id IS NULL
      AND COALESCE(estado_pago, 'pendiente') != 'pagado' AND fecha < NOW() - INTERVAL '15 days'
  `;
  if (Number(trabajos.total) > 0) {
    alertas.push({ tipo: "aviso", icono: "🟡", mensaje: `${trabajos.total} trabajos sin facturar (>15 días) por ${Number(trabajos.valor).toFixed(2)} €` });
  }

  // Ausencias próximas (7 días)
  const ausencias = await sql`
    SELECT a.tipo, a.fecha_inicio, e.nombre
    FROM ausencias_180 a JOIN employees_180 e ON a.empleado_id = e.id
    WHERE a.empresa_id = ${empresaId} AND a.estado = 'aprobada'
      AND a.fecha_inicio BETWEEN NOW() AND NOW() + INTERVAL '7 days'
    ORDER BY a.fecha_inicio ASC LIMIT 5
  `;
  for (const a of ausencias) {
    alertas.push({ tipo: "info", icono: "📅", mensaje: `${a.nombre}: ${a.tipo} desde ${a.fecha_inicio}` });
  }

  if (alertas.length === 0) {
    alertas.push({ tipo: "ok", icono: "✅", mensaje: "Todo en orden. No hay alertas pendientes." });
  }

  return { total_alertas: alertas.length, alertas };
}

// ============================
// NUEVOS SKILLS: RRHH
// ============================

async function consultarFichajes({ empleado_id, fecha_inicio, fecha_fin }, empresaId) {
  let query = sql`
    SELECT f.id, f.tipo, f.fecha, f.created_at as hora, e.nombre as empleado_nombre, f.sospechoso
    FROM fichajes_180 f
    JOIN employees_180 e ON f.empleado_id = e.id
    WHERE f.empresa_id = ${empresaId} AND f.fecha >= ${fecha_inicio} AND f.fecha <= ${fecha_fin}
  `;
  if (empleado_id) query = sql`${query} AND f.empleado_id = ${empleado_id}`;
  query = sql`${query} ORDER BY f.fecha ASC, f.created_at ASC LIMIT 100`;

  const fichajes = await query;
  const sospechosos = fichajes.filter(f => f.sospechoso).length;

  return {
    total: fichajes.length, sospechosos,
    fichajes: fichajes.map(f => ({
      empleado: f.empleado_nombre, tipo: f.tipo, fecha: f.fecha,
      hora: new Date(f.hora).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
      sospechoso: f.sospechoso || false
    }))
  };
}

async function resumenHorasEmpleado({ empleado_id, fecha_inicio, fecha_fin }, empresaId) {
  let query = sql`
    SELECT e.id, e.nombre,
      COUNT(j.id) as dias_trabajados,
      COALESCE(SUM(j.minutos_trabajados), 0) as minutos_totales,
      COALESCE(SUM(j.minutos_extra), 0) as minutos_extra,
      COALESCE(SUM(j.minutos_descanso), 0) as minutos_descanso
    FROM employees_180 e
    LEFT JOIN jornadas_180 j ON j.empleado_id = e.id AND j.empresa_id = ${empresaId}
      AND j.fecha >= ${fecha_inicio} AND j.fecha <= ${fecha_fin}
    WHERE e.empresa_id = ${empresaId} AND e.activo = true
  `;
  if (empleado_id) query = sql`${query} AND e.id = ${empleado_id}`;
  query = sql`${query} GROUP BY e.id, e.nombre ORDER BY minutos_totales DESC`;

  const rows = await query;
  return {
    periodo: { desde: fecha_inicio, hasta: fecha_fin },
    empleados: rows.map(r => ({
      nombre: r.nombre,
      dias_trabajados: Number(r.dias_trabajados),
      horas_trabajadas: Math.round(Number(r.minutos_totales) / 60 * 10) / 10,
      horas_extra: Math.round(Number(r.minutos_extra) / 60 * 10) / 10,
      horas_descanso: Math.round(Number(r.minutos_descanso) / 60 * 10) / 10,
      promedio_diario: Number(r.dias_trabajados) > 0
        ? Math.round(Number(r.minutos_totales) / Number(r.dias_trabajados) / 60 * 10) / 10
        : 0
    }))
  };
}

async function consultarAusenciasResumen({ empleado_id, anio }, empresaId) {
  const year = anio || new Date().getFullYear();
  let query = sql`
    SELECT e.nombre,
      COUNT(CASE WHEN a.tipo = 'vacaciones' THEN 1 END) as vacaciones,
      COUNT(CASE WHEN a.tipo = 'baja_medica' THEN 1 END) as bajas_medicas,
      COUNT(CASE WHEN a.tipo = 'asuntos_propios' THEN 1 END) as asuntos_propios,
      COUNT(CASE WHEN a.tipo = 'permiso' THEN 1 END) as permisos,
      SUM(CASE WHEN a.tipo = 'vacaciones' THEN (a.fecha_fin - a.fecha_inicio + 1) ELSE 0 END) as dias_vacaciones_usados
    FROM employees_180 e
    LEFT JOIN ausencias_180 a ON a.empleado_id = e.id AND a.empresa_id = ${empresaId}
      AND EXTRACT(YEAR FROM a.fecha_inicio) = ${year} AND a.estado = 'aprobada'
    WHERE e.empresa_id = ${empresaId} AND e.activo = true
  `;
  if (empleado_id) query = sql`${query} AND e.id = ${empleado_id}`;
  query = sql`${query} GROUP BY e.id, e.nombre ORDER BY e.nombre ASC`;

  const rows = await query;
  return {
    anio: year,
    empleados: rows.map(r => ({
      nombre: r.nombre,
      vacaciones: Number(r.vacaciones), dias_vacaciones_usados: Number(r.dias_vacaciones_usados),
      bajas_medicas: Number(r.bajas_medicas), asuntos_propios: Number(r.asuntos_propios),
      permisos: Number(r.permisos)
    }))
  };
}

async function productividadEmpleado({ empleado_id, fecha_inicio, fecha_fin }, empresaId) {
  let query = sql`
    SELECT e.id, e.nombre,
      COALESCE(SUM(j.minutos_trabajados), 0) as minutos_trabajados,
      (SELECT COALESCE(SUM(w.valor), 0) FROM work_logs_180 w WHERE w.empresa_id = ${empresaId} AND w.employee_id = e.id AND w.fecha >= ${fecha_inicio} AND w.fecha <= ${fecha_fin}) as valor_generado,
      (SELECT COUNT(DISTINCT w.cliente_id) FROM work_logs_180 w WHERE w.empresa_id = ${empresaId} AND w.employee_id = e.id AND w.fecha >= ${fecha_inicio} AND w.fecha <= ${fecha_fin}) as clientes_atendidos,
      (SELECT COUNT(*) FROM work_logs_180 w WHERE w.empresa_id = ${empresaId} AND w.employee_id = e.id AND w.fecha >= ${fecha_inicio} AND w.fecha <= ${fecha_fin}) as trabajos_completados
    FROM employees_180 e
    LEFT JOIN jornadas_180 j ON j.empleado_id = e.id AND j.empresa_id = ${empresaId}
      AND j.fecha >= ${fecha_inicio} AND j.fecha <= ${fecha_fin}
    WHERE e.empresa_id = ${empresaId} AND e.activo = true
  `;
  if (empleado_id) query = sql`${query} AND e.id = ${empleado_id}`;
  query = sql`${query} GROUP BY e.id, e.nombre ORDER BY valor_generado DESC`;

  const rows = await query;
  return {
    periodo: { desde: fecha_inicio, hasta: fecha_fin },
    empleados: rows.map(r => {
      const horas = Number(r.minutos_trabajados) / 60;
      const valor = Number(r.valor_generado);
      return {
        nombre: r.nombre, horas_trabajadas: Math.round(horas * 10) / 10,
        valor_generado: valor, clientes_atendidos: Number(r.clientes_atendidos),
        trabajos_completados: Number(r.trabajos_completados),
        valor_por_hora: horas > 0 ? Math.round(valor / horas * 100) / 100 : 0
      };
    })
  };
}

// ============================
// NUEVOS SKILLS: AUTOMATIZACIÓN
// ============================

async function facturarTrabajosPendientes({ cliente_id, iva = 21 }, empresaId) {
  const [cliente] = await sql`SELECT id, nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  if (!cliente) return { error: "Cliente no encontrado" };

  const trabajos = await sql`
    SELECT id, descripcion, fecha, minutos, valor
    FROM work_logs_180
    WHERE empresa_id = ${empresaId} AND cliente_id = ${cliente_id} AND factura_id IS NULL
    ORDER BY fecha ASC
  `;

  if (trabajos.length === 0) return { mensaje: `No hay trabajos pendientes de facturar para ${cliente.nombre}.` };

  let createdId;
  let total;
  await sql.begin(async (tx) => {
    let subtotal = 0;
    let iva_total = 0;

    const [factura] = await tx`
      INSERT INTO factura_180 (empresa_id, cliente_id, fecha, estado, iva_global, subtotal, iva_total, total, created_at)
      VALUES (${empresaId}, ${cliente_id}, ${new Date().toISOString().split('T')[0]}::date, 'BORRADOR', ${iva}, 0, 0, 0, now())
      RETURNING id
    `;
    createdId = factura.id;

    for (const t of trabajos) {
      const desc = t.descripcion || "Trabajo";
      const valor = Number(t.valor || 0);
      const base = valor > 0 ? valor : (Number(t.minutos || 0) / 60);
      const importe_iva = base * iva / 100;
      subtotal += base;
      iva_total += importe_iva;

      await tx`
        INSERT INTO lineafactura_180 (factura_id, descripcion, cantidad, precio_unitario, total, iva_percent)
        VALUES (${factura.id}, ${`${desc} (${t.fecha})`}, 1, ${base}, ${base + importe_iva}, ${iva})
      `;

      await tx`UPDATE work_logs_180 SET factura_id = ${factura.id} WHERE id = ${t.id} AND empresa_id = ${empresaId}`;
    }

    total = Math.round((subtotal + iva_total) * 100) / 100;
    await tx`
      UPDATE factura_180 SET subtotal = ${Math.round(subtotal * 100) / 100},
        iva_total = ${Math.round(iva_total * 100) / 100}, total = ${total}
      WHERE id = ${factura.id}
    `;
  });

  return {
    success: true,
    mensaje: `Factura borrador creada para ${cliente.nombre} con ${trabajos.length} trabajos. Total: ${total.toFixed(2)} € (IVA ${iva}%). ID: ${createdId}`,
    factura: { id: createdId, cliente: cliente.nombre, trabajos: trabajos.length, total, estado: "BORRADOR" }
  };
}

async function cierreMensual({ mes, anio }, empresaId) {
  const now = new Date();
  const m = mes || (now.getMonth() + 1);
  const a = anio || now.getFullYear();

  const [facturacion] = await sql`
    SELECT
      COUNT(CASE WHEN estado = 'VALIDADA' THEN 1 END) as validadas,
      COUNT(CASE WHEN estado = 'BORRADOR' THEN 1 END) as borradores,
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN total ELSE 0 END), 0) as facturado,
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN COALESCE(pagado, 0) ELSE 0 END), 0) as cobrado,
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN total - COALESCE(pagado, 0) ELSE 0 END), 0) as pendiente
    FROM factura_180 WHERE empresa_id = ${empresaId}
      AND EXTRACT(MONTH FROM fecha) = ${m} AND EXTRACT(YEAR FROM fecha) = ${a}
  `;

  const [horas] = await sql`
    SELECT COALESCE(SUM(minutos_trabajados), 0) as minutos, COUNT(DISTINCT empleado_id) as empleados
    FROM jornadas_180 WHERE empresa_id = ${empresaId}
      AND EXTRACT(MONTH FROM fecha) = ${m} AND EXTRACT(YEAR FROM fecha) = ${a}
  `;

  const [trabajosPend] = await sql`
    SELECT COUNT(*) as total, COALESCE(SUM(valor), 0) as valor
    FROM work_logs_180 WHERE empresa_id = ${empresaId} AND factura_id IS NULL
      AND COALESCE(estado_pago, 'pendiente') != 'pagado'
      AND EXTRACT(MONTH FROM fecha) = ${m} AND EXTRACT(YEAR FROM fecha) = ${a}
  `;

  const [nuevosClientes] = await sql`
    SELECT COUNT(*) as total FROM clients_180
    WHERE empresa_id = ${empresaId}
      AND EXTRACT(MONTH FROM created_at) = ${m} AND EXTRACT(YEAR FROM created_at) = ${a}
  `;

  return {
    periodo: `${String(m).padStart(2, '0')}/${a}`,
    facturacion: {
      facturas_validadas: Number(facturacion.validadas), facturas_borrador: Number(facturacion.borradores),
      total_facturado: Number(facturacion.facturado), total_cobrado: Number(facturacion.cobrado),
      total_pendiente: Number(facturacion.pendiente),
      ratio_cobro: Number(facturacion.facturado) > 0 ? Math.round(Number(facturacion.cobrado) / Number(facturacion.facturado) * 100) : 0
    },
    equipo: {
      empleados_activos: Number(horas.empleados),
      horas_trabajadas: Math.round(Number(horas.minutos) / 60 * 10) / 10
    },
    pendientes: {
      trabajos_sin_facturar: Number(trabajosPend.total),
      valor_sin_facturar: Number(trabajosPend.valor)
    },
    crecimiento: { nuevos_clientes: Number(nuevosClientes.total) }
  };
}

// ============================
// FICHAJES
// ============================

async function consultarFichajesSospechosos(args, empresaId) {
  const rows = await sql`
    SELECT f.id, f.fecha, f.tipo, f.nota, f.sospecha_motivo, f.geo_direccion,
      e.nombre AS empleado_nombre, c.nombre AS cliente_nombre
    FROM fichajes_180 f
    JOIN employees_180 e ON e.id = f.empleado_id
    LEFT JOIN clients_180 c ON c.id = f.cliente_id
    WHERE f.empresa_id = ${empresaId} AND f.sospechoso = true
    ORDER BY f.fecha DESC LIMIT 20
  `;
  return { total: rows.length, fichajes: rows };
}

async function crearFichajeManual(args, empresaId) {
  const { empleado_id, tipo, fecha_hora, motivo } = args;
  if (!empleado_id) return { error: "Se necesita empleado_id o nombre_empleado" };
  // Verificar empleado pertenece a empresa
  const [emp] = await sql`SELECT id, user_id FROM employees_180 WHERE id = ${empleado_id} AND empresa_id = ${empresaId}`;
  if (!emp) return { error: "Empleado no encontrado" };
  // Buscar jornada activa
  const fecha = fecha_hora.split(" ")[0];
  const [jornada] = await sql`SELECT id FROM jornadas_180 WHERE empleado_id = ${empleado_id} AND fecha = ${fecha}::date LIMIT 1`;
  const [nuevo] = await sql`
    INSERT INTO fichajes_180 (empleado_id, empresa_id, user_id, jornada_id, tipo, fecha, estado, origen, nota, sospechoso, creado_manual)
    VALUES (${empleado_id}, ${empresaId}, ${emp.user_id}, ${jornada?.id || null}, ${tipo}, ${fecha_hora}::timestamp, 'confirmado', 'app', ${motivo || null}, false, true)
    RETURNING *
  `;
  return { success: true, fichaje: nuevo };
}

async function validarFichajeIA({ fichaje_id, accion, nota }, empresaId) {
  const nuevoEstado = accion === "confirmar" ? "confirmado" : "rechazado";
  const [updated] = await sql`
    UPDATE fichajes_180 SET estado = ${nuevoEstado}, sospechoso = false, sospecha_motivo = null,
      nota = CASE WHEN ${nota || null} IS NULL THEN nota ELSE concat_ws(' | ', NULLIF(nota, ''), ${nota || null}) END
    WHERE id = ${fichaje_id} AND empresa_id = ${empresaId}
    RETURNING id, tipo, fecha, estado
  `;
  if (!updated) return { error: "Fichaje no encontrado" };
  return { success: true, fichaje: updated };
}

// ============================
// JORNADAS
// ============================

async function consultarJornadas({ fecha, empleado_id, estado }, empresaId) {
  const rows = await sql`
    SELECT j.id, j.fecha, j.inicio, j.fin, j.estado, j.minutos_trabajados,
      j.minutos_descanso, j.minutos_extra, j.incidencia,
      e.nombre AS empleado_nombre
    FROM jornadas_180 j
    JOIN employees_180 e ON e.id = j.empleado_id
    WHERE j.empresa_id = ${empresaId}
      ${fecha ? sql`AND j.fecha = ${fecha}::date` : sql``}
      ${empleado_id ? sql`AND j.empleado_id = ${empleado_id}::uuid` : sql``}
      ${estado && estado !== 'todos' ? sql`AND j.estado = ${estado}` : sql``}
    ORDER BY j.fecha DESC, j.inicio DESC LIMIT 50
  `;
  return { total: rows.length, jornadas: rows };
}

// ============================
// PLANTILLAS
// ============================

async function consultarPlantillas(args, empresaId) {
  const rows = await sql`SELECT * FROM plantillas_jornada_180 WHERE empresa_id = ${empresaId} ORDER BY created_at DESC`;
  return { total: rows.length, plantillas: rows };
}

async function crearPlantillaIA({ nombre, descripcion, tipo }, empresaId) {
  const [nueva] = await sql`
    INSERT INTO plantillas_jornada_180 (empresa_id, nombre, descripcion, tipo)
    VALUES (${empresaId}, ${nombre}, ${descripcion || null}, ${tipo || 'semanal'})
    RETURNING *
  `;
  return { success: true, plantilla: nueva };
}

async function asignarPlantillaIA({ plantilla_id, empleado_id, fecha_inicio, fecha_fin }, empresaId) {
  if (!empleado_id) return { error: "Se necesita empleado_id" };
  if (!plantilla_id) return { error: "Se necesita plantilla_id" };
  if (!fecha_inicio) return { error: "Se necesita fecha_inicio" };

  // Validar que el empleado pertenece a la empresa y está activo
  const [emp] = await sql`
    SELECT id FROM employees_180 WHERE id = ${empleado_id} AND empresa_id = ${empresaId} AND activo = true LIMIT 1
  `;
  if (!emp) return { error: "Empleado no encontrado o inactivo en esta empresa" };

  // Validar que la plantilla existe y pertenece a la empresa
  const [plt] = await sql`
    SELECT id FROM plantillas_jornada_180 WHERE id = ${plantilla_id} AND empresa_id = ${empresaId} LIMIT 1
  `;
  if (!plt) return { error: "Plantilla no encontrada en esta empresa" };

  // Cerrar asignaciones previas que se solapen
  await sql`
    UPDATE empleado_plantillas_180
    SET fecha_fin = ${fecha_inicio}::date - interval '1 day'
    WHERE empleado_id = ${empleado_id} AND empresa_id = ${empresaId}
      AND (fecha_fin IS NULL OR fecha_fin >= ${fecha_inicio}::date)
  `;

  const [asig] = await sql`
    INSERT INTO empleado_plantillas_180 (empleado_id, plantilla_id, fecha_inicio, fecha_fin, empresa_id)
    VALUES (${empleado_id}, ${plantilla_id}, ${fecha_inicio}::date, ${fecha_fin || null}::date, ${empresaId})
    RETURNING *
  `;
  return { success: true, asignacion: asig };
}

// ============================
// NÓMINAS
// ============================

async function consultarNominas({ anio, mes }, empresaId) {
  const year = anio || new Date().getFullYear();
  const rows = await sql`
    SELECT n.*, e.nombre as empleado_nombre
    FROM nominas_180 n
    LEFT JOIN employees_180 em ON n.empleado_id = em.id
    LEFT JOIN users_180 e ON em.user_id = e.id
    WHERE n.empresa_id = ${empresaId} AND n.anio = ${year}
      ${mes ? sql`AND n.mes = ${mes}` : sql``}
    ORDER BY n.mes DESC
  `;
  return { total: rows.length, nominas: rows };
}

async function crearNominaIA(args, empresaId) {
  const { empleado_id, anio, mes, bruto, seguridad_social_empresa, seguridad_social_empleado, irpf_retencion, liquido } = args;
  const [nueva] = await sql`
    INSERT INTO nominas_180 (empresa_id, empleado_id, anio, mes, bruto, seguridad_social_empresa, seguridad_social_empleado, irpf_retencion, liquido)
    VALUES (${empresaId}, ${empleado_id || null}, ${anio}, ${mes}, ${bruto}, ${seguridad_social_empresa || 0}, ${seguridad_social_empleado || 0}, ${irpf_retencion || 0}, ${liquido || 0})
    RETURNING *
  `;
  return { success: true, nomina: nueva };
}

async function enviarNominaIA(args, empresaId) {
  let nominaId = args.nomina_id;

  // Si no tenemos ID, buscar por empleado + periodo
  if (!nominaId && args.anio && args.mes) {
    let empleadoId = args.empleado_id;
    if (!empleadoId && args.nombre_empleado) {
      const emps = await sql`
        SELECT e.id FROM employees_180 e
        JOIN users_180 u ON u.id = e.user_id
        WHERE e.empresa_id = ${empresaId} AND LOWER(u.nombre) LIKE LOWER(${`%${args.nombre_empleado}%`})
      `;
      if (emps.length === 0) return { error: `No se encontró empleado con nombre "${args.nombre_empleado}"` };
      if (emps.length > 1) return { error: `Hay ${emps.length} empleados con ese nombre. Sé más específico.` };
      empleadoId = emps[0].id;
    }
    if (!empleadoId) return { error: "Necesito nombre_empleado o nomina_id" };

    const [n] = await sql`
      SELECT id FROM nominas_180
      WHERE empresa_id = ${empresaId} AND empleado_id = ${empleadoId} AND anio = ${args.anio} AND mes = ${args.mes}
    `;
    if (!n) return { error: `No se encontró nómina de ${args.mes}/${args.anio} para ese empleado` };
    nominaId = n.id;
  }

  if (!nominaId) return { error: "Necesito nomina_id o (nombre_empleado + anio + mes)" };

  // Obtener datos completos
  const [nomina] = await sql`
    SELECT n.*, e.user_id, u.email, u.nombre as empleado_nombre
    FROM nominas_180 n
    JOIN employees_180 e ON e.id = n.empleado_id
    JOIN users_180 u ON u.id = e.user_id
    WHERE n.id = ${nominaId} AND n.empresa_id = ${empresaId}
  `;
  if (!nomina) return { error: "Nómina no encontrada" };

  // Crear entrega
  await sql`
    INSERT INTO nomina_entregas_180 (nomina_id, empresa_id, empleado_id, estado, metodo_envio, email_enviado_a)
    VALUES (${nominaId}, ${empresaId}, ${nomina.empleado_id}, 'enviada', 'app', ${nomina.email})
  `;
  await sql`UPDATE nominas_180 SET estado_entrega = 'enviada', updated_at = NOW() WHERE id = ${nominaId}`;

  // Notificación al empleado
  const { crearNotificacionSistema } = await import("../controllers/notificacionesController.js");
  await crearNotificacionSistema({
    empresaId,
    userId: nomina.user_id,
    tipo: "info",
    titulo: "Nueva nómina disponible",
    mensaje: `Tu nómina de ${nomina.mes}/${nomina.anio} está disponible. Neto: ${Number(nomina.liquido).toFixed(2)} €`,
    accionUrl: "/empleado/nominas",
    accionLabel: "Ver nómina",
  });

  return { success: true, mensaje: `Nómina de ${nomina.mes}/${nomina.anio} enviada a ${nomina.empleado_nombre} (${nomina.email})` };
}

async function consultarEntregasNominasIA({ anio, mes, estado }, empresaId) {
  const year = anio || new Date().getFullYear();
  const rows = await sql`
    SELECT ne.estado, ne.fecha_envio, ne.fecha_recepcion, ne.fecha_firma,
           n.anio, n.mes, n.bruto, n.liquido, u.nombre as empleado_nombre
    FROM nomina_entregas_180 ne
    JOIN nominas_180 n ON n.id = ne.nomina_id
    JOIN employees_180 e ON e.id = ne.empleado_id
    JOIN users_180 u ON u.id = e.user_id
    WHERE ne.empresa_id = ${empresaId} AND n.anio = ${year}
      ${mes ? sql`AND n.mes = ${mes}` : sql``}
      ${estado ? sql`AND ne.estado = ${estado}` : sql``}
    ORDER BY ne.fecha_envio DESC
  `;
  return { total: rows.length, entregas: rows };
}

// ============================
// PARTES DE DÍA
// ============================

async function consultarPartesDia({ fecha, fecha_inicio, fecha_fin, cliente_id }, empresaId) {
  const rows = await sql`
    SELECT pd.*, e.nombre as empleado_nombre, c.nombre as cliente_nombre
    FROM partes_dia_180 pd
    JOIN employees_180 e ON pd.empleado_id = e.id
    LEFT JOIN clients_180 c ON pd.cliente_id = c.id
    WHERE pd.empresa_id = ${empresaId}
      ${fecha ? sql`AND pd.fecha = ${fecha}::date` : sql``}
      ${fecha_inicio ? sql`AND pd.fecha >= ${fecha_inicio}::date` : sql``}
      ${fecha_fin ? sql`AND pd.fecha <= ${fecha_fin}::date` : sql``}
      ${cliente_id ? sql`AND pd.cliente_id = ${cliente_id}::uuid` : sql``}
    ORDER BY pd.fecha DESC LIMIT 50
  `;
  return { total: rows.length, partes: rows };
}

async function validarParteDiaIA({ empleado_id, fecha, validado, nota }, empresaId) {
  if (!empleado_id) return { error: "Se necesita empleado_id o nombre_empleado" };
  const val = validado === "true" || validado === true;
  await sql`
    UPDATE partes_dia_180 SET validado = ${val}, nota_admin = ${nota || null}, validado_at = now()
    WHERE empresa_id = ${empresaId} AND empleado_id = ${empleado_id} AND fecha = ${fecha}::date
  `;
  return { success: true, mensaje: val ? "Parte validado" : "Parte rechazado" };
}

// ============================
// KNOWLEDGE BASE (WRITE)
// ============================

async function crearConocimientoIA({ token, respuesta, categoria, prioridad }, empresaId) {
  // Check duplicate
  const [dup] = await sql`SELECT 1 FROM conocimiento_180 WHERE empresa_id = ${empresaId} AND LOWER(token) = LOWER(${token.trim()})`;
  if (dup) return { error: `Ya existe una entrada con el token "${token}". Usa actualizar_conocimiento.` };
  const [nuevo] = await sql`
    INSERT INTO conocimiento_180 (empresa_id, token, respuesta, categoria, prioridad)
    VALUES (${empresaId}, ${token.trim()}, ${respuesta.trim()}, ${categoria || null}, ${prioridad || 0})
    RETURNING *
  `;
  return { success: true, entrada: nuevo };
}

async function actualizarConocimientoIA(args, empresaId) {
  const { id } = args;
  const fields = {};
  if (args.token) fields.token = args.token.trim();
  if (args.respuesta) fields.respuesta = args.respuesta.trim();
  if (args.categoria !== undefined) fields.categoria = args.categoria;
  if (args.activo !== undefined) fields.activo = args.activo === "true" || args.activo === true;
  fields.updated_at = new Date();
  if (Object.keys(fields).length <= 1) return { error: "No hay campos para actualizar" };
  const [updated] = await sql`UPDATE conocimiento_180 SET ${sql(fields, ...Object.keys(fields))} WHERE id = ${id} AND empresa_id = ${empresaId} RETURNING *`;
  if (!updated) return { error: "Entrada no encontrada" };
  return { success: true, entrada: updated };
}

async function eliminarConocimientoIA({ id }, empresaId) {
  const [deleted] = await sql`DELETE FROM conocimiento_180 WHERE id = ${id} AND empresa_id = ${empresaId} RETURNING id`;
  if (!deleted) return { error: "Entrada no encontrada" };
  return { success: true, mensaje: "Entrada eliminada" };
}

// ============================
// CONFIGURACIÓN
// ============================

async function consultarConfiguracion(args, empresaId) {
  const [emisor] = await sql`SELECT * FROM emisor_180 WHERE empresa_id = ${empresaId} LIMIT 1`;
  const [sistema] = await sql`SELECT * FROM configuracionsistema_180 WHERE empresa_id = ${empresaId} LIMIT 1`;
  return {
    emisor: emisor || { mensaje: "No configurado" },
    sistema: sistema || { mensaje: "No configurado" },
    resumen: emisor ? `${emisor.nombre || 'Sin nombre'} - NIF: ${emisor.nif || 'Sin NIF'} - Serie: ${emisor.serie || sistema?.serie || 'Sin serie'}` : "Configuración pendiente"
  };
}

async function consultarModulos(args, empresaId) {
  const [config] = await sql`SELECT * FROM empresa_config_180 WHERE empresa_id = ${empresaId} LIMIT 1`;
  if (!config) return { error: "Configuración no encontrada" };
  const modulos = {
    facturacion: config.facturacion !== false,
    fichajes: config.fichajes !== false,
    jornadas: config.jornadas !== false,
    nominas: config.nominas !== false,
    gastos: config.gastos !== false,
    calendario: config.calendario !== false,
    conocimiento: config.conocimiento !== false,
    storage: config.storage !== false,
    auditoria: config.auditoria !== false,
  };
  return { modulos, empresa_id: empresaId };
}

// ============================
// SUGERENCIAS
// ============================

async function consultarSugerenciasIA({ estado }, empresaId, userId) {
  // Check if user is the creator (fabricante)
  const [empresa] = await sql`SELECT user_id FROM empresa_180 WHERE id = ${empresaId} LIMIT 1`;
  const esCreador = empresa && empresa.user_id === userId;

  let sugerencias;
  if (esCreador) {
    // Fabricante ve TODAS las sugerencias de TODOS los usuarios
    if (estado && estado !== "todas") {
      sugerencias = await sql`
        SELECT s.id, s.titulo, s.descripcion, s.categoria, s.estado, s.respuesta, s.respondida_at, s.created_at,
               u.nombre as usuario, u.email as email_usuario, e.nombre as empresa
        FROM sugerencias_180 s
        JOIN users_180 u ON u.id = s.user_id
        JOIN empresa_180 e ON e.id = s.empresa_id
        WHERE s.estado = ${estado}
        ORDER BY s.created_at DESC LIMIT 50
      `;
    } else {
      sugerencias = await sql`
        SELECT s.id, s.titulo, s.descripcion, s.categoria, s.estado, s.respuesta, s.respondida_at, s.created_at,
               u.nombre as usuario, u.email as email_usuario, e.nombre as empresa
        FROM sugerencias_180 s
        JOIN users_180 u ON u.id = s.user_id
        JOIN empresa_180 e ON e.id = s.empresa_id
        ORDER BY CASE s.estado WHEN 'nueva' THEN 0 WHEN 'leida' THEN 1 ELSE 2 END, s.created_at DESC
        LIMIT 50
      `;
    }
  } else {
    // Usuario normal solo ve las suyas
    sugerencias = await sql`
      SELECT id, titulo, descripcion, categoria, estado, respuesta, respondida_at, created_at
      FROM sugerencias_180
      WHERE empresa_id = ${empresaId}
      ORDER BY created_at DESC LIMIT 20
    `;
  }

  return {
    sugerencias,
    total: sugerencias.length,
    es_creador: esCreador,
    mensaje: sugerencias.length === 0 ? "No hay sugerencias" : `${sugerencias.length} sugerencia(s) encontrada(s)`
  };
}

async function responderSugerenciaIA({ sugerencia_id, respuesta }, empresaId, userId) {
  // Verify user is creator
  const [empresa] = await sql`SELECT user_id FROM empresa_180 WHERE id = ${empresaId} LIMIT 1`;
  if (!empresa || empresa.user_id !== userId) {
    return { error: "Solo el creador de la app puede responder sugerencias" };
  }

  if (!sugerencia_id || !respuesta) {
    return { error: "Se requiere sugerencia_id y respuesta" };
  }

  const [sugerencia] = await sql`
    UPDATE sugerencias_180
    SET respuesta = ${respuesta}, estado = 'respondida', respondida_at = NOW()
    WHERE id = ${sugerencia_id}
    RETURNING *
  `;

  if (!sugerencia) {
    return { error: "Sugerencia no encontrada" };
  }

  // Notificar al usuario
  try {
    const { crearNotificacionSistema } = await import("../controllers/notificacionesController.js");
    await crearNotificacionSistema({
      empresaId: sugerencia.empresa_id,
      userId: sugerencia.user_id,
      tipo: "success",
      titulo: "Respuesta a tu sugerencia",
      mensaje: `"${sugerencia.titulo}" - ${respuesta}`,
      accionUrl: "/admin/sugerencias",
      accionLabel: "Ver",
    });
  } catch (e) {
    console.warn("No se pudo notificar:", e.message);
  }

  return { success: true, mensaje: `Sugerencia respondida: "${sugerencia.titulo}". El usuario ha sido notificado.` };
}

// ============================
// STORAGE
// ============================

async function listarArchivos({ folder }, empresaId) {
  if (!folder) {
    const folders = await sql`SELECT DISTINCT folder FROM storage_180 WHERE empresa_id = ${empresaId} ORDER BY folder ASC`;
    const [stats] = await sql`SELECT SUM(size_bytes) as used_bytes FROM storage_180 WHERE empresa_id = ${empresaId}`;
    return { carpetas: folders.map(f => f.folder), espacio_usado_mb: Math.round((Number(stats?.used_bytes || 0)) / 1024 / 1024 * 100) / 100 };
  }
  const files = await sql`
    SELECT id, nombre, folder, mime_type, size_bytes, created_at
    FROM storage_180 WHERE empresa_id = ${empresaId} AND folder = ${folder}
    ORDER BY created_at DESC
  `;
  return { total: files.length, archivos: files };
}

// ============================
// AUDITORÍA
// ============================

async function consultarAuditLog({ empleado_id, accion, fecha_desde, fecha_hasta, limite }, empresaId) {
  const lim = limite || 20;
  const rows = await sql`
    SELECT a.*, e.nombre as empleado_nombre
    FROM audit_log_180 a
    LEFT JOIN employees_180 e ON e.id = a.empleado_id
    WHERE a.empresa_id = ${empresaId}
      ${empleado_id ? sql`AND a.empleado_id = ${empleado_id}::uuid` : sql``}
      ${accion ? sql`AND a.accion = ${accion}` : sql``}
      ${fecha_desde ? sql`AND a.created_at >= ${fecha_desde}::timestamptz` : sql``}
      ${fecha_hasta ? sql`AND a.created_at <= ${fecha_hasta}::timestamptz + interval '1 day'` : sql``}
    ORDER BY a.created_at DESC LIMIT ${lim}
  `;
  return { total: rows.length, logs: rows };
}

async function consultarEstadisticasAudit(args, empresaId) {
  const porAccion = await sql`
    SELECT accion, COUNT(*)::int as total
    FROM audit_log_180 WHERE empresa_id = ${empresaId} AND created_at >= NOW() - INTERVAL '30 days'
    GROUP BY accion ORDER BY total DESC
  `;
  const porEmpleado = await sql`
    SELECT e.nombre, COUNT(*)::int as total_rechazados
    FROM audit_log_180 a JOIN employees_180 e ON e.id = a.empleado_id
    WHERE a.empresa_id = ${empresaId} AND a.accion = 'fichaje_rechazado' AND a.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY e.nombre ORDER BY total_rechazados DESC LIMIT 10
  `;
  const porDia = await sql`
    SELECT DATE(created_at)::text as fecha, COUNT(*)::int as total
    FROM audit_log_180 WHERE empresa_id = ${empresaId} AND created_at >= NOW() - INTERVAL '7 days'
    GROUP BY DATE(created_at) ORDER BY fecha DESC
  `;
  return { por_accion: porAccion, empleados_mas_rechazos: porEmpleado, actividad_diaria: porDia };
}

// ============================
// REPORTES AVANZADOS
// ============================

async function reporteRentabilidad({ fecha_inicio, fecha_fin, por }, empresaId) {
  const agrupacion = por || "global";

  // Ingresos (facturas validadas)
  const ingresos = await sql`
    SELECT ${agrupacion === 'cliente' ? sql`c.nombre as grupo` : sql`'Total' as grupo`},
      SUM(f.total)::numeric(12,2) as total_facturado,
      COUNT(*)::int as num_facturas
    FROM factura_180 f
    LEFT JOIN clients_180 c ON f.cliente_id = c.id
    WHERE f.empresa_id = ${empresaId} AND f.estado = 'VALIDADA'
      AND f.fecha >= ${fecha_inicio}::date AND f.fecha <= ${fecha_fin}::date
    ${agrupacion === 'cliente' ? sql`GROUP BY c.nombre` : sql`GROUP BY 1`}
    ORDER BY total_facturado DESC
  `;

  // Gastos
  const gastos = await sql`
    SELECT SUM(total)::numeric(12,2) as total_gastos, COUNT(*)::int as num_gastos
    FROM purchases_180
    WHERE empresa_id = ${empresaId} AND activo = true
      AND fecha_compra >= ${fecha_inicio}::date AND fecha_compra <= ${fecha_fin}::date
  `;

  // Nóminas
  const nominas = await sql`
    SELECT SUM(bruto)::numeric(12,2) as total_nominas
    FROM nominas_180
    WHERE empresa_id = ${empresaId}
      AND (anio * 100 + mes) >= ${parseInt(fecha_inicio.substring(0,4)) * 100 + parseInt(fecha_inicio.substring(5,7))}
      AND (anio * 100 + mes) <= ${parseInt(fecha_fin.substring(0,4)) * 100 + parseInt(fecha_fin.substring(5,7))}
  `;

  const totalIngreso = ingresos.reduce((s, r) => s + Number(r.total_facturado || 0), 0);
  const totalGasto = Number(gastos[0]?.total_gastos || 0);
  const totalNomina = Number(nominas[0]?.total_nominas || 0);

  return {
    periodo: `${fecha_inicio} — ${fecha_fin}`,
    ingresos: agrupacion === 'cliente' ? ingresos : totalIngreso,
    total_gastos: totalGasto,
    total_nominas: totalNomina,
    beneficio_bruto: Math.round((totalIngreso - totalGasto) * 100) / 100,
    beneficio_neto: Math.round((totalIngreso - totalGasto - totalNomina) * 100) / 100,
    margen_pct: totalIngreso > 0 ? Math.round((totalIngreso - totalGasto - totalNomina) / totalIngreso * 10000) / 100 : 0
  };
}

// ============================
// MODELOS FISCALES
// ============================

async function calcularModeloFiscal({ modelo, trimestre, anio }, empresaId) {
  const t = Number(trimestre);
  const mesInicio = (t - 1) * 3 + 1;
  const mesFin = t * 3;
  const fechaInicio = `${anio}-${String(mesInicio).padStart(2, '0')}-01`;
  const fechaFin = `${anio}-${String(mesFin).padStart(2, '0')}-${mesFin === 2 ? 28 : (mesFin % 2 === 0 && mesFin <= 6 || mesFin % 2 === 1 && mesFin > 6) ? 30 : 31}`;

  if (modelo === "303") {
    // IVA: repercutido (facturas emitidas) - soportado (gastos)
    const [repercutido] = await sql`
      SELECT COALESCE(SUM(iva_total), 0)::numeric(12,2) as iva_repercutido,
        COALESCE(SUM(subtotal), 0)::numeric(12,2) as base_imponible_ventas,
        COUNT(*)::int as num_facturas
      FROM factura_180
      WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
        AND fecha >= ${fechaInicio}::date AND fecha <= ${fechaFin}::date
    `;
    const [soportado] = await sql`
      SELECT COALESCE(SUM(iva_importe), 0)::numeric(12,2) as iva_soportado,
        COALESCE(SUM(base_imponible), 0)::numeric(12,2) as base_imponible_gastos,
        COUNT(*)::int as num_gastos
      FROM purchases_180
      WHERE empresa_id = ${empresaId} AND activo = true AND iva_porcentaje > 0
        AND fecha_compra >= ${fechaInicio}::date AND fecha_compra <= ${fechaFin}::date
    `;
    const resultado = Number(repercutido.iva_repercutido) - Number(soportado.iva_soportado);
    return {
      modelo: "303", trimestre: t, anio,
      iva_repercutido: Number(repercutido.iva_repercutido),
      base_ventas: Number(repercutido.base_imponible_ventas),
      num_facturas: repercutido.num_facturas,
      iva_soportado: Number(soportado.iva_soportado),
      base_gastos: Number(soportado.base_imponible_gastos),
      num_gastos: soportado.num_gastos,
      resultado: Math.round(resultado * 100) / 100,
      a_pagar: resultado > 0,
      nota: "BORRADOR - Debe ser revisado por un asesor fiscal antes de presentar."
    };
  }

  if (modelo === "130") {
    // IRPF autónomos: (ingresos - gastos) * 20%
    const [ingresos] = await sql`
      SELECT COALESCE(SUM(total), 0)::numeric(12,2) as total_ingresos
      FROM factura_180 WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
        AND fecha >= ${fechaInicio}::date AND fecha <= ${fechaFin}::date
    `;
    const [gastos] = await sql`
      SELECT COALESCE(SUM(total), 0)::numeric(12,2) as total_gastos
      FROM purchases_180 WHERE empresa_id = ${empresaId} AND activo = true
        AND fecha_compra >= ${fechaInicio}::date AND fecha_compra <= ${fechaFin}::date
    `;
    const rendimiento = Number(ingresos.total_ingresos) - Number(gastos.total_gastos);
    const pago = Math.max(0, rendimiento * 0.20);
    return {
      modelo: "130", trimestre: t, anio,
      ingresos: Number(ingresos.total_ingresos),
      gastos: Number(gastos.total_gastos),
      rendimiento_neto: Math.round(rendimiento * 100) / 100,
      porcentaje: 20,
      pago_fraccionado: Math.round(pago * 100) / 100,
      nota: "BORRADOR - Debe ser revisado por un asesor fiscal antes de presentar."
    };
  }

  if (modelo === "111") {
    // Retenciones IRPF nóminas
    const [datos] = await sql`
      SELECT COALESCE(SUM(irpf_retencion), 0)::numeric(12,2) as total_retenciones,
        COALESCE(SUM(bruto), 0)::numeric(12,2) as total_bruto,
        COUNT(*)::int as num_nominas
      FROM nominas_180
      WHERE empresa_id = ${empresaId} AND anio = ${anio} AND mes >= ${mesInicio} AND mes <= ${mesFin}
    `;
    return {
      modelo: "111", trimestre: t, anio,
      total_retenciones: Number(datos.total_retenciones),
      total_bruto: Number(datos.total_bruto),
      num_nominas: datos.num_nominas,
      a_ingresar: Number(datos.total_retenciones),
      nota: "BORRADOR - Debe ser revisado por un asesor fiscal antes de presentar."
    };
  }

  if (modelo === "115") {
    // Retenciones por alquileres
    const rows = await sql`
      SELECT COALESCE(SUM(total), 0)::numeric(12,2) as total_alquileres,
        COALESCE(SUM(irpf_retencion), 0)::numeric(12,2) as total_retenciones,
        COUNT(*)::int as num_gastos
      FROM purchases_180
      WHERE empresa_id = ${empresaId} AND activo = true
        AND LOWER(categoria) IN ('alquiler', 'arrendamiento', 'local', 'oficina')
        AND fecha_compra >= ${fechaInicio}::date AND fecha_compra <= ${fechaFin}::date
    `;
    return {
      modelo: "115", trimestre: t, anio,
      total_alquileres: Number(rows.total_alquileres),
      total_retenciones: Number(rows.total_retenciones),
      num_gastos: rows.num_gastos,
      a_ingresar: Number(rows.total_retenciones),
      nota: "BORRADOR - Solo incluye gastos con categoría alquiler/arrendamiento. Revisar con asesor fiscal."
    };
  }

  if (modelo === "349") {
    // Operaciones intracomunitarias
    const ventas = await sql`
      SELECT c.nombre as cliente, c.nif_cif, COALESCE(SUM(f.total), 0)::numeric(12,2) as total
      FROM factura_180 f
      LEFT JOIN clients_180 c ON f.cliente_id = c.id
      LEFT JOIN client_fiscal_data_180 cfd ON cfd.cliente_id = c.id
      WHERE f.empresa_id = ${empresaId} AND f.estado = 'VALIDADA'
        AND f.fecha >= ${fechaInicio}::date AND f.fecha <= ${fechaFin}::date
        AND ((cfd.pais IS NOT NULL AND cfd.pais != '' AND cfd.pais != 'ES') OR (c.pais IS NOT NULL AND c.pais != '' AND c.pais != 'ES'))
      GROUP BY c.id, c.nombre, c.nif_cif
    `;
    const [totales] = await sql`
      SELECT COALESCE(SUM(f.total), 0)::numeric(12,2) as total_intracomunitario
      FROM factura_180 f
      LEFT JOIN clients_180 c ON f.cliente_id = c.id
      LEFT JOIN client_fiscal_data_180 cfd ON cfd.cliente_id = c.id
      WHERE f.empresa_id = ${empresaId} AND f.estado = 'VALIDADA'
        AND f.fecha >= ${fechaInicio}::date AND f.fecha <= ${fechaFin}::date
        AND ((cfd.pais IS NOT NULL AND cfd.pais != '' AND cfd.pais != 'ES') OR (c.pais IS NOT NULL AND c.pais != '' AND c.pais != 'ES'))
    `;
    return {
      modelo: "349", trimestre: t, anio,
      total_intracomunitario: Number(totales.total_intracomunitario),
      operaciones: ventas,
      num_clientes: ventas.length,
      nota: "BORRADOR - Solo detecta clientes con flag intracomunitario o país != ES. Revisar con asesor fiscal."
    };
  }

  return { error: `Modelo ${modelo} no soportado. Modelos disponibles: 303, 130, 111, 115, 349.` };
}

// ============================
// BANCO - MATCHING
// ============================

async function consultarMovimientosBanco({ estado_match, fecha_inicio, fecha_fin, limite }, empresaId) {
  const lim = limite || 30;
  const rows = await sql`
    SELECT bt.*, f.numero as factura_numero, f.total as factura_total
    FROM bank_transactions_180 bt
    LEFT JOIN factura_180 f ON bt.factura_id = f.id
    WHERE bt.empresa_id = ${empresaId}
      ${estado_match && estado_match !== 'todos' ? sql`AND bt.estado_match = ${estado_match}` : sql``}
      ${fecha_inicio ? sql`AND bt.fecha >= ${fecha_inicio}::date` : sql``}
      ${fecha_fin ? sql`AND bt.fecha <= ${fecha_fin}::date` : sql``}
    ORDER BY bt.fecha DESC LIMIT ${lim}
  `;
  const [stats] = await sql`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE estado_match = 'pendiente')::int as pendientes,
      COUNT(*) FILTER (WHERE estado_match = 'matched')::int as matched
    FROM bank_transactions_180 WHERE empresa_id = ${empresaId}
  `;
  return { movimientos: rows, estadisticas: stats };
}

async function matchPagoBanco({ bank_transaction_id, factura_id }, empresaId) {
  // Obtener movimiento bancario
  const [tx] = await sql`SELECT * FROM bank_transactions_180 WHERE id = ${bank_transaction_id} AND empresa_id = ${empresaId}`;
  if (!tx) return { error: "Movimiento bancario no encontrado" };

  // Obtener factura
  const [factura] = await sql`SELECT * FROM factura_180 WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;
  if (!factura) return { error: "Factura no encontrada" };

  // Calcular confianza
  let confianza = 0;
  const importe = Math.abs(tx.importe);
  if (Math.abs(importe - Number(factura.total)) < 0.01) confianza += 0.40;
  else if (Math.abs(importe - Number(factura.total)) < 1) confianza += 0.20;
  if (tx.concepto?.includes(factura.numero)) confianza += 0.40;
  const diasDiff = Math.abs((new Date(tx.fecha) - new Date(factura.fecha)) / 86400000);
  if (diasDiff <= 30) confianza += 0.10;
  if (diasDiff <= 7) confianza += 0.10;

  // Crear pago
  const [pago] = await sql`
    INSERT INTO payments_180 (empresa_id, factura_id, monto, fecha, metodo, notas)
    VALUES (${empresaId}, ${factura_id}, ${importe}, ${tx.fecha}, 'transferencia', ${'Match bancario automático: ' + tx.concepto})
    RETURNING id
  `;

  // Actualizar estado factura
  const pagado = Number(factura.pagado || 0) + importe;
  const nuevoEstado = pagado >= Number(factura.total) ? 'pagado' : 'parcial';
  await sql`UPDATE factura_180 SET pagado = ${pagado}, estado_pago = ${nuevoEstado} WHERE id = ${factura_id}`;

  // Actualizar movimiento bancario
  await sql`
    UPDATE bank_transactions_180
    SET estado_match = 'matched', factura_id = ${factura_id}, payment_id = ${pago.id},
        confianza_match = ${Math.round(confianza * 100) / 100},
        match_detalles = ${JSON.stringify({ factura_numero: factura.numero, importe_factura: factura.total, dias_diferencia: diasDiff })}
    WHERE id = ${bank_transaction_id}
  `;

  return {
    success: true,
    pago_id: pago.id,
    factura_numero: factura.numero,
    importe: importe,
    confianza: Math.round(confianza * 100),
    estado_factura: nuevoEstado
  };
}

async function sugerirMatchesBanco(args, empresaId) {
  // Obtener movimientos pendientes (ingresos = importe > 0)
  const pendientes = await sql`
    SELECT * FROM bank_transactions_180
    WHERE empresa_id = ${empresaId} AND estado_match = 'pendiente' AND importe > 0
    ORDER BY fecha DESC LIMIT 50
  `;

  // Obtener facturas pendientes de cobro
  const facturasPendientes = await sql`
    SELECT f.id, f.numero, f.total, f.pagado, f.fecha, c.nombre as cliente_nombre
    FROM factura_180 f
    LEFT JOIN clients_180 c ON f.cliente_id = c.id
    WHERE f.empresa_id = ${empresaId} AND f.estado = 'VALIDADA' AND f.estado_pago != 'pagado'
    ORDER BY f.fecha DESC LIMIT 100
  `;

  const sugerencias = [];

  for (const tx of pendientes) {
    const importe = Number(tx.importe);
    let bestMatch = null;
    let bestConfianza = 0;

    for (const f of facturasPendientes) {
      let confianza = 0;
      const pendiente = Number(f.total) - Number(f.pagado || 0);

      // Factor 1: Importe exacto (40%)
      if (Math.abs(importe - pendiente) < 0.01) confianza += 0.40;
      else if (Math.abs(importe - Number(f.total)) < 0.01) confianza += 0.35;
      else if (Math.abs(importe - pendiente) < 1) confianza += 0.15;

      // Factor 2: Número de factura en concepto (40%)
      if (f.numero && tx.concepto?.toUpperCase().includes(f.numero)) confianza += 0.40;

      // Factor 3: Nombre cliente en concepto (10%)
      if (f.cliente_nombre && tx.concepto?.toUpperCase().includes(f.cliente_nombre.toUpperCase())) confianza += 0.10;

      // Factor 4: Proximidad temporal (10%)
      const diasDiff = Math.abs((new Date(tx.fecha) - new Date(f.fecha)) / 86400000);
      if (diasDiff <= 7) confianza += 0.10;
      else if (diasDiff <= 30) confianza += 0.05;

      if (confianza > bestConfianza) {
        bestConfianza = confianza;
        bestMatch = { factura_id: f.id, factura_numero: f.numero, factura_total: f.total, cliente: f.cliente_nombre, pendiente };
      }
    }

    if (bestMatch && bestConfianza >= 0.30) {
      sugerencias.push({
        bank_tx_id: tx.id,
        fecha: tx.fecha,
        importe: importe,
        concepto: tx.concepto,
        match: bestMatch,
        confianza: Math.round(bestConfianza * 100),
        accion_recomendada: bestConfianza >= 0.85 ? "automatico" : bestConfianza >= 0.50 ? "revisar" : "manual"
      });
    }
  }

  return {
    total_pendientes: pendientes.length,
    sugerencias: sugerencias.length,
    matches: sugerencias.sort((a, b) => b.confianza - a.confianza)
  };
}

// ============================
// FASE 2: HERRAMIENTAS ADICIONALES
// ============================

async function crearExcepcionJornada({ plantilla_id, fecha, hora_inicio, hora_fin, nota, activo }, empresaId) {
  // Verificar que la plantilla pertenece a la empresa
  const [plantilla] = await sql`
    SELECT id, nombre FROM plantillas_jornada_180
    WHERE id = ${plantilla_id} AND empresa_id = ${empresaId}
  `;
  if (!plantilla) return { error: "Plantilla no encontrada" };

  const esActivo = activo !== false;
  const [exc] = await sql`
    INSERT INTO plantilla_excepciones_180 (plantilla_id, fecha, activo, hora_inicio, hora_fin, nota)
    VALUES (${plantilla_id}, ${fecha}, ${esActivo}, ${hora_inicio || null}, ${hora_fin || null}, ${nota || null})
    RETURNING id, fecha, activo, nota
  `;

  return {
    success: true,
    excepcion: exc,
    plantilla: plantilla.nombre,
    mensaje: esActivo
      ? `Excepción creada para ${fecha}: horario ${hora_inicio || '?'} - ${hora_fin || '?'}`
      : `Día ${fecha} marcado como libre/festivo en plantilla "${plantilla.nombre}"`
  };
}

async function actualizarConfiguracion({ modulos, dashboard_widgets }, empresaId) {
  const updates = {};
  const cambios = [];

  if (modulos) {
    // Leer config actual y merge
    const [cfg] = await sql`SELECT modulos FROM empresa_config_180 WHERE empresa_id = ${empresaId}`;
    const modulosActuales = cfg?.modulos || {};
    const merged = { ...modulosActuales, ...modulos };
    updates.modulos = JSON.stringify(merged);
    cambios.push(`Módulos actualizados: ${Object.entries(modulos).map(([k, v]) => `${k}=${v ? 'ON' : 'OFF'}`).join(', ')}`);
  }

  if (dashboard_widgets) {
    updates.dashboard_widgets = JSON.stringify(dashboard_widgets);
    cambios.push("Widgets del dashboard actualizados");
  }

  if (cambios.length === 0) return { error: "No se proporcionaron datos para actualizar" };

  await sql`
    UPDATE empresa_config_180 SET ${sql(updates, ...Object.keys(updates))}, updated_at = NOW()
    WHERE empresa_id = ${empresaId}
  `;

  return { success: true, cambios };
}

async function eliminarArchivo({ archivo_id }, empresaId) {
  const [file] = await sql`
    SELECT id, nombre, folder FROM storage_180
    WHERE id = ${archivo_id} AND empresa_id = ${empresaId}
  `;
  if (!file) return { error: "Archivo no encontrado" };

  await sql`DELETE FROM storage_180 WHERE id = ${archivo_id} AND empresa_id = ${empresaId}`;

  return { success: true, mensaje: `Archivo "${file.nombre}" eliminado de la carpeta "${file.folder}"` };
}

async function exportarModulo({ modulo, fecha_inicio, fecha_fin, formato }, empresaId) {
  const esDetalle = formato === 'detalle';
  const fi = fecha_inicio || '2000-01-01';
  const ff = fecha_fin || '2099-12-31';

  if (modulo === 'facturas') {
    const rows = await sql`
      SELECT f.numero, f.fecha, f.subtotal, f.iva_total, f.total, f.estado, f.estado_pago,
        c.nombre as cliente
      FROM factura_180 f LEFT JOIN clients_180 c ON f.cliente_id = c.id
      WHERE f.empresa_id = ${empresaId} AND f.fecha >= ${fi}::date AND f.fecha <= ${ff}::date
      ORDER BY f.fecha
    `;
    const [totales] = await sql`
      SELECT COUNT(*)::int as total, COALESCE(SUM(total),0)::numeric(12,2) as importe_total
      FROM factura_180 WHERE empresa_id = ${empresaId} AND fecha >= ${fi}::date AND fecha <= ${ff}::date
    `;
    return { modulo: 'facturas', periodo: `${fi} — ${ff}`, registros: rows.length, totales, datos: esDetalle ? rows : undefined };
  }

  if (modulo === 'clientes') {
    const rows = await sql`
      SELECT codigo, nombre, email, telefono, activo, created_at
      FROM clients_180 WHERE empresa_id = ${empresaId} ORDER BY nombre
    `;
    return { modulo: 'clientes', total: rows.length, datos: esDetalle ? rows : undefined };
  }

  if (modulo === 'empleados') {
    const rows = await sql`
      SELECT nombre, email, puesto, activo, created_at
      FROM employees_180 WHERE empresa_id = ${empresaId} ORDER BY nombre
    `;
    return { modulo: 'empleados', total: rows.length, datos: esDetalle ? rows : undefined };
  }

  if (modulo === 'gastos') {
    const rows = await sql`
      SELECT concepto, proveedor, fecha_compra, base_imponible, iva_porcentaje, iva_importe, total, categoria
      FROM purchases_180 WHERE empresa_id = ${empresaId} AND activo = true
        AND fecha_compra >= ${fi}::date AND fecha_compra <= ${ff}::date
      ORDER BY fecha_compra
    `;
    const [totales] = await sql`
      SELECT COUNT(*)::int as total, COALESCE(SUM(total),0)::numeric(12,2) as importe_total
      FROM purchases_180 WHERE empresa_id = ${empresaId} AND activo = true
        AND fecha_compra >= ${fi}::date AND fecha_compra <= ${ff}::date
    `;
    return { modulo: 'gastos', periodo: `${fi} — ${ff}`, registros: rows.length, totales, datos: esDetalle ? rows : undefined };
  }

  if (modulo === 'nominas') {
    const rows = await sql`
      SELECT n.anio, n.mes, e.nombre as empleado, n.bruto, n.irpf_retencion, n.ss_empleado, n.neto
      FROM nominas_180 n LEFT JOIN employees_180 e ON n.empleado_id = e.id
      WHERE n.empresa_id = ${empresaId} ORDER BY n.anio DESC, n.mes DESC
    `;
    return { modulo: 'nominas', total: rows.length, datos: esDetalle ? rows : undefined };
  }

  if (modulo === 'pagos') {
    const rows = await sql`
      SELECT p.fecha, p.monto, p.metodo, f.numero as factura, c.nombre as cliente
      FROM payments_180 p
      LEFT JOIN factura_180 f ON p.factura_id = f.id
      LEFT JOIN clients_180 c ON f.cliente_id = c.id
      WHERE p.empresa_id = ${empresaId} AND p.fecha >= ${fi}::date AND p.fecha <= ${ff}::date
      ORDER BY p.fecha DESC
    `;
    const [totales] = await sql`
      SELECT COUNT(*)::int as total, COALESCE(SUM(monto),0)::numeric(12,2) as importe_total
      FROM payments_180 WHERE empresa_id = ${empresaId} AND fecha >= ${fi}::date AND fecha <= ${ff}::date
    `;
    return { modulo: 'pagos', periodo: `${fi} — ${ff}`, registros: rows.length, totales, datos: esDetalle ? rows : undefined };
  }

  if (modulo === 'trabajos') {
    const rows = await sql`
      SELECT w.fecha, w.descripcion, w.horas, w.precio_hora, w.total, w.facturado,
        c.nombre as cliente, e.nombre as empleado
      FROM worklogs_180 w
      LEFT JOIN clients_180 c ON w.cliente_id = c.id
      LEFT JOIN employees_180 e ON w.empleado_id = e.id
      WHERE w.empresa_id = ${empresaId} AND w.fecha >= ${fi}::date AND w.fecha <= ${ff}::date
      ORDER BY w.fecha DESC
    `;
    return { modulo: 'trabajos', periodo: `${fi} — ${ff}`, registros: rows.length, datos: esDetalle ? rows : undefined };
  }

  return { error: `Módulo "${modulo}" no disponible. Módulos: facturas, clientes, empleados, gastos, nominas, pagos, trabajos` };
}

async function reporteDesviacion({ agrupacion, fecha_inicio, fecha_fin }, empresaId) {
  const grupo = agrupacion || 'cliente';
  const fi = fecha_inicio || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const ff = fecha_fin || new Date().toISOString().split('T')[0];

  if (grupo === 'cliente') {
    const rows = await sql`
      SELECT c.nombre as cliente,
        COALESCE(SUM(w.horas), 0)::numeric(10,2) as horas_reales,
        COUNT(DISTINCT w.id)::int as num_trabajos,
        COALESCE(SUM(w.total), 0)::numeric(12,2) as importe_trabajos,
        COALESCE(SUM(f_totals.total_facturado), 0)::numeric(12,2) as total_facturado
      FROM clients_180 c
      LEFT JOIN worklogs_180 w ON w.cliente_id = c.id AND w.empresa_id = ${empresaId}
        AND w.fecha >= ${fi}::date AND w.fecha <= ${ff}::date
      LEFT JOIN LATERAL (
        SELECT SUM(f.total) as total_facturado
        FROM factura_180 f WHERE f.cliente_id = c.id AND f.empresa_id = ${empresaId}
          AND f.fecha >= ${fi}::date AND f.fecha <= ${ff}::date AND f.estado = 'VALIDADA'
      ) f_totals ON true
      WHERE c.empresa_id = ${empresaId} AND c.activo = true
      GROUP BY c.id, c.nombre
      HAVING SUM(w.horas) > 0 OR SUM(f_totals.total_facturado) > 0
      ORDER BY horas_reales DESC
    `;
    return { agrupacion: 'cliente', periodo: `${fi} — ${ff}`, datos: rows };
  }

  if (grupo === 'empleado') {
    const rows = await sql`
      SELECT e.nombre as empleado,
        COALESCE(SUM(w.horas), 0)::numeric(10,2) as horas_trabajadas,
        COUNT(DISTINCT w.id)::int as num_trabajos,
        COALESCE(SUM(w.total), 0)::numeric(12,2) as importe_generado,
        COALESCE(SUM(pd.horas_trabajadas), 0)::numeric(10,2) as horas_partes_dia
      FROM employees_180 e
      LEFT JOIN worklogs_180 w ON w.empleado_id = e.id AND w.empresa_id = ${empresaId}
        AND w.fecha >= ${fi}::date AND w.fecha <= ${ff}::date
      LEFT JOIN partes_dia_180 pd ON pd.empleado_id = e.id AND pd.empresa_id = ${empresaId}
        AND pd.fecha >= ${fi}::date AND pd.fecha <= ${ff}::date
      WHERE e.empresa_id = ${empresaId} AND e.activo = true
      GROUP BY e.id, e.nombre
      HAVING SUM(w.horas) > 0 OR SUM(pd.horas_trabajadas) > 0
      ORDER BY horas_trabajadas DESC
    `;
    return { agrupacion: 'empleado', periodo: `${fi} — ${ff}`, datos: rows };
  }

  return { error: "Agrupación no válida. Usa: cliente o empleado" };
}

// ============================
// FASE 3: LIBROS Y MODELOS FISCALES
// ============================

async function consultarModelosFiscales({ modelo, anio, trimestre }, empresaId) {
  const rows = await sql`
    SELECT id, modelo, trimestre, anio, datos, estado, notas, created_at
    FROM modelos_fiscales_180
    WHERE empresa_id = ${empresaId}
      ${modelo ? sql`AND modelo = ${modelo}` : sql``}
      ${anio ? sql`AND anio = ${Number(anio)}` : sql``}
      ${trimestre ? sql`AND trimestre = ${Number(trimestre)}` : sql``}
    ORDER BY anio DESC, trimestre DESC, modelo
  `;
  return { total: rows.length, modelos: rows };
}

function resolverFechasFiscales(args) {
  let fi, ff;
  if (args.trimestre && args.anio) {
    const t = Number(args.trimestre);
    const mesInicio = (t - 1) * 3 + 1;
    const mesFin = t * 3;
    fi = `${args.anio}-${String(mesInicio).padStart(2, '0')}-01`;
    const ultimoDia = new Date(args.anio, mesFin, 0).getDate();
    ff = `${args.anio}-${String(mesFin).padStart(2, '0')}-${ultimoDia}`;
  } else {
    fi = args.fecha_inicio || `${new Date().getFullYear()}-01-01`;
    ff = args.fecha_fin || new Date().toISOString().split('T')[0];
  }
  return { fi, ff };
}

async function consultarLibroVentas(args, empresaId) {
  const { fi, ff } = resolverFechasFiscales(args);
  const rows = await sql`
    SELECT f.numero, f.fecha, c.nombre as cliente, c.nif_cif as nif_cliente,
      f.subtotal as base_imponible, f.iva_porcentaje, f.iva_total, f.total,
      f.estado, f.estado_pago
    FROM factura_180 f
    LEFT JOIN clients_180 c ON f.cliente_id = c.id
    WHERE f.empresa_id = ${empresaId} AND f.estado = 'VALIDADA'
      AND f.fecha >= ${fi}::date AND f.fecha <= ${ff}::date
    ORDER BY f.fecha, f.numero
  `;
  const [totales] = await sql`
    SELECT COUNT(*)::int as num_facturas,
      COALESCE(SUM(subtotal), 0)::numeric(12,2) as total_base,
      COALESCE(SUM(iva_total), 0)::numeric(12,2) as total_iva,
      COALESCE(SUM(total), 0)::numeric(12,2) as total_facturado
    FROM factura_180
    WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
      AND fecha >= ${fi}::date AND fecha <= ${ff}::date
  `;
  return { libro: "ventas", periodo: `${fi} — ${ff}`, totales, registros: rows };
}

async function consultarLibroGastos(args, empresaId) {
  const { fi, ff } = resolverFechasFiscales(args);
  const rows = await sql`
    SELECT p.numero_factura, p.fecha_compra as fecha, p.proveedor, p.nif_proveedor,
      p.base_imponible, p.iva_porcentaje, p.iva_importe, p.total,
      p.concepto, p.categoria
    FROM purchases_180 p
    WHERE p.empresa_id = ${empresaId} AND p.activo = true
      AND p.fecha_compra >= ${fi}::date AND p.fecha_compra <= ${ff}::date
    ORDER BY p.fecha_compra, p.numero_factura
  `;
  const [totales] = await sql`
    SELECT COUNT(*)::int as num_gastos,
      COALESCE(SUM(base_imponible), 0)::numeric(12,2) as total_base,
      COALESCE(SUM(iva_importe), 0)::numeric(12,2) as total_iva,
      COALESCE(SUM(total), 0)::numeric(12,2) as total_gastos
    FROM purchases_180
    WHERE empresa_id = ${empresaId} AND activo = true
      AND fecha_compra >= ${fi}::date AND fecha_compra <= ${ff}::date
  `;
  return { libro: "gastos", periodo: `${fi} — ${ff}`, totales, registros: rows };
}

async function consultarLibroNominas({ anio, mes, trimestre }, empresaId) {
  let mesInicio, mesFin;
  if (trimestre) {
    mesInicio = (Number(trimestre) - 1) * 3 + 1;
    mesFin = Number(trimestre) * 3;
  } else if (mes) {
    mesInicio = Number(mes);
    mesFin = Number(mes);
  } else {
    mesInicio = 1;
    mesFin = 12;
  }

  const rows = await sql`
    SELECT n.mes, n.anio, e.nombre as empleado, e.nif_nie,
      n.bruto, n.irpf_retencion, n.ss_empleado, n.ss_empresa, n.neto,
      n.horas_extra, n.complementos
    FROM nominas_180 n
    LEFT JOIN employees_180 e ON n.empleado_id = e.id
    WHERE n.empresa_id = ${empresaId} AND n.anio = ${Number(anio)}
      AND n.mes >= ${mesInicio} AND n.mes <= ${mesFin}
    ORDER BY n.mes, e.nombre
  `;
  const [totales] = await sql`
    SELECT COUNT(*)::int as num_nominas,
      COALESCE(SUM(bruto), 0)::numeric(12,2) as total_bruto,
      COALESCE(SUM(irpf_retencion), 0)::numeric(12,2) as total_irpf,
      COALESCE(SUM(ss_empleado), 0)::numeric(12,2) as total_ss_empleado,
      COALESCE(SUM(ss_empresa), 0)::numeric(12,2) as total_ss_empresa,
      COALESCE(SUM(neto), 0)::numeric(12,2) as total_neto
    FROM nominas_180
    WHERE empresa_id = ${empresaId} AND anio = ${Number(anio)}
      AND mes >= ${mesInicio} AND mes <= ${mesFin}
  `;
  return { libro: "nominas", anio, periodo_meses: `${mesInicio}-${mesFin}`, totales, registros: rows };
}

async function alertasFiscales(args, empresaId) {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth() + 1;
  const trimActual = Math.ceil(mes / 3);

  const alertas = [];

  // Plazos de presentación de modelos (España)
  const plazos = [
    { modelo: "303", desc: "IVA trimestral", dia_limite: 20 },
    { modelo: "130", desc: "IRPF autónomos", dia_limite: 20 },
    { modelo: "111", desc: "Retenciones IRPF nóminas", dia_limite: 20 },
    { modelo: "115", desc: "Retenciones alquileres", dia_limite: 20 },
  ];

  // Comprobar si estamos en mes de presentación (abril, julio, octubre, enero)
  const mesesPresentacion = [1, 4, 7, 10];
  const esMesPresentacion = mesesPresentacion.includes(mes);
  const trimPresentar = mes === 1 ? 4 : trimActual - 1;
  const anioPresentar = mes === 1 ? anio - 1 : anio;

  if (esMesPresentacion) {
    // Verificar qué modelos ya se calcularon
    const calculados = await sql`
      SELECT modelo FROM modelos_fiscales_180
      WHERE empresa_id = ${empresaId} AND trimestre = ${trimPresentar} AND anio = ${anioPresentar}
    `;
    const modelosCalculados = new Set(calculados.map(r => r.modelo));

    for (const p of plazos) {
      const plazoFecha = new Date(anio, mes - 1, p.dia_limite);
      const diasRestantes = Math.ceil((plazoFecha - hoy) / 86400000);

      if (diasRestantes > 0) {
        alertas.push({
          tipo: "plazo",
          urgencia: diasRestantes <= 5 ? "URGENTE" : diasRestantes <= 10 ? "PRONTO" : "OK",
          modelo: p.modelo,
          descripcion: p.desc,
          trimestre: `T${trimPresentar} ${anioPresentar}`,
          fecha_limite: plazoFecha.toISOString().split('T')[0],
          dias_restantes: diasRestantes,
          calculado: modelosCalculados.has(p.modelo)
        });
      }
    }
  }

  // Verificar facturas sin IVA (posible error)
  const [sinIva] = await sql`
    SELECT COUNT(*)::int as total
    FROM factura_180
    WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
      AND (iva_porcentaje IS NULL OR iva_porcentaje = 0)
      AND fecha >= ${anio + '-01-01'}::date
  `;
  if (sinIva.total > 0) {
    alertas.push({
      tipo: "advertencia",
      urgencia: "REVISAR",
      descripcion: `${sinIva.total} facturas validadas sin IVA en ${anio}. Verificar si es correcto (exenciones, intracomunitarias).`
    });
  }

  // Verificar gastos sin factura (sin número)
  const [sinFactura] = await sql`
    SELECT COUNT(*)::int as total
    FROM purchases_180
    WHERE empresa_id = ${empresaId} AND activo = true
      AND (numero_factura IS NULL OR numero_factura = '')
      AND fecha_compra >= ${anio + '-01-01'}::date
  `;
  if (sinFactura.total > 0) {
    alertas.push({
      tipo: "advertencia",
      urgencia: "REVISAR",
      descripcion: `${sinFactura.total} gastos sin número de factura en ${anio}. Sin factura no son deducibles fiscalmente.`
    });
  }

  return {
    fecha: hoy.toISOString().split('T')[0],
    trimestre_actual: `T${trimActual} ${anio}`,
    es_mes_presentacion: esMesPresentacion,
    alertas
  };
}

// ============================
// DECLARACIÓN DE LA RENTA
// ============================

async function consultarRentaHistorica(args, empresaId) {
  const { ejercicio } = args;

  if (ejercicio) {
    const [renta] = await sql`
      SELECT * FROM renta_historica_180
      WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio}
    `;
    if (!renta) return { mensaje: `No hay renta importada para el ejercicio ${ejercicio}. El usuario puede importar el PDF desde Fiscalidad > Declaración Renta.` };

    return {
      ejercicio: renta.ejercicio,
      tipo_declaracion: renta.tipo_declaracion,
      resultado: parseFloat(renta.resultado_declaracion),
      resultado_texto: parseFloat(renta.resultado_declaracion) >= 0 ? 'A ingresar' : 'A devolver',
      casillas_clave: {
        rendimientos_trabajo: parseFloat(renta.rendimientos_trabajo),
        rendimientos_actividades: parseFloat(renta.rendimientos_actividades),
        rendimientos_capital_inmob: parseFloat(renta.rendimientos_capital_inmob),
        rendimientos_capital_mob: parseFloat(renta.rendimientos_capital_mob),
        base_imponible_general: parseFloat(renta.casilla_505),
        base_imponible_ahorro: parseFloat(renta.casilla_510),
        cuota_integra_estatal: parseFloat(renta.casilla_595),
        cuota_integra_autonomica: parseFloat(renta.casilla_600),
        cuota_liquida: parseFloat(renta.casilla_610),
        deducciones: parseFloat(renta.casilla_611),
      },
      retenciones: {
        trabajo: parseFloat(renta.retenciones_trabajo),
        actividades: parseFloat(renta.retenciones_actividades),
        pagos_fraccionados: parseFloat(renta.pagos_fraccionados),
      },
      confianza_extraccion: parseFloat(renta.confianza_extraccion),
      pdf: renta.pdf_nombre_archivo || null
    };
  }

  // Lista todas
  const rentas = await sql`
    SELECT ejercicio, tipo_declaracion, resultado_declaracion, casilla_505, casilla_610,
           rendimientos_trabajo, rendimientos_actividades, confianza_extraccion, pdf_nombre_archivo
    FROM renta_historica_180
    WHERE empresa_id = ${empresaId}
    ORDER BY ejercicio DESC
  `;

  if (rentas.length === 0) return { mensaje: "No hay rentas importadas. El usuario puede importar PDFs de rentas anteriores desde Fiscalidad > Declaración Renta." };

  return {
    total: rentas.length,
    rentas: rentas.map(r => ({
      ejercicio: r.ejercicio,
      tipo: r.tipo_declaracion,
      resultado: parseFloat(r.resultado_declaracion),
      base_imponible: parseFloat(r.casilla_505),
      cuota_liquida: parseFloat(r.casilla_610),
      confianza: parseFloat(r.confianza_extraccion),
    }))
  };
}

async function consultarDatosPersonalesRenta(args, empresaId) {
  const [datos] = await sql`
    SELECT * FROM renta_datos_personales_180 WHERE empresa_id = ${empresaId}
  `;

  if (!datos) return { mensaje: "No hay datos personales guardados para la renta. El usuario puede completarlos en Fiscalidad > Declaración Renta > Datos Personales." };

  return {
    declarante: {
      estado_civil: datos.estado_civil,
      fecha_nacimiento: datos.fecha_nacimiento,
      discapacidad: datos.discapacidad_porcentaje + '%',
    },
    conyuge: datos.conyuge_nif ? {
      nif: datos.conyuge_nif,
      nombre: datos.conyuge_nombre,
      rendimientos: parseFloat(datos.conyuge_rendimientos),
    } : null,
    descendientes: datos.descendientes || [],
    ascendientes: datos.ascendientes || [],
    vivienda: {
      tipo: datos.vivienda_tipo,
      ref_catastral: datos.vivienda_referencia_catastral,
      alquiler_anual: parseFloat(datos.alquiler_anual),
      hipoteca_anual: parseFloat(datos.hipoteca_anual),
    },
    deducciones: {
      plan_pensiones: parseFloat(datos.aportacion_plan_pensiones),
      donaciones_ong: parseFloat(datos.donaciones_ong),
      donaciones_otras: parseFloat(datos.donaciones_otras),
    },
    tipo_declaracion_preferida: datos.tipo_declaracion_preferida,
  };
}

async function generarDossierPrerenta(args, empresaId) {
  const { ejercicio } = args;
  const year = parseInt(ejercicio);

  // Datos personales
  const [datosPersonales] = await sql`
    SELECT * FROM renta_datos_personales_180 WHERE empresa_id = ${empresaId}
  `;

  // Renta anterior
  const [rentaAnterior] = await sql`
    SELECT * FROM renta_historica_180
    WHERE empresa_id = ${empresaId} AND ejercicio = ${year - 1}
  `;

  // Emisor
  const [emisor] = await sql`SELECT * FROM emisor_180 WHERE empresa_id = ${empresaId}`;

  // Facturación del ejercicio
  const [facturacion] = await sql`
    SELECT
      COALESCE(SUM(subtotal), 0) as base_total,
      COALESCE(SUM(iva_total), 0) as iva_total,
      COALESCE(SUM(total), 0) as total,
      COALESCE(SUM(retencion_importe), 0) as retenciones_clientes,
      COUNT(*) as num_facturas
    FROM factura_180
    WHERE empresa_id = ${empresaId}
    AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
    AND EXTRACT(YEAR FROM fecha) = ${year}
  `;

  // Gastos
  const [gastos] = await sql`
    SELECT
      COALESCE(SUM(base_imponible), 0) as base_total,
      COALESCE(SUM(COALESCE(cuota_iva, iva_importe, 0)), 0) as iva_soportado,
      COUNT(*) as num_gastos
    FROM purchases_180
    WHERE empresa_id = ${empresaId}
    AND activo = true
    AND EXTRACT(YEAR FROM fecha_compra) = ${year}
  `;

  // Nóminas
  const [nominas] = await sql`
    SELECT
      COALESCE(SUM(bruto), 0) as bruto_total,
      COALESCE(SUM(irpf_retencion), 0) as irpf_total,
      COALESCE(SUM(seguridad_social_empresa), 0) as ss_empresa
    FROM nominas_180
    WHERE empresa_id = ${empresaId} AND anio = ${year}
  `;

  const ingresos = parseFloat(facturacion.base_total);
  const gastosDeducibles = parseFloat(gastos.base_total) + parseFloat(nominas.bruto_total) + parseFloat(nominas.ss_empresa);
  const rendimientoNeto = ingresos - gastosDeducibles;
  const totalAnticipado = parseFloat(facturacion.retenciones_clientes);

  return {
    ejercicio: year,
    empresa: { nombre: emisor?.nombre || '', nif: emisor?.nif || '' },
    rendimientos_actividades: {
      ingresos,
      gastos_deducibles: gastosDeducibles,
      rendimiento_neto: rendimientoNeto,
      num_facturas: parseInt(facturacion.num_facturas),
      num_gastos: parseInt(gastos.num_gastos),
    },
    retenciones_y_pagos: {
      retenciones_clientes: parseFloat(facturacion.retenciones_clientes),
      total_anticipado: totalAnticipado,
    },
    iva_anual: {
      repercutido: parseFloat(facturacion.iva_total),
      soportado: parseFloat(gastos.iva_soportado),
      diferencia: parseFloat(facturacion.iva_total) - parseFloat(gastos.iva_soportado),
    },
    renta_anterior: rentaAnterior ? {
      ejercicio: rentaAnterior.ejercicio,
      resultado: parseFloat(rentaAnterior.resultado_declaracion),
      base_imponible: parseFloat(rentaAnterior.casilla_505),
    } : null,
    datos_personales: datosPersonales ? {
      estado_civil: datosPersonales.estado_civil,
      descendientes: (datosPersonales.descendientes || []).length,
      plan_pensiones: parseFloat(datosPersonales.aportacion_plan_pensiones),
      tipo_declaracion: datosPersonales.tipo_declaracion_preferida,
    } : null,
    resumen: `Rendimiento neto: ${rendimientoNeto.toFixed(2)}€. Anticipado: ${totalAnticipado.toFixed(2)}€. ${rentaAnterior ? `Renta ${year-1}: ${parseFloat(rentaAnterior.resultado_declaracion).toFixed(2)}€` : 'Sin renta anterior importada.'}`,
    nota: "DOSSIER ORIENTATIVO - Los cálculos definitivos dependen de la legislación vigente, mínimos personales y deducciones aplicables."
  };
}

// ============================
// FASE 4: RECONCILIACIÓN BANCARIA
// ============================

async function reconciliarExtracto({ fecha_inicio, fecha_fin, auto_match }, empresaId) {
  // Obtener movimientos pendientes del periodo
  const movimientos = await sql`
    SELECT * FROM bank_transactions_180
    WHERE empresa_id = ${empresaId} AND estado_match = 'pendiente'
      AND fecha >= ${fecha_inicio}::date AND fecha <= ${fecha_fin}::date
    ORDER BY fecha
  `;

  // Obtener facturas pendientes de cobro
  const facturasPendientes = await sql`
    SELECT f.id, f.numero, f.total, f.pagado, f.fecha, c.nombre as cliente_nombre
    FROM factura_180 f
    LEFT JOIN clients_180 c ON f.cliente_id = c.id
    WHERE f.empresa_id = ${empresaId} AND f.estado = 'VALIDADA' AND f.estado_pago != 'pagado'
  `;

  // Obtener gastos pendientes (para pagos salientes)
  const gastosPendientes = await sql`
    SELECT id, concepto, proveedor, total, fecha_compra
    FROM purchases_180
    WHERE empresa_id = ${empresaId} AND activo = true AND pagado = false
  `;

  const resultados = {
    periodo: `${fecha_inicio} — ${fecha_fin}`,
    total_movimientos: movimientos.length,
    matches_automaticos: [],
    sugerencias_revisar: [],
    sin_match: [],
    ya_matched: 0,
    errores: []
  };

  for (const tx of movimientos) {
    const importe = Number(tx.importe);
    let bestMatch = null;
    let bestConfianza = 0;
    let bestTipo = null;

    // Match con facturas (ingresos: importe > 0)
    if (importe > 0) {
      for (const f of facturasPendientes) {
        let confianza = 0;
        const pendiente = Number(f.total) - Number(f.pagado || 0);

        if (Math.abs(importe - pendiente) < 0.01) confianza += 0.40;
        else if (Math.abs(importe - Number(f.total)) < 0.01) confianza += 0.35;
        if (f.numero && tx.concepto?.toUpperCase().includes(f.numero)) confianza += 0.40;
        if (f.cliente_nombre && tx.concepto?.toUpperCase().includes(f.cliente_nombre.toUpperCase())) confianza += 0.10;
        const diasDiff = Math.abs((new Date(tx.fecha) - new Date(f.fecha)) / 86400000);
        if (diasDiff <= 7) confianza += 0.10;
        else if (diasDiff <= 30) confianza += 0.05;

        if (confianza > bestConfianza) {
          bestConfianza = confianza;
          bestMatch = { id: f.id, referencia: f.numero, nombre: f.cliente_nombre, importe: f.total };
          bestTipo = 'factura';
        }
      }
    }

    // Match con gastos (pagos salientes: importe < 0)
    if (importe < 0) {
      const importeAbs = Math.abs(importe);
      for (const g of gastosPendientes) {
        let confianza = 0;
        if (Math.abs(importeAbs - Number(g.total)) < 0.01) confianza += 0.40;
        if (g.proveedor && tx.concepto?.toUpperCase().includes(g.proveedor.toUpperCase())) confianza += 0.30;
        if (g.concepto && tx.concepto?.toUpperCase().includes(g.concepto.toUpperCase())) confianza += 0.20;
        const diasDiff = Math.abs((new Date(tx.fecha) - new Date(g.fecha_compra)) / 86400000);
        if (diasDiff <= 7) confianza += 0.10;

        if (confianza > bestConfianza) {
          bestConfianza = confianza;
          bestMatch = { id: g.id, referencia: g.concepto, nombre: g.proveedor, importe: g.total };
          bestTipo = 'gasto';
        }
      }
    }

    const confianzaPct = Math.round(bestConfianza * 100);

    if (bestMatch && confianzaPct >= 85 && auto_match) {
      // Auto-match
      try {
        if (bestTipo === 'factura') {
          const result = await matchPagoBanco({ bank_transaction_id: tx.id, factura_id: bestMatch.id }, empresaId);
          if (result.success) {
            resultados.matches_automaticos.push({
              movimiento: { fecha: tx.fecha, importe, concepto: tx.concepto },
              match: bestMatch,
              confianza: confianzaPct
            });
          }
        } else {
          // Para gastos solo marcamos el movimiento
          await sql`
            UPDATE bank_transactions_180
            SET estado_match = 'matched', purchase_id = ${bestMatch.id},
                confianza_match = ${bestConfianza},
                match_detalles = ${JSON.stringify({ tipo: 'gasto', proveedor: bestMatch.nombre, importe_gasto: bestMatch.importe })}
            WHERE id = ${tx.id}
          `;
          await sql`UPDATE purchases_180 SET pagado = true WHERE id = ${bestMatch.id}`;
          resultados.matches_automaticos.push({
            movimiento: { fecha: tx.fecha, importe, concepto: tx.concepto },
            match: bestMatch,
            tipo: 'gasto',
            confianza: confianzaPct
          });
        }
      } catch (err) {
        resultados.errores.push({ movimiento_id: tx.id, error: err.message });
      }
    } else if (bestMatch && confianzaPct >= 50) {
      resultados.sugerencias_revisar.push({
        movimiento_id: tx.id,
        fecha: tx.fecha, importe, concepto: tx.concepto,
        match_sugerido: bestMatch,
        tipo: bestTipo,
        confianza: confianzaPct
      });
    } else {
      resultados.sin_match.push({
        movimiento_id: tx.id,
        fecha: tx.fecha, importe, concepto: tx.concepto
      });
    }
  }

  resultados.resumen = {
    automaticos: resultados.matches_automaticos.length,
    para_revisar: resultados.sugerencias_revisar.length,
    sin_match: resultados.sin_match.length,
    errores: resultados.errores.length
  };

  return resultados;
}

// ============================
// CONFIGURACIÓN FISCAL (QR)
// ============================

async function configurarFacturacionQR(args, empresaId) {
  try {
    // Leer configuración actual del emisor
    const [emisor] = await sql`
      SELECT * FROM emisor_180 WHERE empresa_id = ${empresaId} LIMIT 1
    `;

    const updates = {};
    const cambios = [];

    if (args.nif && args.nif !== emisor?.nif) {
      updates.nif = args.nif;
      cambios.push(`NIF: ${args.nif}`);
    }
    if (args.nombre && args.nombre !== emisor?.nombre) {
      updates.nombre = args.nombre;
      cambios.push(`Nombre: ${args.nombre}`);
    }
    if (args.serie) {
      updates.serie = args.serie;
      cambios.push(`Serie: ${args.serie}`);
    }
    if (args.siguiente_numero) {
      updates.siguiente_numero = Number(args.siguiente_numero);
      cambios.push(`Siguiente número: ${args.siguiente_numero}`);
    }
    if (args.numeracion_plantilla) {
      updates.numeracion_plantilla = args.numeracion_plantilla;
      cambios.push(`Plantilla numeración: ${args.numeracion_plantilla}`);
    }
    if (args.direccion) {
      updates.direccion = args.direccion;
      cambios.push(`Dirección: ${args.direccion}`);
    }
    if (args.poblacion) {
      updates.poblacion = args.poblacion;
      cambios.push(`Población: ${args.poblacion}`);
    }
    if (args.provincia) {
      updates.provincia = args.provincia;
      cambios.push(`Provincia: ${args.provincia}`);
    }
    if (args.cp) {
      updates.cp = args.cp;
      cambios.push(`CP: ${args.cp}`);
    }
    if (args.telefono) {
      updates.telefono = args.telefono;
      cambios.push(`Teléfono: ${args.telefono}`);
    }
    if (args.email) {
      updates.email = args.email;
      cambios.push(`Email: ${args.email}`);
    }
    if (args.iban) {
      updates.iban = args.iban;
      cambios.push(`IBAN: ${args.iban}`);
    }

    if (cambios.length === 0) {
      return { success: false, mensaje: "No se proporcionaron datos para actualizar." };
    }

    // Actualizar emisor usando postgres helper para update dinámico
    if (emisor) {
      await sql`
        UPDATE emisor_180 SET ${sql(updates, ...Object.keys(updates))}
        WHERE empresa_id = ${empresaId}
      `;
    } else {
      // Crear emisor si no existe
      await sql`
        INSERT INTO emisor_180 ${sql({ empresa_id: empresaId, ...updates })}
      `;
    }

    // Si se proporcionó serie, actualizar también configuracionsistema_180
    if (args.serie) {
      await sql`
        UPDATE configuracionsistema_180
        SET serie = ${args.serie}
        WHERE empresa_id = ${empresaId}
      `;
    }

    return {
      success: true,
      mensaje: "Configuración de facturación actualizada correctamente.",
      cambios,
      datos_actuales: { ...emisor, ...updates }
    };
  } catch (err) {
    console.error("[AI] Error configurar facturación QR:", err);
    return { error: err.message || "Error al configurar facturación" };
  }
}

// ============================
// CERTIFICADOS DIGITALES (VERIFACTU)
// ============================

/**
 * Verifica el estado de renovación de certificados digitales
 */
async function verificarCertificadoRenovacion(empresaId) {
  try {
    // Importar servicio de renovación
    const { verificarEstadoCertificados } = await import('./certificadoRenovacionService.js');

    const estado = await verificarEstadoCertificados(empresaId);

    if (!estado.cliente && !estado.fabricante) {
      return {
        mensaje: "⚠️ No tienes certificados digitales configurados. Necesitas configurar tus certificados para usar VeriFactu.",
        configurados: false
      };
    }

    const respuesta = {
      configurados: true,
      necesitaRenovacion: estado.necesitaRenovacion,
      certificados: []
    };

    // Certificado del cliente
    if (estado.cliente) {
      respuesta.certificados.push({
        tipo: 'cliente',
        diasRestantes: estado.cliente.diasRestantes,
        fechaCaducidad: estado.cliente.fechaCaducidad,
        urgencia: estado.cliente.urgencia,
        linkRenovacion: estado.cliente.linkRenovacion,
        mensaje: estado.cliente.urgencia
          ? `${estado.cliente.urgencia.mensaje} - ${estado.cliente.diasRestantes} días restantes`
          : `✅ Certificado válido (${estado.cliente.diasRestantes} días restantes)`
      });
    }

    // Certificado del fabricante (si es diferente)
    if (estado.fabricante && estado.fabricante !== estado.cliente) {
      respuesta.certificados.push({
        tipo: 'fabricante',
        diasRestantes: estado.fabricante.diasRestantes,
        fechaCaducidad: estado.fabricante.fechaCaducidad,
        urgencia: estado.fabricante.urgencia,
        linkRenovacion: estado.fabricante.linkRenovacion,
        mensaje: estado.fabricante.urgencia
          ? `${estado.fabricante.urgencia.mensaje} - ${estado.fabricante.diasRestantes} días restantes`
          : `✅ Certificado válido (${estado.fabricante.diasRestantes} días restantes)`
      });
    }

    // Mensaje resumen
    if (estado.necesitaRenovacion) {
      respuesta.mensajeGeneral = "⚠️ Necesitas renovar uno o más certificados. Te proporcionaré los links directos para renovarlos online.";
    } else {
      respuesta.mensajeGeneral = "✅ Todos tus certificados están en buen estado.";
    }

    return respuesta;

  } catch (err) {
    console.error("[AI] Error verificar certificado:", err);
    return { error: err.message || "Error al verificar certificados" };
  }
}

/**
 * Obtiene instrucciones paso a paso para renovar certificado
 */
async function obtenerInstruccionesRenovacion(args, empresaId) {
  try {
    const { tipo } = args;

    if (!tipo || !['cliente', 'fabricante'].includes(tipo)) {
      return { error: "Debes especificar el tipo de certificado: 'cliente' o 'fabricante'" };
    }

    // Importar servicio de renovación
    const { verificarEstadoCertificados, generarInstruccionesRenovacion } = await import('./certificadoRenovacionService.js');

    const estado = await verificarEstadoCertificados(empresaId);

    const certificado = tipo === 'fabricante' ? estado.fabricante : estado.cliente;

    if (!certificado) {
      return {
        error: `No tienes configurado un certificado de ${tipo}. Primero debes importar tu certificado digital.`
      };
    }

    const instrucciones = generarInstruccionesRenovacion(
      certificado.tipoCertificado,
      certificado.diasRestantes
    );

    return {
      tipo,
      tipoCertificado: certificado.tipoCertificado,
      diasRestantes: certificado.diasRestantes,
      fechaCaducidad: certificado.fechaCaducidad,
      urgencia: certificado.urgencia?.mensaje || "Certificado válido",
      linkRenovacion: certificado.linkRenovacion,
      instrucciones: {
        urgencia: instrucciones.urgencia,
        pasos: instrucciones.pasos,
        estimacionTiempo: instrucciones.estimacionTiempo,
        requierePresencial: instrucciones.requierePresencial
      },
      mensaje: `📋 Aquí tienes las instrucciones para renovar tu certificado ${tipo}. El proceso es completamente online y tarda aproximadamente ${instrucciones.estimacionTiempo}.`
    };

  } catch (err) {
    console.error("[AI] Error obtener instrucciones:", err);
    return { error: err.message || "Error al obtener instrucciones" };
  }
}

// ============================
// ASESORÍA
// ============================

async function consultarAsesoriaEstado(empresaId) {
  try {
    const vinculo = await sql`
      SELECT ac.id, ac.estado, ac.permisos, ac.connected_at,
        a.nombre AS asesoria_nombre, a.email_contacto AS asesoria_email
      FROM asesoria_clientes_180 ac
      JOIN asesorias_180 a ON a.id = ac.asesoria_id
      WHERE ac.empresa_id = ${empresaId}
        AND ac.estado IN ('activo', 'pendiente')
      ORDER BY CASE ac.estado WHEN 'activo' THEN 1 WHEN 'pendiente' THEN 2 END
      LIMIT 1
    `;
    if (vinculo.length === 0) return "No tienes ninguna asesoría conectada. Puedes invitar una desde Mi Asesoría.";
    const v = vinculo[0];
    const [noLeidos] = await sql`
      SELECT COUNT(*)::int AS total FROM asesoria_mensajes_180
      WHERE empresa_id = ${empresaId} AND autor_tipo = 'asesor' AND leido = false
    `;
    return `Asesoría: ${v.asesoria_nombre} (${v.asesoria_email})\nEstado: ${v.estado}\nConectada desde: ${v.connected_at || 'pendiente'}\nMensajes sin leer del asesor: ${noLeidos.total}`;
  } catch (err) {
    console.error("[AI] Error consultar asesoría:", err);
    return { error: err.message || "Error consultando estado de asesoría" };
  }
}

async function enviarMensajeAsesoria(args, empresaId, userId) {
  try {
    const { contenido } = args;
    if (!contenido) return "Error: debes proporcionar el contenido del mensaje.";
    const [vinculo] = await sql`
      SELECT ac.asesoria_id FROM asesoria_clientes_180 ac
      WHERE ac.empresa_id = ${empresaId} AND ac.estado = 'activo' LIMIT 1
    `;
    if (!vinculo) return "No tienes asesoría activa. Primero conecta una asesoría desde Mi Asesoría.";
    const [msg] = await sql`
      INSERT INTO asesoria_mensajes_180 (asesoria_id, empresa_id, autor_id, autor_tipo, contenido, tipo, leido, created_at)
      VALUES (${vinculo.asesoria_id}, ${empresaId}, ${userId}, 'admin', ${contenido}, 'mensaje', false, now())
      RETURNING id, created_at
    `;
    return `Mensaje enviado a tu asesor (ID: ${msg.id}). Fecha: ${msg.created_at}`;
  } catch (err) {
    console.error("[AI] Error enviar mensaje asesoría:", err);
    return { error: err.message || "Error enviando mensaje a asesoría" };
  }
}

async function listarMensajesAsesoria(args, empresaId) {
  try {
    const limite = parseInt(args.limite) || 10;
    const [vinculo] = await sql`
      SELECT ac.asesoria_id FROM asesoria_clientes_180 ac
      WHERE ac.empresa_id = ${empresaId} AND ac.estado = 'activo' LIMIT 1
    `;
    if (!vinculo) return "No tienes asesoría activa.";
    const mensajes = await sql`
      SELECT m.contenido, m.autor_tipo, m.tipo, m.created_at, m.leido
      FROM asesoria_mensajes_180 m
      WHERE m.empresa_id = ${empresaId} AND m.asesoria_id = ${vinculo.asesoria_id}
      ORDER BY m.created_at DESC LIMIT ${limite}
    `;
    if (mensajes.length === 0) return "No hay mensajes con tu asesor.";
    await sql`
      UPDATE asesoria_mensajes_180 SET leido = true, leido_at = now()
      WHERE empresa_id = ${empresaId} AND asesoria_id = ${vinculo.asesoria_id}
        AND autor_tipo = 'asesor' AND leido = false
    `;
    return mensajes.reverse().map(m =>
      `[${new Date(m.created_at).toLocaleString('es-ES')}] ${m.autor_tipo === 'admin' ? 'Tú' : 'Asesor'}: ${m.contenido}`
    ).join('\n');
  } catch (err) {
    console.error("[AI] Error listar mensajes asesoría:", err);
    return { error: err.message || "Error listando mensajes de asesoría" };
  }
}

async function exportarParaAsesoria(args, empresaId) {
  try {
    const { anio, trimestre, formato } = args;
    if (!anio || !trimestre) return "Debes especificar el año y el trimestre (1-4).";
    const fmt = (formato || 'excel').toLowerCase();
    if (!['excel', 'csv', 'zip'].includes(fmt)) return "Formato no soportado. Usa: excel, csv, zip";
    return `Paquete de exportación disponible. Para descargarlo, accede a Mi Asesoría > Exportar, o usa este enlace:\n/admin/asesoria/export/trimestral?anio=${anio}&trimestre=${trimestre}&formato=${fmt}\n\nContenido del paquete (${fmt}):\n- Facturas emitidas del Q${trimestre} ${anio}\n- Gastos/compras del periodo\n- Nóminas del periodo\n- Resumen IVA trimestral\n- Datos fiscales de la empresa`;
  } catch (err) {
    console.error("[AI] Error exportar para asesoría:", err);
    return { error: err.message || "Error generando exportación para asesoría" };
  }
}

// ============================
// CONTABILIDAD
// ============================

async function crearAsientoContable(args, empresaId, userId) {
  try {
    const { fecha, concepto, lineas } = args;
    if (!fecha || !concepto || !lineas || !Array.isArray(lineas) || lineas.length < 2) {
      return "Error: necesitas fecha, concepto y al menos 2 líneas.";
    }
    const totalDebe = lineas.reduce((s, l) => s + parseFloat(l.debe || 0), 0);
    const totalHaber = lineas.reduce((s, l) => s + parseFloat(l.haber || 0), 0);
    if (Math.abs(totalDebe - totalHaber) > 0.01) {
      return `Error: el asiento no cuadra. Debe: ${totalDebe.toFixed(2)}€, Haber: ${totalHaber.toFixed(2)}€. Diferencia: ${(totalDebe - totalHaber).toFixed(2)}€`;
    }
    const { crearAsiento } = await import("./contabilidadService.js");
    const asiento = await crearAsiento({
      empresaId,
      fecha,
      concepto,
      tipo: "manual",
      creado_por: userId,
      lineas: lineas.map((l, i) => ({
        cuenta_codigo: l.cuenta_codigo,
        cuenta_nombre: l.cuenta_nombre || l.cuenta_codigo,
        debe: parseFloat(l.debe || 0),
        haber: parseFloat(l.haber || 0),
        concepto: l.concepto || concepto,
        orden: i + 1,
      })),
    });
    return `Asiento contable #${asiento.numero} creado (${fecha}). Concepto: ${concepto}. Total: ${totalDebe.toFixed(2)}€. Estado: borrador.`;
  } catch (err) {
    console.error("[AI] Error crear asiento contable:", err);
    return `Error creando asiento: ${err.message}`;
  }
}

async function generarAsientosPeriodo(args, empresaId, userId) {
  try {
    const { fecha_desde, fecha_hasta } = args;
    if (!fecha_desde || !fecha_hasta) return "Debes especificar fecha_desde y fecha_hasta en formato YYYY-MM-DD.";
    const { generarAsientosPeriodo: generarFn } = await import("./contabilidadService.js");
    const result = await generarFn(empresaId, fecha_desde, fecha_hasta, userId);
    let msg = `Asientos generados:\n- Facturas: ${result.facturas}\n- Gastos: ${result.gastos}\n- Nóminas: ${result.nominas}`;
    if (result.errores.length > 0) {
      msg += `\n\nErrores (${result.errores.length}):\n${result.errores.slice(0, 5).join('\n')}`;
    }
    return msg;
  } catch (err) {
    console.error("[AI] Error generar asientos periodo:", err);
    return `Error generando asientos: ${err.message}`;
  }
}

async function consultarBalance(args, empresaId) {
  try {
    const fecha = args.fecha || new Date().toISOString().split('T')[0];
    const { calcularBalance } = await import("./contabilidadService.js");
    const balance = await calcularBalance(empresaId, fecha);
    let msg = `Balance de Situación a ${fecha}:\n\n`;
    msg += `ACTIVO (${balance.activo.total.toFixed(2)}€):\n`;
    balance.activo.cuentas.forEach(c => { msg += `  ${c.cuenta_codigo} ${c.cuenta_nombre}: ${c.saldo.toFixed(2)}€\n`; });
    msg += `\nPASIVO (${balance.pasivo.total.toFixed(2)}€):\n`;
    balance.pasivo.cuentas.forEach(c => { msg += `  ${c.cuenta_codigo} ${c.cuenta_nombre}: ${c.saldo.toFixed(2)}€\n`; });
    msg += `\nPATRIMONIO NETO (${balance.patrimonio.total.toFixed(2)}€):\n`;
    balance.patrimonio.cuentas.forEach(c => { msg += `  ${c.cuenta_codigo} ${c.cuenta_nombre}: ${c.saldo.toFixed(2)}€\n`; });
    msg += `\n${balance.cuadra ? 'El balance cuadra' : 'El balance NO cuadra'}`;
    return msg;
  } catch (err) {
    console.error("[AI] Error consultar balance:", err);
    return `Error calculando balance: ${err.message}`;
  }
}

async function consultarPyG(args, empresaId) {
  try {
    const { fecha_desde, fecha_hasta } = args;
    if (!fecha_desde || !fecha_hasta) return "Debes especificar fecha_desde y fecha_hasta.";
    const { calcularPyG } = await import("./contabilidadService.js");
    const pyg = await calcularPyG(empresaId, fecha_desde, fecha_hasta);
    let msg = `Pérdidas y Ganancias (${fecha_desde} a ${fecha_hasta}):\n\n`;
    msg += `INGRESOS (${pyg.ingresos.total.toFixed(2)}€):\n`;
    pyg.ingresos.cuentas.forEach(c => { msg += `  ${c.cuenta_codigo} ${c.cuenta_nombre}: ${c.saldo.toFixed(2)}€\n`; });
    msg += `\nGASTOS (${pyg.gastos.total.toFixed(2)}€):\n`;
    pyg.gastos.cuentas.forEach(c => { msg += `  ${c.cuenta_codigo} ${c.cuenta_nombre}: ${c.saldo.toFixed(2)}€\n`; });
    msg += `\nRESULTADO: ${pyg.resultado.toFixed(2)}€ ${pyg.resultado >= 0 ? '(Beneficio)' : '(Pérdida)'}`;
    return msg;
  } catch (err) {
    console.error("[AI] Error consultar PyG:", err);
    return `Error calculando PyG: ${err.message}`;
  }
}

async function consultarLibroMayor(args, empresaId) {
  try {
    const { cuenta_codigo, fecha_desde, fecha_hasta } = args;
    if (!cuenta_codigo) return "Debes especificar el código de cuenta (ej: '430', '700', '572').";
    const { libroMayor } = await import("./contabilidadService.js");
    const result = await libroMayor(empresaId, cuenta_codigo, fecha_desde || null, fecha_hasta || null);
    if (!result.movimientos || result.movimientos.length === 0) return `No hay movimientos para la cuenta ${cuenta_codigo}.`;
    let msg = `Libro Mayor - Cuenta ${cuenta_codigo} (${result.cuenta_nombre || ''}):\n`;
    msg += `Periodo: ${fecha_desde || 'inicio'} a ${fecha_hasta || 'hoy'}\n\n`;
    result.movimientos.forEach(m => {
      msg += `${new Date(m.fecha).toLocaleDateString('es-ES')} | ${m.concepto} | Debe: ${(m.debe||0).toFixed(2)}€ | Haber: ${(m.haber||0).toFixed(2)}€ | Saldo: ${(m.saldo_acumulado||0).toFixed(2)}€\n`;
    });
    msg += `\nSaldo final: ${(result.saldo_final||0).toFixed(2)}€`;
    return msg;
  } catch (err) {
    console.error("[AI] Error consultar libro mayor:", err);
    return `Error consultando libro mayor: ${err.message}`;
  }
}

// ============================
// REVISAR CUENTAS ASIENTOS (IA)
// ============================

async function revisarCuentasAsientosIA(args, empresaId) {
  try {
    const { revisarCuentasAsientos } = await import("./contabilidadService.js");
    const simular = args.simular !== false; // Por defecto simular=true
    const asientoIds = Array.isArray(args.asiento_ids) ? args.asiento_ids : [];

    const result = await revisarCuentasAsientos(empresaId, asientoIds, simular);

    if (result.corregidos === 0 && result.cambios.length === 0) {
      return `He revisado ${result.revisados} asientos y todos tienen las cuentas contables correctas. No se necesitan correcciones.`;
    }

    let msg = simular
      ? `He encontrado ${result.cambios.length} asiento(s) con cuentas que podrían mejorar:\n\n`
      : `He corregido ${result.corregidos} asiento(s):\n\n`;

    result.cambios.forEach((c, i) => {
      msg += `${i + 1}. "${c.concepto}" (${c.importe.toFixed(2)}€)\n`;
      msg += `   ${c.cuenta_anterior.codigo} (${c.cuenta_anterior.nombre}) → ${c.cuenta_nueva.codigo} (${c.cuenta_nueva.nombre})\n\n`;
    });

    if (simular && result.cambios.length > 0) {
      msg += `¿Quieres que aplique estas correcciones? Dime "sí, aplica las correcciones" y ejecutaré la herramienta con simular=false.`;
    }

    if (result.errores.length > 0) {
      msg += `\nErrores: ${result.errores.join(", ")}`;
    }

    return msg;
  } catch (err) {
    console.error("[AI] Error revisarCuentasAsientos:", err);
    return `Error revisando cuentas: ${err.message}`;
  }
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
    return [...memoria].reverse().flatMap(m => [
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


// ============================
// PROFORMAS (funciones separadas)
// ============================

async function crearProformaIA({ cliente_id, fecha, lineas, iva_global = 0, retencion_porcentaje = 0 }, empresaId) {
  const [cliente] = await sql`SELECT id, nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  if (!cliente) return { error: "Cliente no encontrado" };
  if (!Array.isArray(lineas) || lineas.length === 0) return { error: "Debe incluir al menos una línea" };
  if (!fecha) return { error: "Fecha requerida (YYYY-MM-DD)" };

  // Generar número PRO
  const year = new Date(fecha).getFullYear();
  const [countResult] = await sql`
    SELECT COUNT(*) as total FROM factura_180
    WHERE empresa_id = ${empresaId} AND tipo_factura = 'PROFORMA' AND numero IS NOT NULL AND EXTRACT(YEAR FROM fecha) = ${year}
  `;
  const nextNum = (parseInt(countResult?.total || 0) + 1).toString().padStart(6, '0');
  const numero = `PRO-${year}-${nextNum}`;

  let createdId;
  let total;
  await sql.begin(async (tx) => {
    let subtotal = 0;
    let iva_total = 0;
    const [proforma] = await tx`
      INSERT INTO factura_180 (empresa_id, cliente_id, fecha, estado, numero, iva_global, tipo_factura, retencion_porcentaje, subtotal, iva_total, total, created_at)
      VALUES (${empresaId}, ${cliente_id}, ${fecha}::date, 'ACTIVA', ${numero}, ${iva_global || 0}, 'PROFORMA', ${retencion_porcentaje || 0}, 0, 0, 0, now())
      RETURNING id
    `;
    createdId = proforma.id;

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
        VALUES (${proforma.id}, ${descripcion}, ${cantidad}, ${precio_unitario}, ${base + importe_iva}, ${iva_pct})
      `;
    }
    const retencion_importe = (subtotal * retencion_porcentaje) / 100;
    total = Math.round((subtotal + iva_total - retencion_importe) * 100) / 100;
    await tx`
      UPDATE factura_180 SET subtotal = ${Math.round(subtotal * 100) / 100},
        iva_total = ${Math.round(iva_total * 100) / 100},
        retencion_importe = ${Math.round(retencion_importe * 100) / 100},
        total = ${total}
      WHERE id = ${proforma.id}
    `;
  });

  return {
    success: true,
    mensaje: `Proforma ${numero} creada para ${cliente.nombre}. Total: ${total.toFixed(2)} EUR. ID: ${createdId}`,
    proforma: { id: createdId, numero, cliente: cliente.nombre, total, estado: "ACTIVA" }
  };
}

async function anularProformaIA({ proforma_id, motivo }, empresaId) {
  if (!motivo || !motivo.trim()) return { error: "Motivo de anulación obligatorio" };
  const [proforma] = await sql`
    SELECT * FROM factura_180
    WHERE id = ${proforma_id} AND empresa_id = ${empresaId} AND tipo_factura = 'PROFORMA'
  `;
  if (!proforma) return { error: "Proforma no encontrada" };
  if (proforma.estado !== 'ACTIVA') return { error: "Solo se pueden anular proformas activas" };

  await sql`UPDATE factura_180 SET estado = 'ANULADA', updated_at = now() WHERE id = ${proforma_id}`;

  return {
    success: true,
    mensaje: `Proforma ${proforma.numero} anulada. Motivo: ${motivo.trim()}`,
    proforma: { id: proforma_id, numero: proforma.numero, estado: "ANULADA" }
  };
}

async function reactivarProformaIA({ proforma_id }, empresaId) {
  const [proforma] = await sql`
    SELECT * FROM factura_180
    WHERE id = ${proforma_id} AND empresa_id = ${empresaId} AND tipo_factura = 'PROFORMA'
  `;
  if (!proforma) return { error: "Proforma no encontrada" };
  if (proforma.estado !== 'ANULADA') return { error: "Solo se pueden reactivar proformas anuladas" };

  const lineasOriginales = await sql`SELECT * FROM lineafactura_180 WHERE factura_id = ${proforma_id} ORDER BY id`;

  const hoy = new Date().toISOString().split('T')[0];
  const year = new Date().getFullYear();
  const [countResult] = await sql`
    SELECT COUNT(*) as total FROM factura_180
    WHERE empresa_id = ${empresaId} AND tipo_factura = 'PROFORMA' AND numero IS NOT NULL AND EXTRACT(YEAR FROM fecha) = ${year}
  `;
  const nextNum = (parseInt(countResult?.total || 0) + 1).toString().padStart(6, '0');
  const nuevoNumero = `PRO-${year}-${nextNum}`;

  let nuevaId;
  await sql.begin(async (tx) => {
    const [nueva] = await tx`
      INSERT INTO factura_180 (empresa_id, cliente_id, fecha, estado, numero, iva_global, mensaje_iva, metodo_pago,
        subtotal, iva_total, total, retencion_porcentaje, retencion_importe, tipo_factura, proforma_origen_id, created_at)
      VALUES (${empresaId}, ${proforma.cliente_id}, ${hoy}::date, 'ACTIVA', ${nuevoNumero},
        ${proforma.iva_global}, ${proforma.mensaje_iva}, ${proforma.metodo_pago},
        ${proforma.subtotal}, ${proforma.iva_total}, ${proforma.total},
        ${proforma.retencion_porcentaje}, ${proforma.retencion_importe},
        'PROFORMA', ${proforma_id}, now())
      RETURNING id
    `;
    nuevaId = nueva.id;

    for (const l of lineasOriginales) {
      await tx`
        INSERT INTO lineafactura_180 (factura_id, descripcion, cantidad, precio_unitario, total, concepto_id, iva_percent)
        VALUES (${nueva.id}, ${l.descripcion}, ${l.cantidad}, ${l.precio_unitario}, ${l.total}, ${l.concepto_id}, ${l.iva_percent})
      `;
    }
  });

  return {
    success: true,
    mensaje: `Nueva proforma ${nuevoNumero} creada desde la anulada ${proforma.numero}. ID: ${nuevaId}`,
    proforma: { id: nuevaId, numero: nuevoNumero, origen: proforma.numero, estado: "ACTIVA" }
  };
}

// ============================
// INTELIGENCIA FISCAL (IA)
// ============================

async function analizarRiesgoFiscalIA(args, empresaId) {
  const now = new Date();
  const anio = args.anio || now.getFullYear();
  const trimestre = args.trimestre || Math.ceil((now.getMonth() + 1) / 3);

  const result = await analyzeCurrentQuarter(empresaId, anio, trimestre);

  return {
    anio,
    trimestre,
    risk_score: result.riskScore,
    risk_level: result.riskScore >= 70 ? "ALTO" : result.riskScore >= 40 ? "MEDIO" : "BAJO",
    total_alertas: result.alerts.length,
    alertas: result.alerts.map(a => ({
      tipo: a.alert_type,
      severidad: a.severity,
      mensaje: a.message,
      recomendacion: a.recommendation,
      valor_actual: a.current_value,
      umbral: a.threshold,
    })),
    ratios: result.ratios,
    sector: result.config?.sector || "default",
  };
}

async function simularImpactoFiscalIA(args, empresaId) {
  const now = new Date();
  const anio = args.anio || now.getFullYear();
  const trimestre = args.trimestre || Math.ceil((now.getMonth() + 1) / 3);
  const ivaPct = args.iva_pct || 21;
  const ivaImporte = args.base_imponible * (ivaPct / 100);

  const result = await simulateImpact(empresaId, anio, trimestre, {
    type: args.tipo,
    base_imponible: args.base_imponible,
    iva_pct: ivaPct,
    iva_importe: ivaImporte,
  });

  return {
    operacion: `${args.tipo} de ${args.base_imponible}€ + IVA ${ivaPct}%`,
    riesgo_antes: result.before.riskScore,
    riesgo_despues: result.after.riskScore,
    cambio_riesgo: result.after.riskScore - result.before.riskScore,
    ratio_gastos_ingresos_antes: (result.before.ratios.gastos_ingresos * 100).toFixed(1) + "%",
    ratio_gastos_ingresos_despues: (result.after.ratios.gastos_ingresos * 100).toFixed(1) + "%",
    modelo303_resultado: result.modeloImpact.modelo303_resultado,
    modelo130_a_ingresar: result.modeloImpact.modelo130_a_ingresar,
    nuevas_alertas: result.after.alerts.map(a => a.message),
    facturacion_necesaria_para_compensar: result.safeInvoicingThreshold,
  };
}

// ============================
// CHAT PRINCIPAL
// ============================

export async function chatConAgente({ empresaId, userId, userRole, mensaje, historial = [] }) {
  try {
    console.log(`[AI] Chat - Empresa: ${empresaId}, Mensaje: ${mensaje}`);

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.length < 10) {
      return { mensaje: "El servicio de IA no está configurado. Contacta al administrador." };
    }

    const memoriaReciente = await cargarMemoria(empresaId, userId, 3);

    // ==========================================
    // CONTROL DE CONSULTAS IA (MCP CENTRALIZADO)
    // ==========================================
    const quotaCheck = await mcpTracker.checkQuota({ orgId: empresaId, userId });
    if (!quotaCheck.allowed) {
      if (quotaCheck.reason === 'ai_disabled') {
        return { mensaje: "El servicio de IA está desactivado para tu empresa." };
      }
      const limite = quotaCheck.limit || 0;
      const tipo = quotaCheck.reason === 'daily_limit' ? 'diario' : 'mensual';
      return {
        mensaje: `Has alcanzado tu límite de ${limite} consultas ${tipo === 'diario' ? 'diarias' : 'mensuales'}. Puedes recargar créditos desde tu perfil para seguir usando CONTENDO.`,
        limite_alcanzado: true,
        tipo_limite: tipo,
        consultas_actual: quotaCheck.current || 0,
        limite: limite
      };
    }

    // Obtener nombre del usuario para contexto
    const [userInfo] = await sql`SELECT nombre FROM users_180 WHERE id = ${userId} LIMIT 1`;
    const userName = userInfo?.nombre || null;

    const systemPrompt = buildSystemPrompt(userRole, { userName, userId });

    // Convertir historial al formato Anthropic (sin role: "system")
    const anthropicMessages = [];
    for (const m of [...memoriaReciente, ...historial]) {
      if (m.role === "system") continue;
      if (m.role === "user" || m.role === "assistant") {
        anthropicMessages.push({ role: m.role, content: m.content });
      }
    }
    anthropicMessages.push({ role: "user", content: mensaje });

    // Convertir tools al formato Anthropic (lazy init)
    const anthropicTools = convertToolsToAnthropic(TOOLS);

    // Primera llamada con tools
    let response;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    try {
      response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: systemPrompt,
        messages: anthropicMessages,
        tools: anthropicTools,
        tool_choice: { type: "auto" },
        temperature: 0.4,
      });
      totalInputTokens += response.usage?.input_tokens || 0;
      totalOutputTokens += response.usage?.output_tokens || 0;
    } catch (apiErr) {
      console.error("[AI] Error API Anthropic:", apiErr.message);

      // Fallback a knowledge base
      const fallback = await consultarConocimiento({ busqueda: mensaje }, empresaId);
      if (fallback.respuesta_directa) {
        await guardarConversacion(empresaId, userId, userRole, mensaje, fallback.respuesta_directa);
        return { mensaje: fallback.respuesta_directa };
      }
      return { mensaje: "No pude procesar tu mensaje en este momento. Inténtalo de nuevo en unos minutos." };
    }

    // Tools de escritura que modifican datos
    const WRITE_TOOLS = new Set([
      'crear_factura', 'actualizar_factura', 'validar_factura', 'anular_factura',
      'eliminar_factura', 'enviar_factura_email', 'crear_cliente', 'actualizar_cliente',
      'desactivar_cliente', 'crear_pago', 'eliminar_pago', 'actualizar_empleado',
      'crear_trabajo', 'crear_ausencia', 'crear_evento_calendario', 'eliminar_evento_calendario',
      'facturar_trabajos_pendientes', 'configurar_facturacion_qr',
      'crear_fichaje_manual', 'validar_fichaje', 'crear_plantilla', 'asignar_plantilla',
      'crear_nomina', 'validar_parte_dia', 'crear_conocimiento', 'actualizar_conocimiento',
      'eliminar_conocimiento', 'match_pago_banco', 'crear_excepcion_jornada',
      'actualizar_configuracion', 'eliminar_archivo', 'reconciliar_extracto',
      'responder_sugerencia',
      'enviar_mensaje_asesoria', 'crear_asiento_contable', 'generar_asientos_periodo',
      'enviar_nomina'
    ]);
    let accionRealizada = false;

    // Procesar tool calls (máximo 5 iteraciones - Claude es más fiable)
    let iterations = 0;
    while (response.stop_reason === "tool_use" && iterations < 8) {
      iterations++;

      // Extraer tool_use blocks de la respuesta
      const toolUseBlocks = response.content.filter(b => b.type === "tool_use");
      console.log(`[AI] Iteración ${iterations}: ${toolUseBlocks.length} herramientas`);

      // Añadir respuesta del assistant al historial
      anthropicMessages.push({ role: "assistant", content: response.content });

      // Ejecutar cada tool y construir tool_results
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const resultado = await ejecutarHerramienta(toolUse.name, toolUse.input || {}, empresaId, userId);

        // Human-in-the-loop: si el agente pide aclaración, pausar y devolver al frontend
        if (resultado?.__tipo === "clarification") {
          console.log(`[AI] Aclaración solicitada: "${resultado.pregunta}"`);
          return {
            mensaje: resultado.pregunta,
            clarificacion: { pregunta: resultado.pregunta, opciones: resultado.opciones },
            accion_realizada: false
          };
        }

        if (WRITE_TOOLS.has(toolUse.name) && resultado?.success) {
          accionRealizada = true;
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(resultado),
        });
      }

      // Añadir resultados como mensaje user
      anthropicMessages.push({ role: "user", content: toolResults });

      // Siguiente llamada
      try {
        response = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          system: systemPrompt,
          messages: anthropicMessages,
          tools: anthropicTools,
          tool_choice: { type: "auto" },
          temperature: 0.2,
        });
        totalInputTokens += response.usage?.input_tokens || 0;
        totalOutputTokens += response.usage?.output_tokens || 0;
      } catch (apiErr) {
        console.error("[AI] Error API Anthropic (tool loop):", apiErr.message);
        return { mensaje: "Error al procesar los datos. Inténtalo de nuevo." };
      }
    }

    // Extraer texto de la respuesta final
    const textBlocks = response.content.filter(b => b.type === "text");
    const respuestaFinal = textBlocks.map(b => b.text).join("\n") || "No pude generar una respuesta.";
    await guardarConversacion(empresaId, userId, userRole, mensaje, respuestaFinal);

    // Registrar consumo en MCP centralizado (fire-and-forget)
    mcpTracker.recordUsage({
      orgId: empresaId,
      userId,
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      keySource: 'env',
      operation: 'agent_chat',
      toolCalls: iterations
    }).catch(err => console.warn('[AI] Error registrando consumo MCP:', err.message));
    console.log(`[AI] Consumo: ${totalInputTokens} in + ${totalOutputTokens} out tokens, ${iterations} tool iterations. Empresa: ${empresaId}`);

    return { mensaje: respuestaFinal, accion_realizada: accionRealizada };

  } catch (error) {
    console.error("[AI] Error general:", error);
    return { mensaje: "Ha ocurrido un error inesperado. Inténtalo de nuevo más tarde." };
  }
}
