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

function validatePhone(phoneNumber) {
  const adminPhone = process.env.WHATSAPP_ADMIN_PHONE;
  if (!adminPhone) return false;
  const normalized = phoneNumber.replace(/^\+/, "");
  return normalized === adminPhone.replace(/^\+/, "");
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

async function getAdminContext() {
  const empresaId = process.env.WHATSAPP_EMPRESA_ID;
  const userId = process.env.WHATSAPP_ADMIN_USER_ID;

  if (empresaId && userId) {
    return { empresaId, userId, userRole: "admin" };
  }

  // Fallback: buscar primera empresa
  const [empresa] = await sql`
    SELECT id as empresa_id, user_id FROM empresa_180 LIMIT 1
  `;
  if (!empresa) return null;
  return { empresaId: empresa.empresa_id, userId: empresa.user_id, userRole: "admin" };
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

    // 3. Validar telefono admin
    if (!validatePhone(phone)) {
      console.log(`[WhatsApp] Telefono no autorizado: ${phone}`);
      return res.status(403).json({ error: "Phone number not authorized" });
    }

    // 4. Rate limiting
    if (!checkRateLimit(phone)) {
      return res.status(429).json({ error: "Too many messages. Try again in a minute." });
    }

    console.log(`[WhatsApp] Mensaje de ${phone}: ${message.substring(0, 100)}...`);

    // 5. Obtener contexto admin
    const context = await getAdminContext();
    if (!context) {
      return res.status(500).json({ error: "Admin context not found" });
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
