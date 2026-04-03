/**
 * Controller: Titulares/Socios de una empresa
 * CRUD para gestionar los titulares vinculados a cada empresa.
 * Soporta múltiples titulares por empresa con distintos regímenes SS.
 */

import { sql } from "../db.js";
import { ensureSelfEmployee } from "../services/ensureSelfEmployee.js";

// ============================================================
// GET - Listar titulares de una empresa
// ============================================================
export async function getTitulares(req, res) {
  try {
    const empresaId = req.params.empresa_id || req.user.empresa_id;
    if (!empresaId) {
      return res.status(400).json({ error: "empresa_id requerido" });
    }

    const titulares = await sql`
      SELECT t.*, e.nombre as employee_nombre
      FROM titulares_empresa_180 t
      LEFT JOIN employees_180 e ON e.id = t.employee_id
      WHERE t.empresa_id = ${empresaId}
      ORDER BY t.es_administrador DESC, t.created_at ASC
    `;

    res.json({ titulares });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ============================================================
// POST - Crear titular
// ============================================================
export async function createTitular(req, res) {
  try {
    const empresaId = req.params.empresa_id || req.user.empresa_id;
    if (!empresaId) {
      return res.status(400).json({ error: "empresa_id requerido" });
    }

    const {
      nombre,
      nif,
      porcentaje_participacion,
      es_administrador,
      regimen_ss,
      fecha_alta_ss,
      fecha_baja_ss,
      notas,
    } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: "nombre es obligatorio" });
    }

    const regimen = regimen_ss || "autonomo";
    if (!["autonomo", "general", "sin_regimen"].includes(regimen)) {
      return res.status(400).json({ error: "regimen_ss debe ser 'autonomo', 'general' o 'sin_regimen'" });
    }

    // Si es autónomo, asegurar que tiene un registro de empleado (patrón ensureSelfEmployee)
    let employeeId = null;
    if (regimen === "autonomo") {
      employeeId = await ensureSelfEmployee({
        userId: req.user.id,
        empresaId,
        nombre: nombre,
      });
    }

    const [titular] = await sql`
      INSERT INTO titulares_empresa_180 (
        empresa_id, employee_id, nombre, nif,
        porcentaje_participacion, es_administrador,
        regimen_ss, fecha_alta_ss, fecha_baja_ss, notas
      ) VALUES (
        ${empresaId}, ${employeeId}, ${nombre}, ${nif || null},
        ${porcentaje_participacion ?? 100}, ${es_administrador ?? false},
        ${regimen}, ${fecha_alta_ss || null}, ${fecha_baja_ss || null},
        ${notas || null}
      )
      RETURNING *
    `;

    res.json({ titular });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ============================================================
// PUT - Actualizar titular
// ============================================================
export async function updateTitular(req, res) {
  try {
    const { id } = req.params;
    const empresaId = req.params.empresa_id || req.user.empresa_id;

    const {
      nombre,
      nif,
      porcentaje_participacion,
      es_administrador,
      regimen_ss,
      fecha_alta_ss,
      fecha_baja_ss,
      notas,
    } = req.body;

    if (regimen_ss && !["autonomo", "general", "sin_regimen"].includes(regimen_ss)) {
      return res.status(400).json({ error: "regimen_ss debe ser 'autonomo', 'general' o 'sin_regimen'" });
    }

    // Si se cambia a autónomo y no tenía employee_id, crearlo
    let employeeUpdate = sql`employee_id`;
    if (regimen_ss === "autonomo") {
      const [existing] = await sql`
        SELECT employee_id FROM titulares_empresa_180 WHERE id = ${id} AND empresa_id = ${empresaId}
      `;
      if (existing && !existing.employee_id) {
        const empId = await ensureSelfEmployee({
          userId: req.user.id,
          empresaId,
          nombre: nombre || "Autónomo",
        });
        employeeUpdate = sql`${empId}`;
      }
    }

    const [updated] = await sql`
      UPDATE titulares_empresa_180 SET
        nombre = COALESCE(${nombre || null}, nombre),
        nif = COALESCE(${nif ?? null}, nif),
        porcentaje_participacion = COALESCE(${porcentaje_participacion ?? null}, porcentaje_participacion),
        es_administrador = COALESCE(${es_administrador ?? null}, es_administrador),
        regimen_ss = COALESCE(${regimen_ss || null}, regimen_ss),
        fecha_alta_ss = COALESCE(${fecha_alta_ss || null}, fecha_alta_ss),
        fecha_baja_ss = COALESCE(${fecha_baja_ss || null}, fecha_baja_ss),
        notas = COALESCE(${notas ?? null}, notas),
        updated_at = NOW()
      WHERE id = ${id} AND empresa_id = ${empresaId}
      RETURNING *
    `;

    if (!updated) {
      return res.status(404).json({ error: "Titular no encontrado" });
    }

    res.json({ titular: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ============================================================
// DELETE - Soft delete (activo = false)
// ============================================================
export async function deleteTitular(req, res) {
  try {
    const { id } = req.params;
    const empresaId = req.params.empresa_id || req.user.empresa_id;

    const [deleted] = await sql`
      UPDATE titulares_empresa_180
      SET activo = false, updated_at = NOW()
      WHERE id = ${id} AND empresa_id = ${empresaId}
      RETURNING id
    `;

    if (!deleted) {
      return res.status(404).json({ error: "Titular no encontrado" });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
