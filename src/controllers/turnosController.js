import {
  obtenerTurno,
  insertarTurno,
  editarTurno,
  borrarTurno,
  obtenerTurnosEmpresa,
} from "../services/turnosService.js";

import { obtenerEmpresaUsuario } from "../helpers/empresaHelper.js";

export async function getTurnos(req, res) {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) {
      return res.status(401).json({ error: "Usuario no autenticado" });
    }

    const turnos = await obtenerTurnosEmpresa(empresaId);
    res.json(turnos);
  } catch (e) {
    console.error("❌ Error GET turnos:", e);
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
// backend/src/controllers/turnosController.js
