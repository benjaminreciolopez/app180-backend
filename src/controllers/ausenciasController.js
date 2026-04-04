import { sql } from "../db.js";
import { autoPushToGoogle } from "../services/calendarPushService.js";
import { crearNotificacionSistema } from "./notificacionesController.js";
import { resolveEmpresaId } from "../services/resolveEmpresaId.js";

async function haySolapeAprobado({
  empleadoId,
  empresaId,
  desde,
  hasta,
  excludeId,
}) {
  const rows = await sql`
    SELECT id, tipo, fecha_inicio, fecha_fin, estado
    FROM ausencias_180
    WHERE empresa_id = ${empresaId}
      AND empleado_id = ${empleadoId}
      AND estado = 'aprobado'
      AND (${excludeId}::uuid IS NULL OR id <> ${excludeId})
      AND NOT (
        fecha_fin < ${desde} OR fecha_inicio > ${hasta}
      )
    LIMIT 1
  `;
  return rows[0] || null;
}
async function hayFestivosEnRango({ empresaId, desde, hasta }) {
  const rows = await sql`
    SELECT COUNT(*)::int AS n
    FROM v_dia_laborable_empresa_180
    WHERE empresa_id = ${empresaId}
      AND fecha BETWEEN ${desde} AND ${hasta}
      AND es_laborable = false
  `;
  return (rows[0]?.n || 0) > 0;
}

export const aprobarVacaciones = async (req, res) => {
  try {
    const { id } = req.params;

    const update = await sql`
      UPDATE ausencias_180
      SET estado = 'aprobado'
      WHERE id = ${id} AND tipo = 'vacaciones'
      RETURNING *
    `;

    if (update.length === 0) {
      return res.status(400).json({ error: "Ausencia no encontrada" });
    }


    // Push a Google Calendar (asíncrono)
    const empresaId = update[0].empresa_id || await resolveEmpresaId(req);
    if (empresaId) autoPushToGoogle(empresaId, 'ausencias', id);

    // Notificar al empleado
    try {
      const [empUser] = await sql`SELECT user_id FROM employees_180 WHERE id = ${update[0].empleado_id}`;
      if (empUser?.user_id) {
        await crearNotificacionSistema({
          empresaId,
          userId: empUser.user_id,
          tipo: "success",
          titulo: "Vacaciones aprobadas",
          mensaje: `Tu solicitud de vacaciones del ${update[0].fecha_inicio} al ${update[0].fecha_fin} ha sido aprobada.`,
          accionUrl: "/empleado/ausencias",
          accionLabel: "Ver ausencias",
        });
      }
    } catch (notifErr) { console.warn("Notificación no enviada:", notifErr.message); }

    res.json({ success: true, ausencia: update[0] });
  } catch (err) {
    console.error("Error aprobarVacaciones:", err);
    res.status(500).json({ error: "Error al aprobar vacaciones" });
  }
};
export const rechazarVacaciones = async (req, res) => {
  try {
    const { id } = req.params;

    const update = await sql`
      UPDATE ausencias_180
      SET estado = 'rechazado'
      WHERE id = ${id} AND tipo = 'vacaciones'
      RETURNING *
    `;

    if (update.length === 0) {
      return res.status(400).json({ error: "Ausencia no encontrada" });
    }

    // Notificar al empleado
    try {
      const empresaId = update[0].empresa_id || req.user.empresa_id;
      const [empUser] = await sql`SELECT user_id FROM employees_180 WHERE id = ${update[0].empleado_id}`;
      if (empUser?.user_id) {
        await crearNotificacionSistema({
          empresaId,
          userId: empUser.user_id,
          tipo: "warning",
          titulo: "Ausencia rechazada",
          mensaje: `Tu solicitud de ausencia del ${update[0].fecha_inicio} al ${update[0].fecha_fin} ha sido rechazada.`,
          accionUrl: "/empleado/ausencias",
          accionLabel: "Ver ausencias",
        });
      }
    } catch (notifErr) { console.warn("Notificación no enviada:", notifErr.message); }

    res.json({ success: true, ausencia: update[0] });
  } catch (err) {
    console.error("Error rechazarVacaciones:", err);
    res.status(500).json({ error: "Error al rechazar vacaciones" });
  }
};
export const crearBajaMedica = async (req, res) => {
  try {
    const { empleado_id, fecha_inicio, fecha_fin, motivo } = req.body;

    if (!empleado_id || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        error: "empleado_id, fecha_inicio y fecha_fin son obligatorios",
      });
    }
    if (fecha_inicio > fecha_fin) {
      return res
        .status(400)
        .json({ error: "La fecha de inicio no puede ser mayor que la de fin" });
    }

    // Empresa del admin
    const empresaId = await resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada" });

    // Validar que el empleado pertenece a la empresa
    const emp = await sql`
      SELECT id FROM employees_180
      WHERE id = ${empleado_id}
        AND empresa_id = ${empresaId}
      LIMIT 1
    `;
    if (!emp.length) {
      return res
        .status(400)
        .json({ error: "Empleado no pertenece a tu empresa" });
    }

    // Bloquear solape con ausencias aprobadas (vacaciones o bajas)
    const solape = await haySolapeAprobado({
      empleadoId: empleado_id,
      empresaId,
      desde: fecha_inicio,
      hasta: fecha_fin,
      excludeId: null,
    });
    if (solape) {
      return res.status(400).json({
        error: "Solape con otra ausencia aprobada",
        conflict: solape,
      });
    }

    const aus = await sql`
      INSERT INTO ausencias_180 
      (empleado_id, empresa_id, tipo, fecha_inicio, fecha_fin, motivo, estado)
      VALUES (
        ${empleado_id},
        ${empresaId},
        'baja_medica',
        ${fecha_inicio},
        ${fecha_fin},
        ${motivo || null},
        'aprobado'
      )
      RETURNING *
    `;

    // Push a Google Calendar (asíncrono)
    autoPushToGoogle(empresaId, 'ausencias', aus[0].id);

    res.set("Cache-Control", "no-store");
    return res.json({ success: true, ausencia: aus[0] });
  } catch (err) {
    console.error("Error crearBajaMedica:", err);
    return res.status(500).json({ error: "Error al registrar baja médica" });
  }
};

