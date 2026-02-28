// backend/src/services/otpService.js
//
// Servicio OTP para verificación de empleados en kiosko.
// Genera códigos de 6 dígitos, envía por email/SMS, verifica con protección anti-brute-force.

import crypto from "crypto";
import { sql } from "../db.js";
import { sendEmail } from "./emailService.js";
import { sendSMS } from "./smsService.js";

// ─── Generar código OTP (6 dígitos cripto-random) ────────────

export function generateOTPCode() {
  return String(crypto.randomInt(100000, 999999));
}

// ─── Crear y enviar OTP ──────────────────────────────────────

/**
 * Crea un OTP y lo envía al empleado por el canal configurado.
 *
 * @param {Object} params
 * @param {string} params.empleadoId - UUID del empleado
 * @param {string} params.empresaId  - UUID de la empresa
 * @returns {{ sent: true, tipo: string, destino_parcial: string }}
 */
export async function createAndSendOTP({ empleadoId, empresaId }) {
  // 1. Rate limit: max 5 OTPs/hora por empleado
  const [rateCheck] = await sql`
    SELECT COUNT(*)::int AS count
    FROM otp_codes_180
    WHERE empleado_id = ${empleadoId}
      AND created_at > NOW() - INTERVAL '1 hour'
  `;

  if (rateCheck.count >= 5) {
    throw new Error("Demasiados códigos solicitados. Espera unos minutos.");
  }

  // 2. Cargar empleado + config empresa
  const [empleado] = await sql`
    SELECT id, nombre, email, telefono
    FROM employees_180
    WHERE id = ${empleadoId} AND empresa_id = ${empresaId} AND activo = true
  `;

  if (!empleado) {
    throw new Error("Empleado no encontrado");
  }

  const [config] = await sql`
    SELECT kiosk_auth_method, sms_enabled
    FROM empresa_config_180
    WHERE empresa_id = ${empresaId}
  `;

  const authMethod = config?.kiosk_auth_method || "otp_email";

  // 3. Determinar canal de envío
  let tipo = "email";
  let destino = null;

  if (authMethod === "otp_sms" || authMethod === "otp_both") {
    if (empleado.telefono) {
      tipo = "sms";
      destino = empleado.telefono;
    } else if (empleado.email) {
      tipo = "email";
      destino = empleado.email;
    } else {
      throw new Error("El empleado no tiene teléfono ni email configurado");
    }
  } else {
    // otp_email (default)
    if (empleado.email) {
      tipo = "email";
      destino = empleado.email;
    } else if (empleado.telefono && config?.sms_enabled) {
      tipo = "sms";
      destino = empleado.telefono;
    } else {
      throw new Error("El empleado no tiene email configurado");
    }
  }

  // 4. Invalidar OTPs anteriores no usados
  await sql`
    UPDATE otp_codes_180
    SET used_at = NOW()
    WHERE empleado_id = ${empleadoId}
      AND used_at IS NULL
      AND expires_at > NOW()
  `;

  // 5. Generar código
  const code = generateOTPCode();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos

  // 6. Guardar en BD
  await sql`
    INSERT INTO otp_codes_180 (empresa_id, empleado_id, code, tipo, expires_at)
    VALUES (${empresaId}, ${empleadoId}, ${code}, ${tipo}, ${expiresAt})
  `;

  // 7. Enviar
  if (tipo === "sms") {
    await sendSMS({
      to: destino,
      body: `Tu código de fichaje es: ${code}. Válido durante 5 minutos.`,
      empresaId,
    });
  } else {
    await sendEmail(
      {
        to: destino,
        subject: "Código de verificación para fichaje",
        html: buildOTPEmailHTML(code, empleado.nombre),
        text: `Tu código de fichaje es: ${code}. Válido durante 5 minutos.`,
      },
      empresaId
    );
  }

  // 8. Respuesta con destino parcialmente oculto
  const destinoParcial =
    tipo === "email" ? maskEmail(destino) : maskPhone(destino);

  return { sent: true, tipo, destino_parcial: destinoParcial };
}

// ─── Verificar OTP ───────────────────────────────────────────

/**
 * Verifica un código OTP.
 *
 * @param {Object} params
 * @param {string} params.empleadoId - UUID del empleado
 * @param {string} params.code       - Código de 6 dígitos
 * @returns {boolean} true si el código es válido
 */
export async function verifyOTP({ empleadoId, code }) {
  if (!code || code.length !== 6) {
    return false;
  }

  // Buscar OTP válido (no usado, no expirado)
  const [otp] = await sql`
    SELECT id, intentos_fallidos
    FROM otp_codes_180
    WHERE empleado_id = ${empleadoId}
      AND code = ${code}
      AND used_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!otp) {
    // Incrementar intentos fallidos del OTP más reciente
    await sql`
      UPDATE otp_codes_180
      SET intentos_fallidos = intentos_fallidos + 1
      WHERE id = (
        SELECT id FROM otp_codes_180
        WHERE empleado_id = ${empleadoId}
          AND used_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      )
    `;

    // Verificar si hay bloqueo (5+ intentos fallidos)
    const [recent] = await sql`
      SELECT intentos_fallidos
      FROM otp_codes_180
      WHERE empleado_id = ${empleadoId}
        AND used_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (recent && recent.intentos_fallidos >= 5) {
      // Invalidar todos los OTPs activos (forzar nuevo envío)
      await sql`
        UPDATE otp_codes_180
        SET used_at = NOW()
        WHERE empleado_id = ${empleadoId}
          AND used_at IS NULL
          AND expires_at > NOW()
      `;
      throw new Error("Demasiados intentos fallidos. Solicita un nuevo código.");
    }

    return false;
  }

  // Marcar como usado
  await sql`
    UPDATE otp_codes_180
    SET used_at = NOW()
    WHERE id = ${otp.id}
  `;

  return true;
}

// ─── Helpers ─────────────────────────────────────────────────

function maskEmail(email) {
  if (!email) return "***";
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  const masked = user.charAt(0) + "***" + (user.length > 1 ? user.charAt(user.length - 1) : "");
  return `${masked}@${domain}`;
}

function maskPhone(phone) {
  if (!phone) return "***";
  const clean = phone.replace(/\s/g, "");
  if (clean.length < 4) return "***";
  return "***" + clean.slice(-4);
}

function buildOTPEmailHTML(code, nombre) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1e293b; margin-bottom: 8px;">Código de verificación</h2>
      <p style="color: #64748b; margin-bottom: 24px;">
        Hola ${nombre}, usa este código para confirmar tu fichaje:
      </p>
      <div style="background: #f1f5f9; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1e293b;">
          ${code}
        </span>
      </div>
      <p style="color: #94a3b8; font-size: 13px;">
        Este código es válido durante 5 minutos. Si no has solicitado este código, ignora este mensaje.
      </p>
    </div>
  `;
}
