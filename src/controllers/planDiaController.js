// backend/src/controllers/planDiaController.js
import { getPlanDiaEstado } from "../services/planDiaEstadoService.js";

export const getPlanDiaEmpleado = async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const empleadoId = req.user.empleado_id;

    if (!empresaId || !empleadoId) {
      return res
        .status(403)
        .json({ error: "Empleado sin empresa o empleado_id" });
    }

    const fecha = (req.query.fecha || "").toString();
    const ymd = fecha ? fecha.slice(0, 10) : null;

    if (!ymd) {
      return res
        .status(400)
        .json({ error: "fecha es obligatoria (YYYY-MM-DD)" });
    }

    const data = await getPlanDiaEstado({ empresaId, empleadoId, fecha: ymd });

    return res.json(data);
  } catch (err) {
    console.error("❌ getPlanDiaEmpleado:", err);
    return res.status(500).json({ error: "Error obteniendo plan del día" });
  }
};
// backend/src/controllers/planDiaController.js
