/**
 * Controlador de Correcciones de Fichajes - RD 8/2019
 *
 * El empleado puede solicitar correcciones (adición, modificación, eliminación).
 * El admin aprueba o rechaza. Al aprobar se crea un NUEVO fichaje vinculado
 * (nunca se modifica el original).
 */

import { sql } from "../db.js";
import { resolveEmpresaId } from "../services/resolveEmpresaId.js";
import { generarHashFichajeNuevo } from "../services/fichajeIntegridadService.js";
import { registrarAuditoria } from "../middlewares/auditMiddleware.js";
import { recalcularJornada } from "../services/jornadaEngine.js";

/**
 * Empleado solicita corrección de fichaje
 * POST /api/fichajes/correcciones
 */
export const solicitarCorreccion = async (req, res) => {
  try {
    const { fichaje_id, tipo_correccion, datos_propuestos, motivo } = req.body;

    if (!["adicion", "modificacion", "eliminacion"].includes(tipo_correccion)) {
      return res.status(400).json({ error: "Tipo de corrección inválido" });
    }
    if (!motivo || motivo.trim().length < 10) {
      return res.status(400).json({ error: "Motivo requerido (mínimo 10 caracteres)" });
    }

    // Verificar empleado activo
    const [empleado] = await sql`
      SELECT id, empresa_id FROM employees_180
      WHERE user_id = ${req.user.id} AND activo = true
    `;
    if (!empleado) {
      return res.status(403).json({ error: "Usuario no es empleado activo" });
    }

    // Verificar fichaje original (si aplica)
    let fichajeOriginal = null;
    if (fichaje_id) {
      [fichajeOriginal] = await sql`
        SELECT * FROM fichajes_180
        WHERE id = ${fichaje_id}
          AND empleado_id = ${empleado.id}
          AND empresa_id = ${empleado.empresa_id}
      `;
      if (!fichajeOriginal) {
        return res.status(404).json({ error: "Fichaje no encontrado o no pertenece al empleado" });
      }
    }

    const [correccion] = await sql`
      INSERT INTO fichaje_correcciones_180 (
        fichaje_id, empresa_id, empleado_id,
        solicitado_por, tipo_correccion,
        datos_originales, datos_propuestos, motivo
      ) VALUES (
        ${fichaje_id || null},
        ${empleado.empresa_id},
        ${empleado.id},
        'empleado',
        ${tipo_correccion},
        ${fichajeOriginal ? JSON.stringify(fichajeOriginal) : null},
        ${JSON.stringify(datos_propuestos || {})},
        ${motivo}
      )
      RETURNING *
    `;

    try {
      await registrarAuditoria({
        empresaId: empleado.empresa_id,
        userId: req.user.id,
        empleadoId: empleado.id,
        accion: "correccion_solicitada",
        entidadTipo: "fichaje_correccion",
        entidadId: correccion.id,
        datosNuevos: correccion,
        motivo: `Empleado solicita corrección: ${tipo_correccion}`,
        req,
      });
    } catch (_) {}

    res.json({ success: true, correccion });
  } catch (err) {
    console.error("Error solicitarCorreccion:", err);
    res.status(500).json({ error: "Error al solicitar corrección" });
  }
};

/**
 * Empleado consulta sus correcciones
 * GET /api/fichajes/correcciones
 */
export const misCorrecciones = async (req, res) => {
  try {
    const [empleado] = await sql`
      SELECT id, empresa_id FROM employees_180
      WHERE user_id = ${req.user.id}
    `;
    if (!empleado) {
      return res.status(403).json({ error: "Usuario no es empleado" });
    }

    const correcciones = await sql`
      SELECT c.*,
        f.fecha as fichaje_fecha,
        f.tipo as fichaje_tipo,
        u.nombre as resuelto_por_nombre
      FROM fichaje_correcciones_180 c
      LEFT JOIN fichajes_180 f ON c.fichaje_id = f.id
      LEFT JOIN users_180 u ON c.resuelto_por = u.id
      WHERE c.empleado_id = ${empleado.id}
      ORDER BY c.created_at DESC
      LIMIT 50
    `;

    res.json(correcciones);
  } catch (err) {
    console.error("Error misCorrecciones:", err);
    res.status(500).json({ error: "Error al obtener correcciones" });
  }
};

/**
 * Admin lista correcciones pendientes
 * GET /api/admin/fichajes/correcciones
 */
