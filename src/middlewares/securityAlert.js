import { sql } from "../db.js";
import { getClientIp } from "../utils/clientIp.js";
import { getEmailTransporter } from "../services/emailService.js";

/**
 * Middleware que detecta actividad desde IPs desconocidas y envía alertas.
 * @param {string} tipoAlerta - Tipo de acción: 'login', 'config_change', 'new_user', 'subscription'
 */
export function securityAlert(tipoAlerta) {
  return async (req, res, next) => {
    // Ejecutar en background para no bloquear la respuesta
    processAlert(req, tipoAlerta).catch((err) =>
      console.error("[SecurityAlert] Error:", err.message)
    );
    next();
  };
}

/**
 * Función independiente para registrar alerta de pago (para webhooks sin req.user)
 */
export async function alertPaymentReceived(empresaId, detalles) {
  try {
    const [row] = await sql`
      INSERT INTO security_alerts_180 (empresa_id, tipo, ip_origen, detalles, notificado)
      VALUES (${empresaId}, 'pago_recibido', 'stripe-webhook', ${JSON.stringify(detalles)}::jsonb, false)
      RETURNING id
    `;

    // Verificar si notificaciones de pago están activadas
    const [config] = await sql`
      SELECT notify_email, notify_on FROM empresa_config_180 WHERE empresa_id = ${empresaId}
    `;
    if (!config?.notify_email) return;

    const notifyOn = config.notify_on || {};
    if (!notifyOn.payment) return;

    await sendAlertEmail(row.id, config.notify_email, empresaId, "pago_recibido", "stripe-webhook", "", detalles);
  } catch (err) {
    console.error("[SecurityAlert] Error alertPaymentReceived:", err.message);
  }
}

async function processAlert(req, tipoAlerta) {
  const empresaId = req.user?.empresa_id;
  if (!empresaId) return;

  const ip = getClientIp(req);
  const userAgent = req.headers["user-agent"] || "desconocido";
  const userId = req.user?.id;

  // Obtener config de IPs confiables
  const [config] = await sql`
    SELECT owner_ips, notify_email, notify_on
    FROM empresa_config_180
    WHERE empresa_id = ${empresaId}
  `;

  if (!config) return;

  const ownerIps = config.owner_ips || [];
  const notifyOn = config.notify_on || {};
  const esIpConocida = ownerIps.includes(ip);

  // Registrar siempre la alerta
  const [row] = await sql`
    INSERT INTO security_alerts_180 (empresa_id, tipo, ip_origen, user_agent, user_id, detalles, es_ip_conocida)
    VALUES (
      ${empresaId}, ${tipoAlerta}, ${ip}, ${userAgent}, ${userId},
      ${JSON.stringify({ path: req.originalUrl, method: req.method })}::jsonb,
      ${esIpConocida}
    )
    RETURNING id
  `;

  // Si IP conocida y no es un tipo que siempre notifica, skip email
  if (esIpConocida && tipoAlerta !== "pago_recibido") return;

  // Verificar si este tipo de alerta tiene notificación activada
  if (!notifyOn[mapTipoToConfig(tipoAlerta)]) return;

  if (!config.notify_email) return;

  // Enviar email de alerta (pasar id + email para evitar query duplicada)
  await sendAlertEmail(row.id, config.notify_email, empresaId, tipoAlerta, ip, userAgent, { path: req.originalUrl });
}

function mapTipoToConfig(tipo) {
  const map = {
    login: "login",
    config_change: "config",
    new_user: "config",
    subscription: "subscription",
    pago_recibido: "payment",
  };
  return map[tipo] || "config";
}

/** Escapa caracteres HTML para prevenir XSS en emails */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendAlertEmail(alertId, email, empresaId, tipo, ip, userAgent, detalles) {
  try {
    const transporter = await getEmailTransporter(empresaId);
    if (!transporter) return;

    const tipoDescripcion = {
      login: "Inicio de sesión",
      config_change: "Cambio de configuración",
      new_user: "Nuevo empleado creado",
      subscription: "Cambio de suscripción",
      pago_recibido: "Pago recibido",
    };

    const fecha = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });

    // Escapar datos de usuario para prevenir XSS en email
    const safeIp = escapeHtml(ip);
    const safeUserAgent = escapeHtml(userAgent);
    const safeDetalles = escapeHtml(JSON.stringify(detalles || {}));

    await transporter.sendMail({
      to: email,
      subject: `⚠️ Alerta de seguridad: ${tipoDescripcion[tipo] || tipo}`,
      html: `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;">
  <div style="background:white;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="width:48px;height:48px;border-radius:50%;background:#FEF2F2;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;">
        <span style="font-size:24px;">🔒</span>
      </div>
      <h2 style="color:#1a1a1a;margin:0;">Actividad detectada</h2>
    </div>

    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:12px;padding:16px;margin-bottom:20px;">
      <p style="margin:0;font-weight:600;color:#DC2626;">${tipoDescripcion[tipo] || tipo}</p>
      <p style="margin:4px 0 0;color:#7F1D1D;font-size:14px;">${fecha}</p>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#6B7280;width:120px;">IP origen</td><td style="padding:8px 0;font-weight:600;">${safeIp}</td></tr>
      <tr><td style="padding:8px 0;color:#6B7280;">Navegador</td><td style="padding:8px 0;font-size:12px;word-break:break-all;">${safeUserAgent || "—"}</td></tr>
      <tr><td style="padding:8px 0;color:#6B7280;">Detalle</td><td style="padding:8px 0;font-size:12px;">${safeDetalles}</td></tr>
    </table>

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #E5E7EB;text-align:center;">
      <p style="color:#6B7280;font-size:12px;margin:0;">
        Si no reconoces esta actividad, cambia tu contraseña inmediatamente.
      </p>
    </div>
  </div>
</body>
</html>`,
    });

    // Marcar como notificado usando el ID exacto del registro
    await sql`
      UPDATE security_alerts_180
      SET notificado = true
      WHERE id = ${alertId}
    `;
  } catch (err) {
    console.error("[SecurityAlert] Error enviando email:", err.message);
  }
}
