// backend/src/services/fichajeSharedService.js
//
// Lógica compartida de creación de fichajes.
// Reutilizada por: endpoint empleado, kiosko, sync offline, admin manual.

import { sql } from "../db.js";
import { ejecutarAutocierre } from "../jobs/autocierre.js";
import {
  obtenerJornadaAbierta,
  crearJornada,
  cerrarJornada,
} from "./jornadasService.js";
import { syncDailyReport } from "./dailyReportService.js";
import { recalcularJornada } from "./jornadaEngine.js";
import { getPlanDiaEstado } from "./planDiaEstadoService.js";
import { evaluarFichaje } from "./fichajeEngine.js";
import { getYMDMadrid } from "../utils/dateMadrid.js";
import { generarHashFichajeNuevo } from "./fichajeIntegridadService.js";

/**
 * Crear un fichaje de forma interna (sin depender de req/res).
 *
 * @param {Object} params
 * @param {string} params.empleadoId - UUID del empleado
 * @param {string} params.empresaId - UUID de la empresa
 * @param {string} params.tipo - 'entrada'|'salida'|'descanso_inicio'|'descanso_fin'
 * @param {Date}   params.fechaHora - Momento del fichaje
 * @param {string|null} params.userId - UUID del user (null para kiosko)
 * @param {string|null} params.clienteId - UUID del cliente (opcional)
 * @param {string|null} params.centroTrabajoId - UUID del centro de trabajo
 * @param {number|null} params.lat - Latitud GPS
 * @param {number|null} params.lng - Longitud GPS
 * @param {number|null} params.accuracy - Precisión GPS
 * @param {string}  params.origen - 'app'|'kiosk'|'offline_sync'|'admin_manual'
 * @param {string|null} params.reqIp - IP del request
 * @param {boolean} params.skipPlanCheck - Saltar validación de planificación (kiosko)
 * @param {boolean} params.skipGeoValidation - Saltar validación geo (kiosko usa ubicación fija)
 * @param {string|null} params.estadoOverride - Forzar estado (ej: 'pendiente_validacion' para offline)
 * @param {string|null} params.subtipo - Subtipo de descanso (pausa_corta, comida, trayecto)
 * @param {Date|null} params.offlineTimestamp - Timestamp original del dispositivo offline
 * @param {string|null} params.offlineDeviceId - UUID del dispositivo kiosko offline
 * @param {string|null} params.syncBatchId - UUID del batch de sincronización
 *
 * @returns {{ fichaje: Object, incidencias: string[], jornadaId: string }}
 */
