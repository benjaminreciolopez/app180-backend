// backend\src\controllers\fichajeController.js

import { sql } from "../db.js";
import { ejecutarAutocierre } from "../jobs/autocierre.js";
import {
  obtenerJornadaAbierta,
  crearJornada,
  cerrarJornada,
} from "../services/jornadasService.js";
import { syncDailyReport } from "../services/dailyReportService.js";
import { recalcularJornada } from "../services/jornadaEngine.js";
import { getPlanDiaEstado } from "../services/planDiaEstadoService.js";
import { evaluarFichaje } from "../services/fichajeEngine.js";
import { getYMDMadrid } from "../utils/dateMadrid.js";
import { getClientIp } from "../utils/clientIp.js";

export const createFichaje = async (req, res) => {
  try {
    const { tipo, cliente_id, lat, lng, accuracy, fecha_hora } = req.body;

    /* =========================
       1. Validaciones básicas
    ========================= */

    const TIPOS = ["entrada", "salida", "descanso_inicio", "descanso_fin"];

    if (!TIPOS.includes(tipo)) {
      return res.status(400).json({ error: "Tipo de fichaje no válido" });
    }

    const fechaHora = fecha_hora ? new Date(fecha_hora) : new Date();

    if (!(fechaHora instanceof Date) || isNaN(fechaHora.getTime())) {
      return res.status(400).json({ error: "fecha_hora inválida" });
    }

    /* =========================
       2. Cargar empleado
    ========================= */

    const [empleado] = await sql`
      SELECT id, activo, empresa_id, tipo_trabajo, turno_id
      FROM employees_180
      WHERE id = ${req.user.empleado_id}
      LIMIT 1
    `;

    if (!empleado) {
      return res.status(403).json({ error: "Usuario no es empleado" });
    }

    if (!empleado.activo) {
      return res.status(403).json({ error: "Empleado desactivado" });
    }

    const empleadoId = empleado.id;
    const empresaId = empleado.empresa_id;

    /* =========================
       3. Cargar cliente
    ========================= */

    let cliente = null;

    if (cliente_id) {
      [cliente] = await sql`
        SELECT *
        FROM clients_180
        WHERE id = ${cliente_id}
          AND empresa_id = ${empresaId}
        LIMIT 1
      `;

      if (!cliente) {
        return res.status(404).json({ error: "Cliente no válido" });
      }
    }

    /* =========================
       4. Estado planificación
    ========================= */

    const fechaYMD = getYMDMadrid(fechaHora);

    const estadoPlan = await getPlanDiaEstado({
      empresaId,
      empleadoId,
      fecha: fechaYMD,
    });

    if (!estadoPlan?.boton_visible) {
      return res.status(403).json({
        error:
          estadoPlan?.motivo_oculto === "ausencia"
            ? "No puedes fichar durante una ausencia"
            : "Hoy no es día laboral",
        detalle: estadoPlan,
      });
    }

    if (estadoPlan?.accion && estadoPlan.accion !== tipo) {
      return res.status(409).json({
        error: `Acción inválida. Ahora toca: ${estadoPlan.accion}`,
        accion_correcta: estadoPlan.accion,
      });
    }

    /* =========================
       5. Cliente obligatorio
    ========================= */

    if (tipo === "entrada" && empleado.tipo_trabajo === "oficina" && !cliente) {
      const hayClientes = await sql`
        SELECT 1 FROM clients_180
        WHERE empresa_id = ${empresaId}
        LIMIT 1
      `;

      if (hayClientes.length > 0) {
        return res.status(400).json({ error: "Debes seleccionar un cliente" });
      }
    }
    /* =========================
       6. Autocierre
    ========================= */

    if (tipo === "entrada" || tipo === "salida") {
      await ejecutarAutocierre();
    }

    /* =========================
      7. Jornada
    ========================= */

    let jornada = await obtenerJornadaAbierta(empleadoId);

    if (tipo === "entrada") {
      if (!jornada) {
        jornada = await crearJornada({
          empresaId,
          empleadoId,
          clienteId: cliente?.id || null,
          inicio: fechaHora,
        });
      }
    } else {
      if (!jornada) {
        return res.status(400).json({
          error: "No hay jornada abierta",
        });
      }
    }

    const jornadaId = jornada.id;

    /* =========================
       9. Motor central
    ========================= */
    const clientIp = getClientIp(req);

    const evalResult = await evaluarFichaje({
      userId: req.user.id,
      empleado,
      cliente,
      tipo,
      fechaHora,
      lat,
      lng,
      empresaId,
      reqIp: clientIp,
    });

    if (!evalResult.permitido) {
      return res.status(403).json({
        error: "Fichaje no permitido",
        detalles: evalResult.errores,
      });
    }

    /* =========================
       11. Insert
    ========================= */

    const [nuevo] = await sql`
  INSERT INTO fichajes_180 (

    user_id,
    empleado_id,
    cliente_id,
    empresa_id,
    jornada_id,

    tipo,
    fecha,
    estado,
    origen,

    -- NUEVO GEO
    geo_distancia,
    geo_sospechoso,
    geo_motivos,
    geo_direccion,

    gps_accuracy,
    ip_info,

    -- LEGACY (compatibilidad)
    sospechoso,
    sospecha_motivo,
    direccion,
    ciudad,
    pais

  )
  VALUES (

    ${req.user.id},
    ${empleadoId},
    ${cliente?.id || null},
    ${empresaId},
    ${jornadaId},

    ${tipo},
    ${fechaHora},
    'confirmado',
    'app',

    -- GEO NUEVO
    ${evalResult.geo?.distancia || null},
    ${evalResult.sospechoso},
    ${JSON.stringify(evalResult.razones || [])},
    ${JSON.stringify(evalResult.geo?.direccion || null)},

    ${accuracy || null},
    ${evalResult.ipInfo || null},

    -- LEGACY
    ${evalResult.sospechoso},
    ${evalResult.razones?.join(" | ") || null},
    ${evalResult.geo?.direccion?.direccion || null},
    ${evalResult.geo?.direccion?.ciudad || null},
    ${evalResult.geo?.direccion?.pais || null}

  )
  RETURNING *
`;

    /* =========================
       12. Cierre jornada
    ========================= */

    if (tipo === "salida" && jornadaId) {
      const j = await recalcularJornada(jornadaId);

      await cerrarJornada({
        jornadaId,
        fin: fechaHora,
        minutos_trabajados: j?.minutos_trabajados || 0,
        minutos_descanso: j?.minutos_descanso || 0,
        minutos_extra: j?.minutos_extra || 0,
        origen_cierre: "app",
      });
    } else if (jornadaId) {
      await recalcularJornada(jornadaId);
    }

    /* =========================
       13. Daily report
    ========================= */

    try {
      await syncDailyReport({
        empresaId,
        empleadoId,
        fecha: fechaHora,
      });
    } catch (e) {
      console.error("❌ DAILY REPORT ERROR:", e);
    }

    return res.json({
      success: true,
      fichaje: nuevo,
      incidencias: evalResult.incidencias,
    });
  } catch (err) {
    console.error("❌ Error en createFichaje:", err);

    return res.status(500).json({
      error: "Error al registrar fichaje",
    });
  }
};

