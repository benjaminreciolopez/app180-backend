// backend/src/controllers/aiAsesorController.js
// Controlador del endpoint POST /asesor/ai/chat
// Restringido por roleRequired("asesor") en la ruta. Aquí solo orquesta.

import { chatConAgenteAsesor } from "../services/aiAsesorAgentService.js";

/**
 * POST /asesor/ai/chat
 * Body: { mensaje: string, historial?: Array<{role, content}> }
 * El asesor_id se obtiene de req.user.asesoria_id (autenticación previa).
 */
export async function chatAsesor(req, res) {
  try {
    const userId = req.user.id;
    const asesoriaId = req.user.asesoria_id;
    const { mensaje, historial } = req.body;

    if (!mensaje || typeof mensaje !== "string") {
      return res.status(400).json({ error: "El mensaje es requerido" });
    }
    if (!asesoriaId) {
      return res.status(403).json({ error: "Asesor sin asesoría asignada" });
    }

    const respuesta = await chatConAgenteAsesor({
      asesoriaId,
      userId,
      mensaje,
      historial: historial || []
    });

    if (respuesta.limite_alcanzado) {
      return res.status(429).json({
        error: respuesta.mensaje,
        limite_alcanzado: true,
        tipo_limite: respuesta.tipo_limite
      });
    }

    return res.json({
      mensaje: respuesta.mensaje,
      timestamp: new Date().toISOString(),
      accion_realizada: respuesta.accion_realizada || false,
      clarificacion: respuesta.clarificacion || null
    });
  } catch (err) {
    console.error("[AI Asesor Controller] Error:", err);
    return res.status(500).json({ error: err.message || "Error al procesar tu mensaje" });
  }
}
