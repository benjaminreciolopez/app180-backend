// backend/src/controllers/asesorRRHHController.js
// Endpoints RRHH (fichajes y ausencias) accesibles desde el portal asesor,
// scopeados a la empresa cliente seleccionada (req.targetEmpresaId, validado
// por asesorClienteRequired).

import { sql } from "../db.js";
import { crearNotificacionSistema } from "./notificacionesController.js";

// ============================================================
// FICHAJES
// ============================================================

/**
 * GET /asesor/clientes/:empresa_id/fichajes
 * Listar fichajes de la empresa cliente (con filtros opcionales).
 */
export const listarFichajes = async (req, res) => {
  try {
    const empresaId = req.targetEmpresaId;
    const { desde, hasta, empleado_id } = req.query;

    let query = sql`
      SELECT
        f.id, f.empleado_id, f.fecha, f.tipo, f.estado,
        f.sospechoso, f.sospecha_motivo, f.nota,
        f.direccion, f.ciudad, f.pais,
        e.nombre AS nombre_empleado
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.empresa_id = ${empresaId}
    `;
    if (desde) query = sql`${query} AND f.fecha >= ${desde}`;
    if (hasta) query = sql`${query} AND f.fecha <= ${hasta}`;
    if (empleado_id) query = sql`${query} AND f.empleado_id = ${empleado_id}`;
    query = sql`${query} ORDER BY f.fecha DESC LIMIT 500`;

    const rows = await query;
    return res.json({ success: true, total: rows.length, fichajes: rows });
  } catch (err) {
    console.error("Error asesor listarFichajes:", err);
    return res.status(500).json({ error: "Error obteniendo fichajes" });
  }
};

/**
 * GET /asesor/clientes/:empresa_id/fichajes/sospechosos
 */
export const listarFichajesSospechosos = async (req, res) => {
  try {
    const empresaId = req.targetEmpresaId;
    const rows = await sql`
      SELECT
        f.id, f.empleado_id, f.fecha, f.tipo, f.nota,
        f.sospechoso, f.sospecha_motivo,
        f.geo_direccion, f.geo_motivos, f.geo_sospechoso,
        f.direccion, f.ciudad, f.pais, f.distancia_km,
        e.nombre AS nombre_empleado,
        c.nombre AS nombre_cliente,
        c.lat AS cliente_lat, c.lng AS cliente_lng, c.radio_m AS cliente_radio
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      WHERE f.empresa_id = ${empresaId}
        AND f.sospechoso = true
      ORDER BY f.fecha DESC
      LIMIT 200
    `;
    return res.json({ success: true, total: rows.length, fichajes: rows });
  } catch (err) {
    console.error("Error asesor listarFichajesSospechosos:", err);
    return res.status(500).json({ error: "Error obteniendo fichajes sospechosos" });
  }
};

/**
 * PUT /asesor/clientes/:empresa_id/fichajes/:id/validar
 * Body: { accion: 'confirmar' | 'rechazar', motivo?: string }
 */
export const validarFichaje = async (req, res) => {
  try {
    const empresaId = req.targetEmpresaId;
    const { id } = req.params;
    const { accion, motivo } = req.body;

    if (!["confirmar", "rechazar"].includes(accion)) {
      return res.status(400).json({ error: "Acción inválida (confirmar | rechazar)" });
    }

    const [existing] = await sql`
      SELECT f.id, f.empleado_id
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.id = ${id} AND e.empresa_id = ${empresaId}
      LIMIT 1
    `;
    if (!existing) {
      return res.status(404).json({ error: "Fichaje no encontrado" });
    }

    const nuevoEstado = accion === "confirmar" ? "confirmado" : "rechazado";
    const notaAdmin = motivo ? `Asesor: ${motivo}` : null;

    const [updated] = await sql`
      UPDATE fichajes_180
      SET estado = ${nuevoEstado},
          sospechoso = false,
          sospecha_motivo = NULL,
          nota = CASE
            WHEN ${notaAdmin}::text IS NULL THEN nota
            ELSE concat_ws(' | ', NULLIF(nota, ''), ${notaAdmin}::text)
          END
      WHERE id = ${id}
      RETURNING *
    `;

    return res.json({ success: true, fichaje: updated });
  } catch (err) {
    console.error("Error asesor validarFichaje:", err);
    return res.status(500).json({ error: "Error validando fichaje" });
  }
};