//
// FICH. SOSPECHOSOS + FILTROS
//
export const getFichajesSospechosos = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    const empresa = await sql`
      SELECT id
      FROM empresa_180
      WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(400).json({ error: "Empresa no encontrada" });
    }

    const empresaId = empresa[0].id;

    const rows = await sql`
      SELECT 
        f.id,
        f.fecha,
        f.tipo,
        f.nota,
        f.sospechoso,
        f.sospecha_motivo,
        f.geo_direccion,
        f.geo_motivos,
        f.geo_sospechoso,
        f.direccion,
        f.ciudad,
        f.pais,
        f.ip_info,
        f.distancia_km,
        e.nombre AS nombre_empleado,
        -- Datos Cliente para mapa
        c.nombre AS nombre_cliente,
        c.lat AS cliente_lat,
        c.lng AS cliente_lng,
        c.radio_m AS cliente_radio
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      WHERE f.empresa_id = ${empresaId}
        AND f.sospechoso = true
      ORDER BY f.fecha DESC
    `;

    res.json(rows);
  } catch (err) {
    console.error("❌ Error getFichajesSospechosos:", err);
    res.status(500).json({ error: "Error obteniendo fichajes sospechosos" });
  }
};

//
// VALIDAR FICHAJE SOSPECHOSO
//
export const validarFichaje = async (req, res) => {
  try {
    const { id } = req.params;
    const { accion, motivo } = req.body;

    if (!["confirmar", "rechazar"].includes(accion)) {
      return res.status(400).json({ error: "Acción inválida" });
    }

    const adminEmpresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (adminEmpresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const empresaId = adminEmpresa[0].id;

    const fichajeRows = await sql`
      SELECT f.*, e.empresa_id, e.id as empleado_id
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.id = ${id}
        AND e.empresa_id = ${empresaId}
      LIMIT 1
    `;

    if (fichajeRows.length === 0) {
      return res.status(404).json({ error: "Fichaje no encontrado" });
    }

    const fichajeAnterior = fichajeRows[0];
    const nuevoEstado = accion === "confirmar" ? "confirmado" : "rechazado";
    const notaAdmin = motivo ? `Admin: ${motivo}` : null;

    const update = await sql`
      UPDATE fichajes_180
      SET
        estado = ${nuevoEstado},
        sospechoso = false,
        sospecha_motivo = null,
        nota = CASE
          WHEN ${notaAdmin}::text IS NULL THEN nota
          ELSE concat_ws(' | ', NULLIF(nota, ''), ${notaAdmin}::text)
        END
      WHERE id = ${id}
      RETURNING *
    `;

    // Registrar en auditoría
    const { registrarAuditoria } = await import('../middlewares/auditMiddleware.js');
    await registrarAuditoria({
      empresaId,
      userId: req.user.id,
      empleadoId: fichajeAnterior.empleado_id,
      accion: accion === 'confirmar' ? 'fichaje_validado' : 'fichaje_rechazado',
      entidadTipo: 'fichaje',
      entidadId: id,
      datosAnteriores: fichajeAnterior,
      datosNuevos: update[0],
      motivo: motivo || null,
      req
    });

    return res.json({
      success: true,
      fichaje: update[0],
    });
  } catch (err) {
    console.error("❌ Error en validarFichaje:", err);
    return res.status(500).json({ error: "Error al actualizar fichaje" });
  }
};

/**
 * Validar o rechazar múltiples fichajes sospechosos
 */
export const validarFichajesMasivo = async (req, res) => {
  try {
    const { ids, accion, motivo } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Debe proporcionar al menos un ID" });
    }

    if (!["confirmar", "rechazar"].includes(accion)) {
      return res.status(400).json({ error: "Acción inválida" });
    }

    const adminEmpresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (adminEmpresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const empresaId = adminEmpresa[0].id;

    // Obtener todos los fichajes a actualizar
    const fichajes = await sql`
      SELECT f.*, e.empresa_id, e.id as empleado_id
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.id = ANY(${ids})
        AND e.empresa_id = ${empresaId}
        AND f.sospechoso = true
    `;

    if (fichajes.length === 0) {
      return res.status(404).json({ error: "No se encontraron fichajes sospechosos" });
    }

    const nuevoEstado = accion === "confirmar" ? "confirmado" : "rechazado";
    const notaAdmin = motivo ? `Admin: ${motivo}` : null;

    // Actualizar todos los fichajes
    const updated = await sql`
      UPDATE fichajes_180
      SET
        estado = ${nuevoEstado},
        sospechoso = false,
        sospecha_motivo = null,
        nota = CASE
          WHEN ${notaAdmin}::text IS NULL THEN nota
          ELSE concat_ws(' | ', NULLIF(nota, ''), ${notaAdmin}::text)
        END
      WHERE id = ANY(${ids})
        AND id IN (
          SELECT f.id FROM fichajes_180 f
          JOIN employees_180 e ON e.id = f.empleado_id
          WHERE e.empresa_id = ${empresaId}
        )
      RETURNING *
    `;

    // Registrar en auditoría cada fichaje
    const { registrarAuditoria } = await import('../middlewares/auditMiddleware.js');
    
    for (const fichaje of fichajes) {
      const fichajeActualizado = updated.find(u => u.id === fichaje.id);
      
      await registrarAuditoria({
        empresaId,
        userId: req.user.id,
        empleadoId: fichaje.empleado_id,
        accion: accion === 'confirmar' ? 'fichaje_validado' : 'fichaje_rechazado',
        entidadTipo: 'fichaje',
        entidadId: fichaje.id,
        datosAnteriores: fichaje,
        datosNuevos: fichajeActualizado,
        motivo: motivo || `Acción masiva: ${accion}`,
        req
      });
    }

    return res.json({
      success: true,
      procesados: updated.length,
      fichajes: updated,
    });
  } catch (err) {
    console.error("❌ Error en validarFichajesMasivo:", err);
    return res.status(500).json({ error: "Error al actualizar fichajes" });
  }
};

//
// FICHAJES DEL DÍA DEL USUARIO
//
export const getTodayFichajes = async (req, res) => {
  try {
    const hoy = new Date().toISOString().split("T")[0];

    // Ver si es empleado
    const empleado = await sql`
      SELECT id FROM employees_180 
      WHERE user_id = ${req.user.id}
    `;

    let resultados;

    if (empleado.length > 0) {
      // Es empleado → fichajes por empleado
      resultados = await sql`
        SELECT *
        FROM fichajes_180
        WHERE empleado_id = ${empleado[0].id}
        AND fecha::date = ${hoy}
        ORDER BY fecha ASC
      `;
    } else {
      // Es autónomo → fichajes por user_id
      resultados = await sql`
        SELECT *
        FROM fichajes_180
        WHERE user_id = ${req.user.id}
        AND fecha::date = ${hoy}
        ORDER BY fecha ASC
      `;
    }

    return res.json(resultados);
  } catch (err) {
    console.error("❌ Error en getTodayFichajes:", err);
    return res.status(500).json({
      error: "Error al obtener fichajes del día",
    });
  }
};

export const registrarFichajeManual = async (req, res) => {
  try {
    const { empleado_id, tipo, fecha_hora, motivo } = req.body;

    if (!empleado_id || !tipo || !fecha_hora) {
      return res.status(400).json({
        error: "Empleado, tipo y fecha_hora son obligatorios",
      });
    }

    const tiposValidos = [
      "entrada",
      "salida",
      "descanso_inicio",
      "descanso_fin",
    ];
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ error: "Tipo no válido" });
    }

    const fechaHora = new Date(fecha_hora);

    // =========================
    // EMPLEADO
    // =========================
    const empleadoRows = await sql`
      SELECT id, empresa_id, user_id
      FROM employees_180
      WHERE id = ${empleado_id}
    `;

    if (empleadoRows.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado" });
    }

    const empleado = empleadoRows[0];

    // =========================
    // JORNADA
    // =========================
    let jornada = await obtenerJornadaAbierta(empleado_id);

    if (tipo === "entrada") {
      if (!jornada) {
        jornada = await crearJornada({
          empresaId: empleado.empresa_id,
          empleadoId: empleado_id,
          inicio: fechaHora,
        });
      }
    } else {
      if (!jornada) {
        return res.status(400).json({
          error: "No hay jornada abierta para este fichaje",
        });
      }
    }

    // =========================
    // INSERT
    // =========================
    const nuevo = await sql`
      INSERT INTO fichajes_180 (
        empleado_id,
        empresa_id,
        user_id,
        jornada_id,
        tipo,
        fecha,
        estado,
        origen,
        nota,
        sospechoso,
        creado_manual
      )
      VALUES (
        ${empleado_id},
        ${empleado.empresa_id},
        ${empleado.user_id},
        ${jornada.id},
        ${tipo},
        ${fechaHora},
        'confirmado',
        'app',
        ${motivo || null},
        false,
        true
      )
      RETURNING *
    `;
    await recalcularJornada(jornada.id);

    try {
      await syncDailyReport({
        empresaId,
        empleadoId,
        fecha: fechaHora,
      });
    } catch (e) {
      console.error("❌ DAILY REPORT ERROR:", e);
    }

    return res.json(nuevo[0]);
  } catch (err) {
    console.error("❌ Error fichaje manual:", err);
    return res.status(500).json({
      error: "Error registrando fichaje manual",
    });
  }
};

export const getFichajeDetalle = async (req, res) => {
  try {
    const { id } = req.params;

    const empresa = await sql`
      SELECT id FROM empresa_180
      WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const empresaId = empresa[0].id;

    const fichaje = await sql`
      SELECT 
        f.*,
        e.nombre AS empleado_nombre
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.id = ${id}
        AND f.empresa_id = ${empresaId}
      LIMIT 1
    `;

    if (fichaje.length === 0) {
      return res.status(404).json({ error: "Fichaje no encontrado" });
    }

    res.json(fichaje[0]);
  } catch (err) {
    console.error("❌ Error getFichajeDetalle:", err);
    res.status(500).json({ error: "Error cargando detalle" });
  }
};

export const getFichajes = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    const empresaRows = await sql`
      SELECT id
      FROM empresa_180
      WHERE user_id = ${req.user.id}
    `;

    if (empresaRows.length === 0) {
      return res.status(400).json({ error: "Empresa no encontrada" });
    }

    const empresaId = empresaRows[0].id;

    const fichajes = await sql`
      SELECT
        f.id,
        f.jornada_id,
        f.fecha,
        f.tipo,
        f.sospechoso,
        f.nota,
        f.direccion,
        f.ciudad,
        f.pais,
        e.nombre AS nombre_empleado
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.empresa_id = ${empresaId}
      ORDER BY f.fecha DESC
    `;

    res.json(fichajes);
  } catch (err) {
    console.error("❌ Error en getFichajes:", err);
    res.status(500).json({ error: "Error obteniendo fichajes" });
  }
};
