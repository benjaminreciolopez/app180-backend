// backend/src/controllers/asesoriaExportController.js
import {
  generateExcelTrimestral,
  generateCsvPack,
  generateZipPack,
  generateExcelMensual,
  generateExcelMultiCliente,
  generateResumenFiscal,
} from "../services/asesoriaExportService.js";
import { sql } from "../db.js";

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

    return res.status(400).json({ error: "Formato no valido. Usar: excel, csv, zip" });
  } catch (err) {
    console.error("Error exportTrimestral:", err);
    res.status(500).json({ error: "Error generando exportacion" });
  }
}

/**
 * GET /asesor/clientes/:empresa_id/export/mensual?anio=YYYY&mes=1-12&formato=excel
 */
export async function exportMensual(req, res) {
  try {
    const empresaId = req.params.empresa_id;
    if (!empresaId) return res.status(400).json({ error: "empresa_id requerido" });

    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const mes = parseInt(req.query.mes) || new Date().getMonth() + 1;
    const formato = req.query.formato || "excel";

    if (mes < 1 || mes > 12) {
      return res.status(400).json({ error: "Mes debe ser 1-12" });
    }

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    if (formato === "excel") {
      const buffer = await generateExcelMensual(empresaId, anio, mes);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=contabilidad_${anio}_${monthNames[mes - 1]}.xlsx`);
      return res.send(buffer);
    }

    return res.status(400).json({ error: "Formato no valido para export mensual. Usar: excel" });
  } catch (err) {
    console.error("Error exportMensual:", err);
    res.status(500).json({ error: "Error generando exportacion mensual" });
  }
}

/**
 * GET /asesor/export/multi-cliente?anio=YYYY&trimestre=1-4&formato=excel|zip
 * Exporta datos de TODOS los clientes del asesor
 */
export async function exportMultiCliente(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    if (!asesoriaId) return res.status(400).json({ error: "No es un usuario asesor" });

    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const trimestre = parseInt(req.query.trimestre) || Math.ceil((new Date().getMonth() + 1) / 3);
    const formato = req.query.formato || "excel";

    if (trimestre < 1 || trimestre > 4) {
      return res.status(400).json({ error: "Trimestre debe ser 1-4" });
    }

    if (formato === "excel") {
      const buffer = await generateExcelMultiCliente(asesoriaId, anio, trimestre);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=multi_cliente_${anio}_T${trimestre}.xlsx`);
      return res.send(buffer);
    }

    if (formato === "zip") {
      // ZIP con un Excel por cliente
      const { PassThrough } = await import("stream");
      const archiver = (await import("archiver")).default;

      const clientes = await sql`
        SELECT ac.empresa_id, e.nombre
        FROM asesoria_clientes_180 ac
        JOIN empresa_180 e ON e.id = ac.empresa_id
        WHERE ac.asesoria_id = ${asesoriaId} AND ac.estado = 'activo'
        ORDER BY e.nombre
      `;

      const passThrough = new PassThrough();
      const chunks = [];
      passThrough.on("data", (chunk) => chunks.push(chunk));

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(passThrough);

      for (const cliente of clientes) {
        const buffer = await generateExcelTrimestral(cliente.empresa_id, anio, trimestre);
        const safeName = cliente.nombre.replace(/[^a-zA-Z0-9_\-. ]/g, "").trim();
        archive.append(buffer, { name: `${safeName}/contabilidad_${anio}_T${trimestre}.xlsx` });
      }

      await archive.finalize();
      const zipBuffer = Buffer.concat(chunks);

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename=todos_clientes_${anio}_T${trimestre}.zip`);
      return res.send(zipBuffer);
    }

    return res.status(400).json({ error: "Formato no valido. Usar: excel, zip" });
  } catch (err) {
    console.error("Error exportMultiCliente:", err);
    res.status(500).json({ error: "Error generando exportacion multi-cliente" });
  }
}

/**
 * GET /asesor/clientes/:empresa_id/export/resumen-fiscal?anio=YYYY
 */
export async function exportResumenFiscal(req, res) {
  try {
    const empresaId = req.params.empresa_id;
    if (!empresaId) return res.status(400).json({ error: "empresa_id requerido" });

    const anio = parseInt(req.query.anio) || new Date().getFullYear();

    const buffer = await generateResumenFiscal(empresaId, anio);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=resumen_fiscal_${anio}.xlsx`);
    return res.send(buffer);
  } catch (err) {
    console.error("Error exportResumenFiscal:", err);
    res.status(500).json({ error: "Error generando resumen fiscal" });
  }
}
