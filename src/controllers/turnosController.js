import {
  obtenerTurno,
  insertarTurno,
  editarTurno,
  borrarTurno,
} from "../services/turnosService.js";
import { sql } from "../db.js";

import { obtenerEmpresaUsuario } from "../helpers/empresaHelper.js";
import { obtenerTurnosEmpresa } from "../services/turnosService.js";

export async function getTurnos(req, res) {
  try {
    const userId = req.user?.id || req.user_id || req.user;
    // adapta según cómo guardes el usuario en auth middleware

    if (!userId)
      return res.status(401).json({ error: "Usuario no autenticado" });

    const empresaId = await obtenerEmpresaUsuario(userId);

    const turnos = await obtenerTurnosEmpresa(empresaId);

    res.json(turnos);
  } catch (e) {
    console.error("Error GET turnos:", e);
    res.status(500).json({ error: "Error al obtener turnos" });
  }
}

export async function getTurno(req, res) {
  try {
    const turno = await obtenerTurno(req.params.id);
    res.json(turno);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al obtener turno" });
  }
}

export async function createTurno(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ error: "Usuario no autenticado" });

    const empresaId = await obtenerEmpresaUsuario(userId);

    const nuevo = await insertarTurno({
      ...req.body,
      empresa_id: empresaId,
    });

    res.json(nuevo);
  } catch (e) {
    console.error("❌ Error creando turno:", e);
    res.status(500).json({ error: "Error al crear turno" });
  }
}

export async function updateTurno(req, res) {
  try {
    const actualizado = await editarTurno(req.params.id, req.body);
    res.json(actualizado);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al actualizar turno" });
  }
}

export async function deleteTurno(req, res) {
  try {
    await borrarTurno(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al eliminar turno" });
  }
}

export async function asignarTurnoEmpleado(req, res) {
  try {
    const empleado_id = req.params.id;
    const { turno_id } = req.body;

    if (!turno_id) {
      return res.status(400).json({ error: "turno_id es obligatorio" });
    }

    const result = await sql`
      UPDATE employees_180
      SET turno_id = ${turno_id}
      WHERE id = ${empleado_id}
      RETURNING *
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado" });
    }

    res.json(result[0]);
  } catch (e) {
    console.error("Error asignando turno:", e);
    res.status(500).json({ error: "Error asignando turno" });
  }
}