// ausenciasController.js
export const listarAusenciasEmpresa = async (req, res) => {
  try {
    const { estado } = req.query; // <-- nuevo (opcional)
    const estadoSafe = estado === undefined ? null : estado;

    const empresaId = await resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada" });

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
    return res.json(rows);
  } catch (err) {
    console.error("Error listarAusenciasEmpresa:", err);
    res.status(500).json({ error: "Error al obtener ausencias" });
  }
};

export const solicitarAusencia = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;
    const { tipo, fecha_inicio, fecha_fin, comentario } = req.body;

    if (fecha_inicio > fecha_fin) {
      return res.status(400).json({
        error: "La fecha de inicio no puede ser posterior a la fecha de fin",
      });
    }

    if (!["vacaciones", "baja_medica"].includes(tipo)) {
      return res.status(400).json({ error: "Tipo de ausencia no válido" });
    }
    const solape = await haySolapeAprobado({
      empleadoId: empleado_id,
      empresaId: empresa_id,
      desde: fecha_inicio,
      hasta: fecha_fin,
      excludeId: null,
    });
    const festivos = await hayFestivosEnRango({
      empresaId: empresa_id,
      desde: fecha_inicio,
      hasta: fecha_fin,
    });

    const rows = await sql`
      INSERT INTO ausencias_180 (
        empleado_id,
        empresa_id,
        tipo,
        fecha_inicio,
        fecha_fin,
        comentario_empleado,
        estado
      ) VALUES (
        ${empleado_id},
        ${empresa_id},
        ${tipo},
        ${fecha_inicio},
        ${fecha_fin},
        ${comentario || null},
        'pendiente'
      )
      RETURNING *
    `;

    // Notificar admin
    try {
      const [adminUser] = await sql`SELECT user_id FROM empresa_180 WHERE id = ${empresa_id}`;
      const [empData] = await sql`SELECT nombre FROM employees_180 WHERE id = ${empleado_id}`;
      if (adminUser?.user_id) {
        const tipoLabel = tipo === "baja_medica" ? "baja médica" : "vacaciones";
        await crearNotificacionSistema({
          empresaId: empresa_id,
          userId: adminUser.user_id,
          tipo: "info",
          titulo: `Nueva solicitud de ${tipoLabel}`,
          mensaje: `${empData?.nombre || "Empleado"} ha solicitado ${tipoLabel} del ${fecha_inicio} al ${fecha_fin}.`,
          accionUrl: "/admin/ausencias",
          accionLabel: "Revisar solicitud",
        });
      }
    } catch (notifErr) { console.warn("Notificación no enviada:", notifErr.message); }

    res.json({
      ...rows[0],
      warning: !!solape,
      warning_conflict: solape || null,
      warning_festivos: !!festivos,
    });
  } catch (err) {
    console.error("Error solicitar ausencia:", err);
    res.status(500).json({ error: "Error solicitando ausencia" });
  }
};

