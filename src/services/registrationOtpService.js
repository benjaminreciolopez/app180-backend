// backend/src/services/registrationOtpService.js
//
// Servicio OTP para verificación de email en registro.
// Reutiliza helpers de otpService.js y emailService.js.

import { sql } from "../db.js";
import { generateOTPCode } from "./otpService.js";
import { sendEmail } from "./emailService.js";

// ─── Enviar OTP de registro ─────────────────────────────────

export async function sendRegistrationOTP(email) {
  const normalizedEmail = email.trim().toLowerCase();

  // 1. Rate limit: max 5 OTPs/hora por email
  const [rateCheck] = await sql`
    SELECT COUNT(*)::int AS count
    FROM otp_codes_180
    WHERE email = ${normalizedEmail}
      AND empleado_id IS NULL
      AND created_at > NOW() - INTERVAL '1 hour'
  `;

  if (rateCheck.count >= 5) {
    throw new Error("Demasiados codigos solicitados. Espera unos minutos.");
  }

  // 2. Invalidar OTPs anteriores del mismo email
  await sql`
    UPDATE otp_codes_180
    SET used_at = NOW()
    WHERE email = ${normalizedEmail}
      AND empleado_id IS NULL
      AND used_at IS NULL
      AND expires_at > NOW()
  `;

  // 3. Generar código
  const code = generateOTPCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

  // 4. Guardar en BD
  await sql`
    INSERT INTO otp_codes_180 (email, code, tipo, expires_at)
    VALUES (${normalizedEmail}, ${code}, ${"email"}, ${expiresAt})
  `;

  // 5. Buscar empresa con email configurado para enviar el OTP
  const [emailConfig] = await sql`
    SELECT empresa_id FROM empresa_email_config_180
    WHERE modo != 'disabled'
    ORDER BY created_at ASC
    LIMIT 1
  `;
  const senderEmpresaId = emailConfig?.empresa_id || null;

  await sendEmail({
    to: normalizedEmail,
    subject: "Tu codigo de verificacion - CONTENDO GESTIONES",
    html: buildRegistrationOTPEmail(code),
    text: `Tu codigo de verificacion es: ${code}. Valido durante 10 minutos.`,
  }, senderEmpresaId);

  // 6. Respuesta con email parcialmente oculto
  return { sent: true, destino_parcial: maskEmail(normalizedEmail) };
}

// ─── Verificar OTP de registro ──────────────────────────────

export async function verifyRegistrationOTP(email, code) {
  const normalizedEmail = email.trim().toLowerCase();

  if (!code || code.length !== 6) {
    return false;
  }

  // Buscar OTP válido
  const [otp] = await sql`
    SELECT id, intentos_fallidos
    FROM otp_codes_180
    WHERE email = ${normalizedEmail}
      AND empleado_id IS NULL
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
        WHERE email = ${normalizedEmail}
          AND empleado_id IS NULL
          AND used_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      )
    `;

    // Verificar bloqueo (5+ intentos fallidos)
    const [recent] = await sql`
      SELECT intentos_fallidos
      FROM otp_codes_180
      WHERE email = ${normalizedEmail}
        AND empleado_id IS NULL
        AND used_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (recent && recent.intentos_fallidos >= 5) {
      await sql`
        UPDATE otp_codes_180
        SET used_at = NOW()
        WHERE email = ${normalizedEmail}
          AND empleado_id IS NULL
          AND used_at IS NULL
          AND expires_at > NOW()
      `;
      throw new Error("Demasiados intentos fallidos. Solicita un nuevo codigo.");
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

// ─── Helpers ────────────────────────────────────────────────

function maskEmail(email) {
  if (!email) return "***";
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  const masked = user.charAt(0) + "***" + (user.length > 1 ? user.charAt(user.length - 1) : "");
  return `${masked}@${domain}`;
}

function buildRegistrationOTPEmail(code) {
  return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 440px; margin: 0 auto; padding: 32px 24px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #1e293b; font-size: 22px; font-weight: 700; margin: 0;">CONTENDO GESTIONES</h1>
        <p style="color: #94a3b8; font-size: 13px; margin: 4px 0 0;">Verificacion de cuenta</p>
      </div>
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; text-align: center;">
        <h2 style="color: #1e293b; font-size: 18px; font-weight: 600; margin: 0 0 8px;">Codigo de verificacion</h2>
        <p style="color: #64748b; font-size: 14px; margin: 0 0 24px;">
          Usa este codigo para verificar tu email y completar tu registro:
        </p>
        <div style="background: #f1f5f9; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
          <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1e293b;">
            ${code}
          </span>
        </div>
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">
          Este codigo es valido durante <strong>10 minutos</strong>.<br/>
          Si no has solicitado este codigo, ignora este mensaje.
        </p>
      </div>
      <p style="color: #cbd5e1; font-size: 11px; text-align: center; margin-top: 24px;">
        &copy; ${new Date().getFullYear()} CONTENDO GESTIONES
      </p>
    </div>
  `;
}