/**
 * PUT /asesor/clientes/:empresa_id/fichajes/validar-masivo
 * Body: { ids: string[], accion: 'confirmar' | 'rechazar', motivo?: string }
 */
export const validarFichajesMasivo = async (req, res) => {
  try {
    const empresaId = req.targetEmpresaId;
    const { ids = [], accion, motivo } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids requerido" });
    }
    if (!["confirmar", "rechazar"].includes(accion)) {
      return res.status(400).json({ error: "Acción inválida" });
    }

    const nuevoEstado = accion === "confirmar" ? "confirmado" : "rechazado";
    const notaAdmin = motivo ? `Asesor: ${motivo}` : null;

    const updated = await sql`
      UPDATE fichajes_180 f
      SET estado = ${nuevoEstado},
          sospechoso = false,
          sospecha_motivo = NULL,
          nota = CASE
            WHEN ${notaAdmin}::text IS NULL THEN f.nota
            ELSE concat_ws(' | ', NULLIF(f.nota, ''), ${notaAdmin}::text)
          END
      FROM employees_180 e
      WHERE f.id = ANY(${ids}::uuid[])
        AND f.empleado_id = e.id
        AND e.empresa_id = ${empresaId}
      RETURNING f.id
    `;

    return res.json({ success: true, total: updated.length, ids: updated.map(r => r.id) });
  } catch (err) {
    console.error("Error asesor validarFichajesMasivo:", err);
    return res.status(500).json({ error: "Error validando fichajes" });
  }
};

// ============================================================
// AUSENCIAS
// ============================================================

/**
 * GET /asesor/clientes/:empresa_id/ausencias?estado=pendiente
 */
export const listarAusencias = async (req, res) => {
  try {
    const empresaId = req.targetEmpresaId;
    const { estado } = req.query;
    const estadoSafe = estado || null;

    const rows = await sql`
      SELECT a.*, e.nombre AS empleado_nombre
      FROM ausencias_180 a
      JOIN employees_180 e ON e.id = a.empleado_id
      WHERE a.empresa_id = ${empresaId}
        AND (${estadoSafe}::text IS NULL OR a.estado = ${estadoSafe})
      ORDER BY a.creado_en DESC NULLS LAST, a.fecha_inicio DESC
      LIMIT 300
    `;
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, total: rows.length, ausencias: rows });
  } catch (err) {
    console.error("Error asesor listarAusencias:", err);
    return res.status(500).json({ error: "Error obteniendo ausencias" });
  }
};

/**
 * PUT /asesor/clientes/:empresa_id/ausencias/:id/aprobar
 */
export const aprobarAusencia = async (req, res) => {
  try {
    const empresaId = req.targetEmpresaId;
    const { id } = req.params;

    const [updated] = await sql`
      UPDATE ausencias_180
      SET estado = 'aprobado'
      WHERE id = ${id} AND empresa_id = ${empresaId}
      RETURNING *
    `;
    if (!updated) {
      return res.status(404).json({ error: "Ausencia no encontrada" });
    }

    // Notificar al empleado
    try {
      const [empUser] = await sql`SELECT user_id FROM employees_180 WHERE id = ${updated.empleado_id}`;
      if (empUser?.user_id) {
        await crearNotificacionSistema({
          empresaId,
          userId: empUser.user_id,
          tipo: "success",
          titulo: "Ausencia aprobada",
          mensaje: `Tu solicitud del ${updated.fecha_inicio} al ${updated.fecha_fin} ha sido aprobada por la asesoría.`,
          accionUrl: "/empleado/ausencias",
          accionLabel: "Ver ausencias",
        });
      }
    } catch (e) { console.warn("Notif no enviada:", e.message); }

    return res.json({ success: true, ausencia: updated });
  } catch (err) {
    console.error("Error asesor aprobarAusencia:", err);
    return res.status(500).json({ error: "Error aprobando ausencia" });
  }
};

