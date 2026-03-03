// backend/src/controllers/auth/inviteController.js
// Employee invitation handlers

import { sql } from "../../db.js";
import { config } from "../../config.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendEmail } from "../../services/emailService.js";

export const inviteEmpleado = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { id: empleado_id } = req.params;
    const tipo = req.query.tipo || "nuevo"; // "nuevo" | "cambio"

    console.log(`📧 Generando invitación para empleado ${empleado_id}, tipo: ${tipo}`);

    const rows = await sql`
      SELECT 
        u.email,
        u.nombre,
        u.id AS user_id,
        e.empresa_id
      FROM employees_180 e
      JOIN users_180 u ON u.id = e.user_id
      WHERE e.id = ${empleado_id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado" });
    }

    const { email, nombre, user_id, empresa_id } = rows[0];

    // 1️⃣ Invalidar invitaciones anteriores (pendientes y expiradas)
    const invalidated = await sql`
      UPDATE invite_180
      SET usado = true,
          usado_en = now(),
          used_at = now()
      WHERE empleado_id = ${empleado_id}
        AND (usado = false OR usado IS NULL)
      RETURNING id
    `;

    if (invalidated.length > 0) {
      console.log(`♻️ Invalidadas ${invalidated.length} invitaciones anteriores`);
    }

    // 2️⃣ Si es cambio → limpiar dispositivos
    if (tipo === "cambio") {
      const deleted = await sql`
        DELETE FROM employee_devices_180
        WHERE empleado_id = ${empleado_id}
        RETURNING id
      `;
      console.log(`🗑️ Eliminados ${deleted.length} dispositivos anteriores`);
    }

    // 3️⃣ Token y Código
    const token = crypto.randomBytes(24).toString("hex");
    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 dígitos

    // 4️⃣ Guardar invitación (24h)
    const invite = await sql`
      INSERT INTO invite_180 (
        token,
        code,
        empleado_id,
        empresa_id,
        user_id,
        usado,
        expires_at
      )
      VALUES (
        ${token},
        ${code},
        ${empleado_id},
        ${empresa_id},
        ${user_id},
        false,
        now() + interval '24 hours'
      )
      RETURNING token, code, expires_at
    `;

    const link = `${process.env.FRONTEND_URL}/empleado/instalar?token=${token}`;

    console.log(`✅ Invitación generada para ${nombre} (${email})`);
    console.log(`🔗 Enlace: ${link}`);
    console.log(`⏰ Expira: ${invite[0].expires_at}`);

    // ✅ NO enviar email automáticamente
    // El admin decidirá cómo compartir el enlace (copiar, WhatsApp, email)

    return res.json({
      success: true,
      installUrl: link,
      expires_at: invite[0].expires_at,
      token: token,
      empleado: {
        nombre,
        email,
      },
    });
  } catch (err) {
    console.error("❌ inviteEmpleado", err);
    return res.status(500).json({ error: "No se pudo generar la invitación" });
  }
};

// =====================
// ENVIAR EMAIL DE INVITACIÓN (OPCIONAL)
// =====================
export const sendInviteEmail = async (req, res) => {
  try {
    const { id: empleado_id } = req.params;
    const { token, tipo = "nuevo" } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Falta token de invitación" });
    }

    console.log(`📧 Enviando email de invitación para empleado ${empleado_id}`);

    // Verificar que el token existe y no ha sido usado
    // Y necesitamos la empresa para configurar el transporte de email correcto
    const invites = await sql`
      SELECT 
        i.token,
        i.expires_at,
        i.usado,
        u.email,
        u.nombre,
        emp.empresa_id
      FROM invite_180 i
      JOIN users_180 u ON u.id = i.user_id
      JOIN employees_180 emp ON emp.id = i.empleado_id
      WHERE i.token = ${token}
        AND i.empleado_id = ${empleado_id}
      LIMIT 1
    `;

    if (invites.length === 0) {
      return res.status(404).json({ error: "Invitación no encontrada" });
    }

    const invite = invites[0];

    if (invite.usado) {
      return res.status(400).json({ error: "Esta invitación ya fue usada" });
    }

    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: "Esta invitación ha caducado" });
    }

    const link = `${process.env.FRONTEND_URL}/empleado/instalar?token=${token}`;

    // Importar template
    const { getInviteEmailTemplate } = await import("../templates/emailTemplates.js");
    const emailContent = getInviteEmailTemplate({
      nombre: invite.nombre,
      link,
      expiresAt: invite.expires_at,
      tipo,
    });

    console.log(`📧 Preparando email para ${invite.email} con empresa_id: ${invite.empresa_id}`);

    // Enviar email usando la configuración de la empresa
    try {
      await sendEmail({
        to: invite.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      }, invite.empresa_id);

      console.log(`✅ Email enviado exitosamente a ${invite.email}`);
    } catch (emailErr) {
      console.error(`❌ Error al enviar email a ${invite.email}:`, emailErr);
      throw emailErr;
    }

    return res.json({
      success: true,
      message: "Email enviado correctamente",
      sentTo: invite.email,
    });
  } catch (err) {
    console.error("❌ sendInviteEmail", err);
    return res.status(500).json({ error: "Error al enviar email" });
  }
};


// =====================
// GET /auth/me
// =====================
