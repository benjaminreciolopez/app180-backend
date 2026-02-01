import {
  obtenerTurno,
  obtenerTurnosEmpresa,
} from "../services/turnosService.js";

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
// backend/src/controllers/turnosController.js
