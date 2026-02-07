import { chatConAgente } from "../services/aiAgentService.js";
import { sql } from "../db.js";

// ============================
// SEGURIDAD
// ============================

function validateApiKey(req) {
  const apiKey = req.headers["x-api-key"];
  const expectedKey = process.env.WHATSAPP_WEBHOOK_API_KEY;
  return !!(apiKey && expectedKey && apiKey === expectedKey);
}

// Rate limiting simple en memoria
const rateLimiter = new Map();
const RATE_LIMIT = 30;
const RATE_WINDOW = 60000;

function checkRateLimit(phone) {
  const now = Date.now();
  const entry = rateLimiter.get(phone) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_WINDOW;
  }
  entry.count++;
  rateLimiter.set(phone, entry);
  return entry.count <= RATE_LIMIT;
}

// ============================
// CONTEXTO ADMIN
// ============================

/**
 * Obtiene el contexto del admin basado en el telefono del perfil
 * @param {string} phoneNumber - Numero de telefono desde WhatsApp
 * @returns {Object|null} - { empresaId, userId, userRole } o null si no se encuentra
 */
async function getAdminContextByPhone(phoneNumber) {
  try {
    // Normalizar telefono: quitar + y espacios
    const normalized = phoneNumber.replace(/^\+/, "").replace(/\s/g, "");

    // Buscar empresa por telefono en perfil_180
    const [perfil] = await sql`
      SELECT p.empresa_id, p.telefono, e.user_id
      FROM perfil_180 p
      LEFT JOIN empresa_180 e ON p.empresa_id = e.id
      WHERE p.telefono IS NOT NULL
        AND REPLACE(REPLACE(p.telefono, '+', ''), ' ', '') = ${normalized}
      LIMIT 1
    `;

    if (!perfil) {
      console.log(`[WhatsApp] No se encontro perfil con telefono: ${normalized}`);
      return null;
    }

    return {
      empresaId: perfil.empresa_id,
      userId: perfil.user_id,
      userRole: "admin"
    };
  } catch (err) {
    console.error("[WhatsApp] Error obteniendo contexto:", err);
    return null;
  }
}

// ============================
// MEMORIA WHATSAPP
// ============================

