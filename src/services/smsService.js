// backend/src/services/smsService.js
//
// Servicio SMS con Twilio.
// Import dinámico: solo se carga si el paquete está instalado.

import { sql } from "../db.js";
import { decrypt } from "../utils/encryption.js";

let twilioClient = null;
let twilioAvailable = null;

/**
 * Intenta cargar el módulo Twilio de forma dinámica.
 * Retorna null si no está instalado.
 */
async function getTwilioClient(accountSid, authToken) {
  if (twilioAvailable === false) return null;

  try {
    const twilio = await import("twilio");
    const Twilio = twilio.default || twilio;
    twilioClient = new Twilio(accountSid, authToken);
    twilioAvailable = true;
    return twilioClient;
  } catch {
    twilioAvailable = false;
    console.warn("⚠️ Twilio no está instalado. SMS no disponible. Instala con: npm install twilio");
    return null;
  }
}

/**
 * Envía un SMS usando la configuración Twilio de la empresa.
 *
 * @param {Object} params
 * @param {string} params.to       - Número de teléfono destino (formato E.164: +34612345678)
 * @param {string} params.body     - Mensaje a enviar
 * @param {string} params.empresaId - UUID de la empresa
 * @returns {{ success: boolean, messageId: string }}
 */
export async function sendSMS({ to, body, empresaId }) {
  // Cargar config Twilio de la empresa
  const [config] = await sql`
    SELECT sms_enabled, twilio_account_sid, twilio_auth_token_encrypted, twilio_phone_number
    FROM empresa_config_180
    WHERE empresa_id = ${empresaId}
  `;

  if (!config || !config.sms_enabled) {
    throw new Error("SMS no está habilitado para esta empresa");
  }

  if (!config.twilio_account_sid || !config.twilio_auth_token_encrypted || !config.twilio_phone_number) {
    throw new Error("Configuración Twilio incompleta. Contacta al administrador.");
  }

  const authToken = decrypt(config.twilio_auth_token_encrypted);
  const client = await getTwilioClient(config.twilio_account_sid, authToken);

  if (!client) {
    throw new Error("Servicio SMS no disponible. Twilio no está instalado en el servidor.");
  }

  // Normalizar número de teléfono
  const normalizedTo = normalizePhone(to);

  try {
    const message = await client.messages.create({
      body,
      from: config.twilio_phone_number,
      to: normalizedTo,
    });

    console.log(`✅ SMS enviado a ${normalizedTo}: ${message.sid}`);
    return { success: true, messageId: message.sid };
  } catch (err) {
    console.error("❌ Error enviando SMS:", err.message);
    throw new Error("Error al enviar SMS: " + err.message);
  }
}

/**
 * Normaliza un número de teléfono al formato E.164.
 * Si no tiene prefijo internacional, asume +34 (España).
 */
function normalizePhone(phone) {
  if (!phone) throw new Error("Número de teléfono requerido");

  let clean = phone.replace(/[\s\-()]/g, "");

  // Si ya tiene +, devolver limpio
  if (clean.startsWith("+")) return clean;

  // Si empieza por 00, reemplazar por +
  if (clean.startsWith("00")) return "+" + clean.slice(2);

  // Asumir España si es un número de 9 dígitos
  if (/^\d{9}$/.test(clean)) return "+34" + clean;

  // Si es un número largo sin prefijo, devolver con +
  return "+" + clean;
}
