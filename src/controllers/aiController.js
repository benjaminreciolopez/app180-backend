import { chatConAgente } from "../services/aiAgentService.js";
import { sql } from "../db.js";

/**
 * Obtiene el ID de la empresa del usuario autenticado
 */
async function getEmpresaId(userId) {
  const r = await sql`select id from empresa_180 where user_id=${userId} limit 1`;
  if (!r[0]) {
    const e = new Error("Empresa no asociada");
    e.status = 403;
    throw e;
  }
  return r[0].id;
}

/**
 * POST /admin/ai/chat
 * Endpoint para chatear con el agente IA
 */
export async function chat(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { mensaje, historial } = req.body;

    if (!mensaje || typeof mensaje !== 'string') {
      return res.status(400).json({ error: "El mensaje es requerido" });
    }

    const empresaId = await getEmpresaId(userId);

    // Llamar al servicio de IA
    const respuesta = await chatConAgente({
      empresaId,
      userId,
      userRole,
      mensaje,
      historial: historial || []
    });

    res.json({
      mensaje: respuesta.mensaje,
      timestamp: new Date().toISOString(),
      accion_realizada: respuesta.accion_realizada || false
    });

  } catch (error) {
    console.error("[AI Controller] Error:", error);

    if (error.message?.includes("API key")) {
      return res.status(500).json({
        error: "Servicio de IA no configurado. Contacta al administrador."
      });
    }

    res.status(500).json({
      error: error.message || "Error al procesar tu mensaje"
    });
  }
}

/**
 * GET /admin/ai/status
 * Verifica si el servicio de IA está disponible
 */
export async function status(req, res) {
  try {
    const apiKey = process.env.GROQ_API_KEY;

    res.json({
      disponible: !!apiKey && apiKey.length > 10,
      modelo: "llama-3.3-70b-versatile",
      proveedor: "Groq"
    });
  } catch (error) {
    console.error("[AI Controller] Error en status:", error);
    res.status(500).json({ error: error.message });
  }
}