async function loadWhatsAppMemory(empresaId, phone, limit = 5) {
  try {
    const memoria = await sql`
      SELECT mensaje, respuesta FROM whatsapp_memory_180
      WHERE empresa_id = ${empresaId} AND phone = ${phone}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return memoria.reverse().flatMap((m) => [
      { role: "user", content: m.mensaje },
      { role: "assistant", content: m.respuesta },
    ]);
  } catch {
    return [];
  }
}

async function saveWhatsAppMemory(empresaId, phone, mensaje, respuesta) {
  try {
    await sql`
      INSERT INTO whatsapp_memory_180 (empresa_id, phone, mensaje, respuesta)
      VALUES (${empresaId}, ${phone}, ${mensaje}, ${respuesta})
    `;
    // Mantener solo las ultimas 20 conversaciones por telefono
    await sql`
      DELETE FROM whatsapp_memory_180
      WHERE empresa_id = ${empresaId} AND phone = ${phone}
        AND id NOT IN (
          SELECT id FROM whatsapp_memory_180
          WHERE empresa_id = ${empresaId} AND phone = ${phone}
          ORDER BY created_at DESC LIMIT 20
        )
    `;
  } catch (err) {
    console.error("[WhatsApp] Error guardando memoria:", err);
  }
}

// ============================
// CONFIRMACION DE ACCIONES
// ============================

async function checkPendingConfirmation(empresaId, phone) {
  try {
    const [pending] = await sql`
      SELECT * FROM whatsapp_pending_actions_180
      WHERE empresa_id = ${empresaId} AND phone = ${phone}
        AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1
    `;
    return pending || null;
  } catch {
    return null;
  }
}

async function clearPendingConfirmation(empresaId, phone) {
  await sql`
    DELETE FROM whatsapp_pending_actions_180
    WHERE empresa_id = ${empresaId} AND phone = ${phone}
  `;
}

// ============================
// FORMATO WHATSAPP
// ============================

function formatForWhatsApp(text) {
  if (!text) return "";
  let result = text;
  // Headers markdown → negrita WhatsApp
  result = result.replace(/^#{1,4}\s+(.+)$/gm, "*$1*");
  // **negrita** → *negrita*
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");
  // Links markdown → texto plano
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, "$1: $2");
  // Tablas → eliminar
  result = result.replace(/\|[-]+\|/g, "");
  // Lineas horizontales
  result = result.replace(/^---+$/gm, "");
  // Limite WhatsApp 4096 chars
  if (result.length > 4000) {
    result = result.substring(0, 3997) + "...";
  }
  return result.trim();
}

// ============================
// LOG
// ============================

async function logWhatsAppInteraction({ empresaId, phone, messageId, direction, message, response, isAudio }) {
  try {
    await sql`
      INSERT INTO whatsapp_log_180 (empresa_id, phone, message_id, direction, message, response, is_audio)
      VALUES (${empresaId}, ${phone}, ${messageId || null}, ${direction}, ${message}, ${response || null}, ${isAudio || false})
    `;
  } catch (err) {
    console.error("[WhatsApp] Error logging:", err);
  }
}

// ============================
// HANDLER PRINCIPAL
// ============================

/**
 * POST /api/webhook/whatsapp
 * Recibe mensajes desde n8n
 * Body: { phone, message, messageId, isAudio, timestamp }
 */
export async function handleWhatsAppMessage(req, res) {
  try {
    // 1. Validar API key
    if (!validateApiKey(req)) {
      console.log("[WhatsApp] API key invalida");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { phone, message, messageId, isAudio, timestamp } = req.body;

    // 2. Validar campos requeridos
    if (!phone || !message) {
      return res.status(400).json({ error: "phone and message are required" });
    }

    // 3. Rate limiting
    if (!checkRateLimit(phone)) {
      return res.status(429).json({ error: "Too many messages. Try again in a minute." });
    }

    console.log(`[WhatsApp] Mensaje de ${phone}: ${message.substring(0, 100)}...`);

    // 4. Obtener contexto admin por telefono (valida y obtiene empresa/usuario)
    const context = await getAdminContextByPhone(phone);
    if (!context) {
      console.log(`[WhatsApp] Telefono no autorizado o sin perfil: ${phone}`);

      // Devolver mensaje instructivo al usuario por WhatsApp
      const setupMessage = `Hola! 👋

Para usar CONTENDO por WhatsApp, primero necesitas configurar tu numero de telefono en tu perfil de APP180.

*Pasos:*
1. Inicia sesion en APP180 (https://app180-frontend.vercel.app)
2. Ve a *Perfil* en el menu
3. Agrega tu numero de WhatsApp en el campo *Telefono*
4. Guarda los cambios

Tu numero actual: ${phone}

Una vez configurado, podras usar todas las funciones de CONTENDO desde WhatsApp: consultar facturas, crear clientes, registrar pagos y mucho mas.`;

      return res.json({
        response: setupMessage,
        whatsappFormat: true,
        requiresSetup: true
      });
    }

    // 6. Comprobar confirmaciones pendientes
    const pendingAction = await checkPendingConfirmation(context.empresaId, phone);

    if (pendingAction) {
      const confirmWords = ["si", "sí", "yes", "confirmar", "confirmo", "ok", "dale"];
      const cancelWords = ["no", "cancelar", "cancela", "anular"];
      const msgLower = message.trim().toLowerCase();

      if (confirmWords.includes(msgLower)) {
        // Ejecutar la accion pendiente
        const { ejecutarHerramientaDirecta } = await import("../services/aiAgentService.js");
        const result = await ejecutarHerramientaDirecta(
          pendingAction.tool_name,
          pendingAction.arguments,
          context.empresaId
        );
        await clearPendingConfirmation(context.empresaId, phone);

        const responseText = result.error
          ? `Error: ${result.error}`
          : result.mensaje || "Accion ejecutada correctamente.";

        await logWhatsAppInteraction({
          empresaId: context.empresaId, phone, messageId,
          direction: "inbound", message, response: responseText, isAudio: false,
        });

        return res.json({ response: responseText, whatsappFormat: true });
      } else if (cancelWords.includes(msgLower)) {
        await clearPendingConfirmation(context.empresaId, phone);

        await logWhatsAppInteraction({
          empresaId: context.empresaId, phone, messageId,
          direction: "inbound", message, response: "Accion cancelada.", isAudio: false,
        });

        return res.json({ response: "Accion cancelada.", whatsappFormat: true });
      }
      // Si no es ni confirmar ni cancelar, limpiar y tratar como mensaje nuevo
      await clearPendingConfirmation(context.empresaId, phone);
    }

    // 7. Cargar historial WhatsApp
    const whatsappHistory = await loadWhatsAppMemory(context.empresaId, phone, 5);

    // 8. Llamar a CONTENDO con canal whatsapp
    const respuesta = await chatConAgente({
      empresaId: context.empresaId,
      userId: context.userId,
      userRole: context.userRole,
      mensaje: message,
      historial: whatsappHistory,
      canal: "whatsapp",
      phoneNumber: phone,
    });

    // 9. Formatear para WhatsApp
    const formattedResponse = formatForWhatsApp(respuesta.mensaje);

    // 10. Guardar memoria y log
    await saveWhatsAppMemory(context.empresaId, phone, message, formattedResponse);
    await logWhatsAppInteraction({
      empresaId: context.empresaId, phone, messageId,
      direction: "inbound", message, response: formattedResponse, isAudio: isAudio || false,
    });

    res.json({ response: formattedResponse, whatsappFormat: true });
  } catch (err) {
    console.error("[WhatsApp] Error:", err);
    res.status(500).json({ error: "Error processing message" });
  }
}

/**
 * POST /api/webhook/whatsapp/status
 * Recibe actualizaciones de estado desde n8n
 */
export async function handleWhatsAppStatus(req, res) {
  try {
    if (!validateApiKey(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { messageId, status, timestamp } = req.body;
    console.log(`[WhatsApp] Status: ${messageId} -> ${status}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[WhatsApp] Status error:", err);
    res.status(500).json({ error: "Error processing status" });
  }
}
