/**
 * Controlador de Integridad de Fichajes - RD 8/2019
 *
 * Permite al admin verificar la cadena de hashes,
 * ver estadísticas y regenerar hashes legacy.
 */

import { sql } from "../db.js";
import {
  verificarIntegridadFichajes,
  obtenerEstadisticasCadena,
  regenerarHashesLegacy,
} from "../services/fichajeIntegridadService.js";

/**
 * Verifica la integridad de la cadena de hashes
 * GET /api/admin/fichajes/integridad/verificar?empleado_id=
 */
export const verificarIntegridad = async (req, res) => {
  try {
    const [empresa] = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;
    if (!empresa) return res.status(403).json({ error: "No autorizado" });

    const { empleado_id } = req.query;
    const resultado = await verificarIntegridadFichajes(empresa.id, empleado_id || null);

    res.json({
      verificacion: resultado,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Error verificando integridad:", err);
    res.status(500).json({ error: "Error al verificar integridad" });
  }
};

/**
 * Estadísticas de la cadena de hashes
 * GET /api/admin/fichajes/integridad/estadisticas
 */
export const estadisticasIntegridad = async (req, res) => {
  try {
    const [empresa] = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;
    if (!empresa) return res.status(403).json({ error: "No autorizado" });

    const stats = await obtenerEstadisticasCadena(empresa.id);
    res.json(stats);
  } catch (err) {
    console.error("❌ Error estadísticas integridad:", err);
    res.status(500).json({ error: "Error al obtener estadísticas" });
  }
};

/**
 * Regenera hashes para fichajes legacy (sin hash)
 * POST /api/admin/fichajes/integridad/regenerar
 */
export const regenerarHashes = async (req, res) => {
  try {
    const [empresa] = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;
    if (!empresa) return res.status(403).json({ error: "No autorizado" });

    const resultado = await regenerarHashesLegacy(empresa.id);

    if (resultado.procesados === 0) {
      return res.json({ mensaje: "No hay fichajes sin hash para regenerar", procesados: 0 });
    }

    res.json({
      mensaje: `Hashes regenerados correctamente`,
      procesados: resultado.procesados,
      empleados: resultado.empleados,
    });
  } catch (err) {
    console.error("❌ Error regenerando hashes:", err);
    res.status(500).json({ error: "Error al regenerar hashes" });
  }
};
