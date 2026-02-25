/**
 * Controlador de verificación pública - RD 8/2019
 *
 * Endpoint público (sin autenticación) que permite verificar
 * la autenticidad de un documento exportado mediante su Código
 * Seguro de Verificación (CSV).
 */

import { verificarCodigoCSV } from "../services/csvVerificacionService.js";

/**
 * GET /api/verificar/:csv_code
 * Público, sin auth, rate limited.
 */
export const verificarCSV = async (req, res) => {
  try {
    const { csv_code } = req.params;

    if (!csv_code || csv_code.length < 20) {
      return res.status(400).json({
        error: "Código CSV inválido",
        formato_esperado: "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX",
      });
    }

    const resultado = await verificarCodigoCSV(csv_code);

    if (!resultado) {
      return res.status(404).json({
        error: "Código CSV no encontrado",
        ayuda: "Verifique que el código sea correcto y que el documento no haya sido eliminado",
      });
    }

    if (!resultado.valido) {
      return res.status(410).json({
        error: "Código CSV expirado",
        motivo: resultado.motivo,
        expiro_el: resultado.expiro_el,
      });
    }

    res.json({
      verificado: true,
      ...resultado,
    });
  } catch (err) {
    console.error("❌ Error en verificarCSV:", err);
    res.status(500).json({ error: "Error al verificar código CSV" });
  }
};