export const misAusencias = async (req, res) => {
  try {
    const { empleado_id } = req.user;
    if (!empleado_id) return res.status(403).json({ error: "No autorizado" });

    const rows = await sql`
      SELECT id, tipo, fecha_inicio, fecha_fin, estado, comentario_empleado
      FROM ausencias_180
      WHERE empleado_id = ${empleado_id}
      ORDER BY creado_en DESC
      LIMIT 200
    `;
    res.set("Cache-Control", "no-store");
    res.json(rows);
  } catch (e) {
    console.error("Error misAusencias", e);
    res.status(500).json({ error: "Error obteniendo ausencias" });
  }
};
export const actualizarEstadoAusencia = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, comentario_admin } = req.body;
    const comentarioAdminSafe =
      comentario_admin === undefined ? null : comentario_admin;

    if (!["pendiente", "aprobado", "rechazado"].includes(estado)) {
      return res.status(400).json({ error: "Estado no válido" });
    }

    // 1) Obtener empresa
    const empresaId = await resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada" });

    // 2) Leer ausencia actual
    const current = await sql`
  SELECT id, empleado_id, fecha_inicio, fecha_fin, estado, tipo
  FROM ausencias_180
  WHERE id = ${id}
    AND empresa_id = ${empresaId}
  LIMIT 1
`;
    if (!current.length) {
      return res.status(404).json({ error: "Ausencia no encontrada" });
    }

    const a = current[0];

    // 3) Si vas a APROBAR → bloquear si solapa con otra aprobada
    if (estado === "aprobado") {
      const solape = await haySolapeAprobado({
        empleadoId: a.empleado_id,
        empresaId,
        desde: a.fecha_inicio,
        hasta: a.fecha_fin,
        excludeId: a.id,
      });

      if (solape) {
        return res.status(400).json({
          error: "No se puede aprobar: solapa con otra ausencia aprobada",
          conflict: solape,
        });
      }
    }

    const rows = await sql`
      UPDATE ausencias_180
      SET
        estado = ${estado},
        comentario_admin = COALESCE(${comentarioAdminSafe}::text, comentario_admin)
      WHERE id = ${id}
        AND empresa_id = ${empresaId}
      RETURNING *
    `;

    if (!rows.length)
      return res.status(404).json({ error: "Ausencia no encontrada" });


    // Push a Google Calendar (asíncrono)
    if (estado === 'aprobado' || a.estado === 'aprobado') {
      autoPushToGoogle(empresaId, 'ausencias', id);
    }

    res.json({ success: true, ausencia: rows[0] });
  } catch (err) {
    console.error("Error actualizarEstadoAusencia:", err);
    res.status(500).json({ error: "Error actualizando estado" });
  }
};
export const crearAusenciaAdmin = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "No autorizado" });
    }

    const { empleado_id, tipo, fecha_inicio, fecha_fin, comentario_admin } =
      req.body;

    if (!empleado_id || !tipo || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        error: "empleado_id, tipo, fecha_inicio y fecha_fin son obligatorios",
      });
    }

    if (!["vacaciones", "baja_medica"].includes(tipo)) {
      return res.status(400).json({ error: "Tipo no válido" });
    }

    if (fecha_inicio > fecha_fin) {
      return res
        .status(400)
        .json({ error: "La fecha de inicio no puede ser mayor que la de fin" });
    }

    const empresaId = await resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada" });

    // Validar que el empleado pertenece a la empresa
    const emp = await sql`
      SELECT id FROM employees_180
      WHERE id = ${empleado_id}
        AND empresa_id = ${empresaId}
      LIMIT 1
    `;
    if (!emp.length) {
      return res
        .status(400)
        .json({ error: "Empleado no pertenece a tu empresa" });
    }
    const solape = await haySolapeAprobado({
      empleadoId: empleado_id,
      empresaId,
      desde: fecha_inicio,
      hasta: fecha_fin,
      excludeId: null,
    });
    const festivos = await hayFestivosEnRango({
      empresaId,
      desde: fecha_inicio,
      hasta: fecha_fin,
    });
    const comentarioAdminSafe =
      comentario_admin === undefined ? null : comentario_admin;

    if (solape) {
      return res.status(400).json({
        error: "Solape con otra ausencia aprobada",
        conflict: solape,
      });
    }

    const rows = await sql`
      INSERT INTO ausencias_180 (
        empleado_id,
        empresa_id,
        tipo,
        fecha_inicio,
        fecha_fin,
        comentario_admin,
        estado
      ) VALUES (
        ${empleado_id},
        ${empresaId},
        ${tipo},
        ${fecha_inicio},
        ${fecha_fin},
        ${comentarioAdminSafe},
        'aprobado'
      )
      RETURNING *
    `;

    // Push a Google Calendar (asíncrono)
    autoPushToGoogle(empresaId, 'ausencias', rows[0].id);

    return res.json({
      success: true,
      ausencia: rows[0],
      warning_festivos: !!festivos,
    });
  } catch (err) {
    console.error("Error crearAusenciaAdmin:", err);
    return res.status(500).json({ error: "Error creando ausencia" });
  }
};
export const listarEventosCalendarioAdmin = async (req, res) => {
  try {
    const { desde, hasta, empleado_id, estado } = req.query;

    const desdeSafe = desde ?? null;
    const hastaSafe = hasta ?? null;
    const empleadoIdSafe = empleado_id ?? null;
    const estadoSafe = estado ?? null;

    const empresaId = await resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada" });

    const rows = await sql`
      SELECT
        a.id,
        a.empleado_id,
        e.nombre AS empleado_nombre,
        a.tipo,
        a.estado,
        a.fecha_inicio AS start,
        a.fecha_fin AS end
      FROM ausencias_180 a
      JOIN employees_180 e ON e.id = a.empleado_id
      WHERE a.empresa_id = ${empresaId}
        AND (${desdeSafe}::date IS NULL OR a.fecha_fin >= ${desdeSafe})
        AND (${hastaSafe}::date IS NULL OR a.fecha_inicio <= ${hastaSafe})
        AND (${empleadoIdSafe}::uuid IS NULL OR a.empleado_id = ${empleadoIdSafe})
        AND (${estadoSafe}::text IS NULL OR a.estado = ${estadoSafe})
      ORDER BY a.fecha_inicio ASC
    `;

    res.set("Cache-Control", "no-store");
    res.json(rows);
  } catch (err) {
    console.error("Error listarEventosCalendarioAdmin:", err);
    res.status(500).json({ error: "Error cargando calendario" });
  }
};
