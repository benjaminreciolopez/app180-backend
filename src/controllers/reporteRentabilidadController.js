import { calcularReporteRentabilidad } from "../services/reportesService.js";
import { handleErr } from "../utils/errorHandler.js";
import { getEmpresaIdAdminOrThrow } from "../services/authService.js";

/**
 * Reporte de Rentabilidad (Horas Planificadas vs Horas Reales)
 *
 * GET /admin/reportes/rentabilidad
 */
export const getReporteRentabilidad = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { desde, hasta, empleado_id = null } = req.query;

    if (!desde || !hasta) {
      return res.status(400).json({ error: "Se requieren parámetros desde y hasta" });
    }

    const reporte = await calcularReporteRentabilidad(empresaId, desde, hasta, empleado_id);

    // Mapeo final para agregar color UI si es necesario, aunque el front deberia manejarlo
    const reporteConColores = reporte.map(r => ({
        ...r,
        color: r.estado === 'ahorro' ? 'green' : (r.estado === 'exceso' ? 'red' : 'blue')
    }));

    res.json(reporteConColores);

  } catch (err) {
    console.error("❌ ERROR EN REPORTE RENTABILIDAD:", err);
    handleErr(res, err, "getReporteRentabilidad");
  }
};