export async function crearFichajeInterno({
  empleadoId,
  empresaId,
  tipo,
  fechaHora,
  userId = null,
  clienteId = null,
  centroTrabajoId = null,
  lat = null,
  lng = null,
  accuracy = null,
  origen = "app",
  reqIp = null,
  skipPlanCheck = false,
  skipGeoValidation = false,
  estadoOverride = null,
  subtipo = null,
  offlineTimestamp = null,
  offlineDeviceId = null,
  syncBatchId = null,
}) {
  /* 1. Cargar empleado */
  const [empleado] = await sql`
    SELECT id, activo, empresa_id, tipo_trabajo, turno_id, user_id
    FROM employees_180
    WHERE id = ${empleadoId} AND empresa_id = ${empresaId}
    LIMIT 1
  `;

  if (!empleado) throw new Error("Empleado no encontrado");
  if (!empleado.activo) throw new Error("Empleado desactivado");

  // Resolver userId si no viene (kiosko)
  const resolvedUserId = userId || empleado.user_id;

  /* 2. Planificación (opcional) */
  if (!skipPlanCheck) {
    const fechaYMD = getYMDMadrid(fechaHora);
    const estadoPlan = await getPlanDiaEstado({
      empresaId,
      empleadoId,
      fecha: fechaYMD,
    });

    if (!estadoPlan?.boton_visible) {
      throw new Error(
        estadoPlan?.motivo_oculto === "ausencia"
          ? "No se puede fichar durante una ausencia"
          : "Hoy no es día laboral"
      );
    }

    if (estadoPlan?.accion && estadoPlan.accion !== tipo) {
      throw new Error(`Acción inválida. Ahora toca: ${estadoPlan.accion}`);
    }
  }

  /* 3. Resolver centro de trabajo */
  if (!centroTrabajoId && !clienteId) {
    const [empCt] = await sql`SELECT centro_trabajo_id FROM employees_180 WHERE id = ${empleadoId}`;
    centroTrabajoId = empCt?.centro_trabajo_id || null;
  }

  /* 4. Autocierre */
  if (tipo === "entrada" || tipo === "salida") {
    await ejecutarAutocierre();
  }

  /* 5. Jornada */
  let jornada = await obtenerJornadaAbierta(empleadoId);

  if (tipo === "entrada") {
    if (!jornada) {
      jornada = await crearJornada({
        empresaId,
        empleadoId,
        clienteId: clienteId || null,
        inicio: fechaHora,
      });
    }
  } else {
    if (!jornada) {
      throw new Error("No hay jornada abierta");
    }
  }

  const jornadaId = jornada.id;

  /* 6. Motor de evaluación */
  let evalResult = {
    permitido: true,
    sospechoso: false,
    razones: [],
    incidencias: [],
    geo: null,
    ipInfo: null,
  };

  if (!skipGeoValidation) {
    // Cargar cliente para evaluación geo
    let cliente = null;
    if (clienteId) {
      [cliente] = await sql`
        SELECT * FROM clients_180
        WHERE id = ${clienteId} AND empresa_id = ${empresaId}
        LIMIT 1
      `;
    }

    evalResult = await evaluarFichaje({
      userId: resolvedUserId,
      empleado,
      cliente,
      tipo,
      fechaHora,
      lat,
      lng,
      accuracy,
      empresaId,
      reqIp,
    });

    if (!evalResult.permitido) {
      throw new Error("Fichaje no permitido: " + (evalResult.errores || []).join(", "));
    }
  }

  /* 7. Hash chain (RD 8/2019) */
  const hashData = await generarHashFichajeNuevo({
    empleado_id: empleadoId,
    empresa_id: empresaId,
    fecha: fechaHora,
    tipo,
    jornada_id: jornadaId,
  });

  /* 8. INSERT */
  const estado = estadoOverride || "confirmado";

  const [nuevo] = await sql`
    INSERT INTO fichajes_180 (
      user_id, empleado_id, cliente_id, centro_trabajo_id,
      empresa_id, jornada_id,
      tipo, fecha, estado, origen, subtipo,
      hash_actual, hash_anterior, fecha_hash,
      geo_distancia, geo_sospechoso, geo_motivos, geo_direccion,
      gps_accuracy, ip_info,
      sospechoso, sospecha_motivo, direccion, ciudad, pais,
      offline_timestamp, offline_device_id, sync_batch_id,
      creado_manual
    ) VALUES (
      ${resolvedUserId}, ${empleadoId}, ${clienteId || null}, ${centroTrabajoId || null},
      ${empresaId}, ${jornadaId},
      ${tipo}, ${fechaHora}, ${estado}, ${origen}, ${subtipo || null},
      ${hashData.hash_actual}, ${hashData.hash_anterior}, ${hashData.fecha_hash},
      ${evalResult.geo?.distancia || null},
      ${evalResult.sospechoso},
      ${JSON.stringify(evalResult.razones || [])},
      ${JSON.stringify(evalResult.geo?.direccion || null)},
      ${accuracy || null},
      ${evalResult.ipInfo || null},
      ${evalResult.sospechoso},
      ${evalResult.razones?.join(" | ") || null},
      ${evalResult.geo?.direccion?.direccion || null},
      ${evalResult.geo?.direccion?.ciudad || null},
      ${evalResult.geo?.direccion?.pais || null},
      ${offlineTimestamp || null}, ${offlineDeviceId || null}, ${syncBatchId || null},
      ${origen === "admin_manual" || origen === "kiosk"}
    ) RETURNING *
  `;

  /* 9. Cierre jornada */
  if (tipo === "salida" && jornadaId) {
    const j = await recalcularJornada(jornadaId);
    await cerrarJornada({
      jornadaId,
      fin: fechaHora,
      minutos_trabajados: j?.minutos_trabajados || 0,
      minutos_descanso: j?.minutos_descanso || 0,
      minutos_extra: j?.minutos_extra || 0,
      origen_cierre: origen,
    });
  } else if (jornadaId) {
    await recalcularJornada(jornadaId);
  }

  /* 10. Daily report */
  try {
    await syncDailyReport({ empresaId, empleadoId, fecha: fechaHora });
  } catch (e) {
    console.error("❌ DAILY REPORT ERROR:", e);
  }

  return {
    fichaje: nuevo,
    incidencias: evalResult.incidencias || [],
    jornadaId,
  };
}
