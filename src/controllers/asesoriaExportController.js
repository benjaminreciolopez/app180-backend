// backend/src/controllers/asesoriaExportController.js
import { generateExcelTrimestral, generateCsvPack, generateZipPack } from "../services/asesoriaExportService.js";

/**
 * GET /admin/asesoria/export/trimestral?anio=2026&trimestre=1&formato=excel|csv|zip
 * Also available from asesor: GET /asesor/clientes/:empresa_id/export/trimestral
 */
export async function exportTrimestral(req, res) {
  try {
    const empresaId = req.user.empresa_id || req.params.empresa_id;
    if (!empresaId) return res.status(400).json({ error: "empresa_id requerido" });

    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const trimestre = parseInt(req.query.trimestre) || Math.ceil((new Date().getMonth() + 1) / 3);
    const formato = req.query.formato || "excel";

    if (trimestre < 1 || trimestre > 4) {
      return res.status(400).json({ error: "Trimestre debe ser 1-4" });
    }

    if (formato === "excel") {
      const buffer = await generateExcelTrimestral(empresaId, anio, trimestre);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=contabilidad_${anio}_T${trimestre}.xlsx`);
      return res.send(buffer);
    }

    if (formato === "csv") {
      // CSV pack contains multiple files, so we zip them
      const buffer = await generateZipPack(empresaId, anio, trimestre, "csv");
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename=csv_asesoria_${anio}_T${trimestre}.zip`);
      return res.send(buffer);
    }

    if (formato === "zip") {
      const buffer = await generateZipPack(empresaId, anio, trimestre);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename=paquete_asesoria_${anio}_T${trimestre}.zip`);
      return res.send(buffer);
    }

    return res.status(400).json({ error: "Formato no válido. Usar: excel, csv, zip" });
  } catch (err) {
    console.error("Error exportTrimestral:", err);
    res.status(500).json({ error: "Error generando exportación" });
  }
}