export const listarCorrecciones = async (req, res) => {
  try {
    const { estado = "pendiente" } = req.query;

    const empresaId = await resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada" });

    const correcciones = await sql`
      SELECT c.*,
        e.nombre as empleado_nombre,
        f.fecha as fichaje_fecha,
        f.tipo as fichaje_tipo
      FROM fichaje_correcciones_180 c
      JOIN employees_180 e ON c.empleado_id = e.id
      LEFT JOIN fichajes_180 f ON c.fichaje_id = f.id
      WHERE c.empresa_id = ${empresaId}
        ${estado && estado !== "todas" ? sql`AND c.estado = ${estado}` : sql``}
      ORDER BY c.created_at DESC
      LIMIT 100
    `;

    res.json(correcciones);
  } catch (err) {
    console.error("Error listarCorrecciones:", err);
    res.status(500).json({ error: "Error al listar correcciones" });
  }
};

/**
 * Admin resuelve corrección (aprobar/rechazar)
 * PUT /api/admin/fichajes/correcciones/:id
 */
export const resolverCorreccion = async (req, res) => {
  try {
    const { id } = req.params;
    const { accion, notas_resolucion } = req.body;

    if (!["aprobar", "rechazar"].includes(accion)) {
      return res.status(400).json({ error: "Acción inválida (aprobar/rechazar)" });
    }

    const empresaId = await resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada" });

    const [correccion] = await sql`
      SELECT c.*, emp.user_id as empleado_user_id
      FROM fichaje_correcciones_180 c
      JOIN employees_180 emp ON c.empleado_id = emp.id
      WHERE c.id = ${id} AND c.empresa_id = ${empresaId}
    `;
    if (!correccion) {
      return res.status(404).json({ error: "Corrección no encontrada" });
    }
    if (correccion.estado !== "pendiente") {
      return res.status(400).json({ error: "La corrección ya fue resuelta" });
    }

    if (accion === "rechazar") {
      const [actualizada] = await sql`
        UPDATE fichaje_correcciones_180
        SET estado = 'rechazada',
            resuelto_por = ${req.user.id},
            resuelto_at = NOW(),
            notas_resolucion = ${notas_resolucion || null},
            updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      try {
        await registrarAuditoria({
          empresaId: empresaId,
          userId: req.user.id,
          empleadoId: correccion.empleado_id,
          accion: "correccion_rechazada",
          entidadTipo: "fichaje_correccion",
          entidadId: id,
          datosAnteriores: correccion,
          datosNuevos: actualizada,
          motivo: notas_resolucion || "Corrección rechazada",
          req,
        });
      } catch (_) {}

      return res.json({ success: true, correccion: actualizada });
    }

    // APROBAR: crear nuevo fichaje vinculado
    const dp = correccion.datos_propuestos || {};
    if (!dp.tipo || !dp.fecha) {
      return res.status(400).json({ error: "Datos propuestos incompletos (tipo y fecha requeridos)" });
    }

    // Buscar o crear jornada para el nuevo fichaje
    const jornadaId = dp.jornada_id || correccion.datos_originales?.jornada_id || null;

    // Hash chain
    const hashData = await generarHashFichajeNuevo({
      empleado_id: correccion.empleado_id,
      empresa_id: empresaId,
      fecha: new Date(dp.fecha),
      tipo: dp.tipo,
      jornada_id: jornadaId,
    });

    const [nuevoFichaje] = await sql`
      INSERT INTO fichajes_180 (
        empleado_id, empresa_id, user_id, jornada_id,
        tipo, fecha, estado, origen, nota,
        sospechoso, creado_manual,
        hash_actual, hash_anterior, fecha_hash
      ) VALUES (
        ${correccion.empleado_id}, ${empresaId}, ${correccion.empleado_user_id},
        ${jornadaId}, ${dp.tipo}, ${dp.fecha},
        'confirmado', 'correccion',
        ${"Corrección aprobada: " + (notas_resolucion || correccion.motivo)},
        false, true,
        ${hashData.hash_actual}, ${hashData.hash_anterior}, ${hashData.fecha_hash}
      )
      RETURNING *
    `;

    // Actualizar corrección
    const [actualizada] = await sql`
      UPDATE fichaje_correcciones_180
      SET estado = 'aprobada',
          resuelto_por = ${req.user.id},
          resuelto_at = NOW(),
          notas_resolucion = ${notas_resolucion || null},
          fichaje_nuevo_id = ${nuevoFichaje.id},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    // Recalcular jornada
    if (jornadaId) {
      try { await recalcularJornada(jornadaId); } catch (_) {}
    }

    try {
      await registrarAuditoria({
        empresaId: empresaId,
        userId: req.user.id,
        empleadoId: correccion.empleado_id,
        accion: "correccion_aprobada",
        entidadTipo: "fichaje_correccion",
        entidadId: id,
        datosAnteriores: correccion,
        datosNuevos: { correccion: actualizada, nuevoFichaje },
        motivo: "Corrección aprobada, nuevo fichaje creado",
        req,
      });
    } catch (_) {}

    res.json({ success: true, correccion: actualizada, nuevoFichaje });
  } catch (err) {
    console.error("Error resolverCorreccion:", err);
    res.status(500).json({ error: "Error al resolver corrección" });
  }
};
