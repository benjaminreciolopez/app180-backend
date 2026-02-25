import { sql } from "../db.js";
import { crearNotificacionSistema } from "./notificacionesController.js";

const FABRICANTE_EMAIL = process.env.FABRICANTE_EMAIL || "susanaybenjamin@gmail.com";

/**
 * POST /system/test-report
 * Receives XML test report from hacker ético agent and creates notification
 * Protected by X-Test-Api-Key header (no JWT needed)
 */
export async function receiveTestReport(req, res) {
  try {
    const apiKey = req.headers["x-test-api-key"];
    if (!process.env.TEST_REPORT_API_KEY || apiKey !== process.env.TEST_REPORT_API_KEY) {
      return res.status(401).json({ error: "API key inválida" });
    }

    const { xml, summary } = req.body;
    if (!xml || !summary) {
      return res.status(400).json({ error: "Faltan campos: xml, summary" });
    }

    // Find fabricante user → empresa_id
    const [fabricante] = await sql`
      SELECT u.id as user_id, e.id as empresa_id
      FROM users_180 u
      JOIN empresa_180 e ON e.user_id = u.id
      WHERE u.email = ${FABRICANTE_EMAIL}
      LIMIT 1
    `;

    if (!fabricante) {
      return res.status(404).json({ error: "Fabricante no encontrado" });
    }

    const hasCritical = (summary.critical_count || 0) > 0;
    const tipo = hasCritical ? "error" : (summary.failed > 0 ? "warning" : "success");
    const titulo = summary.failed > 0
      ? `Hacker Etico: ${summary.failed} fallos (${summary.critical_count || 0} CRITICAL)`
      : `Hacker Etico: ${summary.total} tests OK`;

    await crearNotificacionSistema({
      empresaId: fabricante.empresa_id,
      userId: fabricante.user_id,
      tipo,
      titulo,
      mensaje: `Tests: ${summary.total} total, ${summary.passed} passed, ${summary.failed} failed. XML en metadata.`,
      accionUrl: "/admin/notificaciones",
      accionLabel: "Ver reporte",
      metadata: { xml_report: xml, summary },
    });

    res.json({ success: true, message: "Reporte enviado como notificacion" });
  } catch (err) {
    console.error("Error receiveTestReport:", err);
    res.status(500).json({ error: "Error procesando reporte" });
  }
}

export async function getSystemStatus(req, res) {
  try {
    const rows = await sql`
      SELECT COUNT(*)::int AS total
      FROM empresa_180
    `;

    const total = rows[0].total;

    const initialized = total > 0;

    res.json({
      initialized, // true si ya hay empresa
      hasCompany: initialized, // alias
      bootstrap: !initialized, // 👈 CLAVE: invertido
    });
  } catch (err) {
    console.error("Error en getSystemStatus:", err);
    res.status(500).json({ error: "Error al consultar estado del sistema" });
  }
}