/**
 * PUT /asesor/clientes/:empresa_id/ausencias/:id/rechazar
 */
export const rechazarAusencia = async (req, res) => {
  try {
    const empresaId = req.targetEmpresaId;
    const { id } = req.params;
    const { motivo } = req.body || {};

    const notaMotivo = motivo ? `Asesor: ${motivo}` : null;
    const [updated] = await sql`
      UPDATE ausencias_180
      SET estado = 'rechazado',
          comentario_admin = CASE
            WHEN ${notaMotivo}::text IS NULL THEN comentario_admin
            ELSE concat_ws(' | ', NULLIF(comentario_admin, ''), ${notaMotivo}::text)
          END
      WHERE id = ${id} AND empresa_id = ${empresaId}
      RETURNING *
    `;
    if (!updated) {
      return res.status(404).json({ error: "Ausencia no encontrada" });
    }

    try {
      const [empUser] = await sql`SELECT user_id FROM employees_180 WHERE id = ${updated.empleado_id}`;
      if (empUser?.user_id) {
        await crearNotificacionSistema({
          empresaId,
          userId: empUser.user_id,
          tipo: "warning",
          titulo: "Ausencia rechazada",
          mensaje: `Tu solicitud del ${updated.fecha_inicio} al ${updated.fecha_fin} ha sido rechazada por la asesoría.`,
          accionUrl: "/empleado/ausencias",
          accionLabel: "Ver ausencias",
        });
      }
    } catch (e) { console.warn("Notif no enviada:", e.message); }

    return res.json({ success: true, ausencia: updated });
  } catch (err) {
    console.error("Error asesor rechazarAusencia:", err);
    return res.status(500).json({ error: "Error rechazando ausencia" });
  }
};

/**
 * POST /asesor/clientes/:empresa_id/ausencias
 * Body: { empleado_id, tipo, fecha_inicio, fecha_fin, comentario?, motivo? }
 * Crea una ausencia ya aprobada (igual que crearAusenciaAdmin).
 */
export const crearAusenciaAsesor = async (req, res) => {
  try {
    const empresaId = req.targetEmpresaId;
    const { empleado_id, tipo, fecha_inicio, fecha_fin, comentario, motivo } = req.body || {};

    if (!empleado_id || !tipo || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({ error: "empleado_id, tipo, fecha_inicio y fecha_fin son requeridos" });
    }
    if (!["vacaciones", "baja_medica"].includes(tipo)) {
      return res.status(400).json({ error: "tipo debe ser vacaciones | baja_medica" });
    }
    if (fecha_inicio > fecha_fin) {
      return res.status(400).json({ error: "fecha_inicio no puede ser posterior a fecha_fin" });
    }

    // Verificar que el empleado pertenece a la empresa
    const [emp] = await sql`
      SELECT id FROM employees_180 WHERE id = ${empleado_id} AND empresa_id = ${empresaId} LIMIT 1
    `;
    if (!emp) {
      return res.status(404).json({ error: "Empleado no encontrado en esta empresa" });
    }

    const [creada] = await sql`
      INSERT INTO ausencias_180 (
        empresa_id, empleado_id, tipo, fecha_inicio, fecha_fin,
        comentario_admin, motivo, estado, creado_en
      ) VALUES (
        ${empresaId}, ${empleado_id}, ${tipo}, ${fecha_inicio}, ${fecha_fin},
        ${comentario || null}, ${motivo || null}, 'aprobado', now()
      )
      RETURNING *
    `;

    return res.status(201).json({ success: true, ausencia: creada });
  } catch (err) {
    console.error("Error asesor crearAusencia:", err);
    return res.status(500).json({ error: "Error creando ausencia" });
  }
};
