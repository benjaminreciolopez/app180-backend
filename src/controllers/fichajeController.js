// backend\src\controllers\fichajeController.js

import { sql } from "../db.js";
import { ejecutarAutocierre } from "../jobs/autocierre.js";
import { detectarFichajeSospechoso } from "../services/fichajeSospechoso.js";
import { validarFichajeSegunTurno } from "../services/fichajesValidacionService.js";
import {
  obtenerJornadaAbierta,
  crearJornada,
} from "../services/jornadasService.js";
import { syncDailyReport } from "../services/dailyReportService.js";
import { reverseGeocode } from "../utils/reverseGeocode.js";

//
// Obtener último fichaje del empleado/autónomo
//
const getLastFichaje = async (empleadoId) => {
  const rows = await sql`
    SELECT 
      id,
      tipo,
      fecha,
      jornada_id
    FROM fichajes_180
    WHERE empleado_id = ${empleadoId}
    ORDER BY fecha DESC
    LIMIT 1
  `;

  return rows.length ? rows[0] : null;
};

//
// Registrar fichaje
//
export const createFichaje = async (req, res) => {
  try {
    const { tipo, cliente_id, lat, lng, fecha_hora } = req.body;

    const tiposValidos = [
      "entrada",
      "salida",
      "descanso_inicio",
      "descanso_fin",
    ];
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ error: "Tipo de fichaje no válido" });
    }

    const fechaHora = fecha_hora ? new Date(fecha_hora) : new Date();

    // =========================
    // EMPLEADO
    // =========================
    const empleadoRows = await sql`
      SELECT id, activo, empresa_id, tipo_trabajo, turno_id
      FROM employees_180
      WHERE user_id = ${req.user.id}
    `;

    if (empleadoRows.length === 0) {
      return res.status(403).json({ error: "Usuario no es empleado" });
    }

    const empleado = empleadoRows[0];
    const empleadoId = empleado.id;
    const empresaId = empleado.empresa_id;

    if (!empleado.activo) {
      return res.status(403).json({ error: "Empleado desactivado" });
    }

    // =========================
    // AUSENCIAS
    // =========================
    const hoy = fechaHora.toISOString().split("T")[0];
    const ausencia = await sql`
      SELECT 1
      FROM ausencias_180
      WHERE empleado_id = ${empleadoId}
        AND estado = 'aprobado'
        AND fecha_inicio <= ${hoy}
        AND fecha_fin >= ${hoy}
    `;

    if (ausencia.length > 0) {
      return res.status(403).json({
        error: "No puedes fichar durante una ausencia aprobada",
      });
    }

    // =========================
    // CLIENTE OBLIGATORIO
    // =========================
    if (tipo === "entrada" && empleado.tipo_trabajo === "oficina") {
      const clientes = await sql`
        SELECT 1 FROM clients_180 WHERE empresa_id = ${empresaId}
      `;
      if (clientes.length > 0 && !cliente_id) {
        return res.status(400).json({
          error: "Debes seleccionar un cliente",
        });
      }
    }

    // =========================
    // VALIDACIÓN TURNO
    // =========================
    const validacionTurno = await validarFichajeSegunTurno({
      empleadoId,
      empresaId,
      fechaHora,
      tipo,
    });

    if (!validacionTurno.ok) {
      return res
        .status(validacionTurno.status || 400)
        .json({ error: validacionTurno.error });
    }

    // NO bloquear por turno: solo recoger incidencias
    const incidenciasTurno = validacionTurno.incidencias || [];

    // =========================
    // SECUENCIA
    // =========================
    const last = await getLastFichaje(empleadoId);

    if (tipo === "entrada" && last && last.tipo !== "salida") {
      return res.status(400).json({ error: "Ya hay una entrada abierta" });
    }

    if (tipo === "salida" && (!last || last.tipo !== "entrada")) {
      return res.status(400).json({ error: "Debes fichar entrada antes" });
    }

    // =========================
    // AUTOCIERRE (ANTES)
    // =========================
    if (tipo === "entrada" || tipo === "salida") {
      await ejecutarAutocierre();
    }

    // =========================
    // JORNADA
    // =========================
    let jornada = await obtenerJornadaAbierta(empleadoId);
    let jornadaId = null;

    if (tipo === "entrada") {
      if (!jornada) {
        jornada = await crearJornada({
          empresaId,
          empleadoId,
          inicio: fechaHora,
          incidencia: incidenciasTurno.length
            ? incidenciasTurno.join(" | ")
            : null,
        });
      }
      jornadaId = jornada.id;
    }

    // =========================
    // SOSPECHOSO
    // =========================
    const analisis = await detectarFichajeSospechoso({
      userId: req.user.id,
      empleadoId,
      tipo,
      lat,
      lng,
      clienteId: cliente_id || null,
      deviceHash: req.headers["x-device-id"] || null,
      reqIp: req.ip,
    });

    const estado = analisis.sospechoso ? "sospechoso" : "confirmado";
    const nota = analisis.sospechoso ? analisis.razones.join(" | ") : null;
    // =========================
    // DIRECCIÓN (OpenStreetMap)
    // Prioridad: GPS -> IP actual
    // =========================
    let direccion = null;
    let ciudad = null;
    let pais = null;

    // GPS válido
    const gpsOk =
      lat != null &&
      lng != null &&
      Number.isFinite(Number(lat)) &&
      Number.isFinite(Number(lng)) &&
      Number(lat) >= -90 &&
      Number(lat) <= 90 &&
      Number(lng) >= -180 &&
      Number(lng) <= 180;

    const latUse = gpsOk
      ? Number(lat)
      : analisis?.ipInfo?.actual?.lat != null
      ? Number(analisis.ipInfo.actual.lat)
      : null;

    const lngUse = gpsOk
      ? Number(lng)
      : analisis?.ipInfo?.actual?.lng != null
      ? Number(analisis.ipInfo.actual.lng)
      : null;

    if (latUse != null && lngUse != null) {
      const geo = await reverseGeocode({ lat: latUse, lng: lngUse });
      if (geo) {
        direccion = geo.direccion;
        ciudad = geo.ciudad;
        pais = geo.pais;
      }
    }

    // =========================
    // INSERT
    // =========================
    const nuevo = await sql`
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
        nota,
        sospechoso,
        direccion,
        ciudad,
        pais
      )
      VALUES (
        ${req.user.id},
        ${empleadoId},
        ${cliente_id || null},
        ${empresaId},
        ${jornadaId},
        ${tipo},
        ${fechaHora},
        ${estado},
        'app',
        ${nota},
        ${analisis.sospechoso},
        ${direccion},
        ${ciudad},
        ${pais}
      )
      RETURNING *
    `;
    await syncDailyReport({
      empresaId,
      empleadoId,
      fecha: fechaHora,
    });

    return res.json({ success: true, fichaje: nuevo[0] });
  } catch (err) {
    console.error("❌ Error en createFichaje:", err);
    return res.status(500).json({ error: "Error al registrar fichaje" });
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

    // Obtener empresa del admin
    const empresa = await sql`
      SELECT id
      FROM empresa_180
      WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(400).json({ error: "Empresa no encontrada" });
    }

    const empresaId = empresa[0].id;

    // Obtener IDs de empleados de la empresa
    const empleados = await sql`
      SELECT id FROM employees_180
      WHERE empresa_id = ${empresaId}
    `;

    if (empleados.length === 0) return res.json([]); // No hay fichajes

    const empleadoIds = empleados.map((e) => e.id);

    const resultados = await sql`
      SELECT 
        f.*,
        u.nombre AS nombre_usuario,
        c.nombre AS nombre_cliente,
        e.nombre AS nombre_empleado
      FROM fichajes_180 f
      LEFT JOIN users_180 u ON u.id = f.user_id
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      LEFT JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.empleado_id = ANY(${empleadoIds})
      AND f.sospechoso = true
      ORDER BY f.fecha DESC
    `;

    return res.json(resultados);
  } catch (err) {
    console.error("❌ Error en getFichajesSospechosos:", err);
    return res.status(500).json({
      error: "Error al obtener fichajes sospechosos",
    });
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
      SELECT f.id, f.estado, f.sospechoso, f.nota, e.empresa_id
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.id = ${id}
        AND e.empresa_id = ${empresaId}
      LIMIT 1
    `;

    if (fichajeRows.length === 0) {
      return res.status(404).json({ error: "Fichaje no encontrado" });
    }

    const nuevoEstado = accion === "confirmar" ? "confirmado" : "rechazado";
    const notaAdmin = motivo ? `Admin: ${motivo}` : null;

    const update = await sql`
      UPDATE fichajes_180
      SET
        estado = ${nuevoEstado},
        sospechoso = false,
        nota = CASE
          WHEN ${notaAdmin}::text IS NULL THEN nota
          ELSE concat_ws(' | ', NULLIF(nota, ''), ${notaAdmin}::text)
        END
      WHERE id = ${id}
      RETURNING *
    `;

    return res.json({
      success: true,
      fichaje: update[0],
    });
  } catch (err) {
    console.error("❌ Error en validarFichaje:", err);
    return res.status(500).json({ error: "Error al actualizar fichaje" });
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
    await syncDailyReport({
      empresaId: empleado.empresa_id,
      empleadoId: empleado_id,
      fecha: fechaHora, // vale Date
    });
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

    // empresa del admin
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
        f.id,
        f.jornada_id,
        f.fecha,
        f.tipo,
        f.estado,
        f.sospechoso,
        f.nota,
        f.origen,
        f.creado_manual,
        e.nombre AS nombre_empleado
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.id = ${id}
      AND e.empresa_id = ${empresaId}
    `;

    if (fichaje.length === 0) {
      return res.status(404).json({ error: "Fichaje no encontrado" });
    }

    res.json(fichaje[0]);
  } catch (err) {
    console.error("❌ Error en getFichajeDetalle:", err);
    res.status(500).json({ error: "Error cargando detalle" });
  }
};

export const getFichajes = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    // =========================
    // EMPRESA DEL ADMIN
    // =========================
    const empresaRows = await sql`
      SELECT id
      FROM empresa_180
      WHERE user_id = ${req.user.id}
    `;

    if (empresaRows.length === 0) {
      return res.status(400).json({ error: "Empresa no encontrada" });
    }

    const empresaId = empresaRows[0].id;

    // =========================
    // FICHAJES
    // =========================
    const fichajes = await sql`
      SELECT
        f.id,
        f.jornada_id,
        f.fecha,
        f.tipo,
        f.sospechoso,
        f.nota,
        e.nombre AS nombre_empleado
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      WHERE e.empresa_id = ${empresaId}
      ORDER BY f.fecha DESC
    `;

    return res.json(fichajes);
  } catch (err) {
    console.error("❌ Error en getFichajes:", err);
    return res.status(500).json({
      error: "Error obteniendo fichajes",
    });
  }
};
