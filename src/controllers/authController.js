import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sql } from "../db.js";
import { config } from "../config.js";
import { ensureSelfEmployee } from "../services/ensureSelfEmployee.js";
import crypto from "crypto";
import { sendEmail } from "../services/emailService.js";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { encrypt } from "../utils/encryption.js";

export const registerFirstAdmin = async (req, res) => {
  try {
    const { email, password, nombre, empresa_nombre } = req.body;

    if (!email || !password || !nombre || !empresa_nombre) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    // ¿Sistema inicializado?
    const check = await sql`
      SELECT COUNT(*)::int AS total
      FROM empresa_180
    `;

    if (check[0].total > 0) {
      return res.status(403).json({
        error: "Sistema ya inicializado",
      });
    }

    const hash = await bcrypt.hash(password, 10);

    // 1️⃣ Crear usuario admin
    // Crear admin
    const user = await sql`
  INSERT INTO users_180 (
    email,
    password,
    nombre,
    role,
    password_forced
  )
  VALUES (
    ${email},
    ${hash},
    ${nombre},
    'admin',
    false
  )
  RETURNING id
`;

    const userId = user[0].id;

    // Crear empresa (ya queda asociada por user_id)
    const empresa = await sql`
  INSERT INTO empresa_180 (user_id, nombre)
  VALUES (${userId}, ${empresa_nombre})
  RETURNING id
`;
    await sql`
      INSERT INTO empresa_config_180 (empresa_id)
      VALUES (${empresa[0].id})
    `;

    return res.json({ success: true });
  } catch (e) {
    console.error("❌ registerFirstAdmin", e);

    return res.status(500).json({
      error: "Error inicializando sistema",
      message: e.message,
    });
  }
};

// =====================
// REGISTRO DE USUARIO
// =====================
export const register = async (req, res) => {
  return res.status(403).json({
    error: "Registro público deshabilitado",
  });
};

// GET /empleado/device-hash
export const getDeviceHash = async (req, res) => {
  try {
    const empleadoId = req.user.empleado_id;

    if (req.user.role === "admin") {
      return res.json({ device_hash: null });
    }

    if (!empleadoId) {
      return res.status(400).json({ error: "No es empleado" });
    }

    const rows = await sql`
      SELECT device_hash 
      FROM employee_devices_180
      WHERE empleado_id = ${empleadoId}
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "No hay dispositivo registrado" });
    }

    return res.json({ device_hash: rows[0].device_hash });
  } catch (e) {
    console.error("❌ getDeviceHash", e);
    return res.status(500).json({ error: "Error obteniendo device hash" });
  }
};

// =====================
// LOGIN DE USUARIO
// =====================

export const login = async (req, res) => {
  try {
    // BOOTSTRAP GUARD (único)
    const init = await sql`
      SELECT COUNT(*)::int AS total
      FROM empresa_180
    `;
    console.log("BOOTSTRAP COUNT:", init[0].total);

    if (init[0].total === 0) {
      return res.status(409).json({
        error: "Sistema no inicializado",
        code: "BOOTSTRAP_REQUIRED",
      });
    }

    console.log("LOGIN desde frontend", req.body);

    const { email, password, device_hash, user_agent } = req.body;
    const ipActual = req.ip;

    const rows = await sql`
      SELECT
        id,
        email,
        password,
        nombre,
        role,
        password_forced
      FROM users_180
      WHERE email = ${email}
    `;

    if (rows.length === 0) {
      return res.status(400).json({ error: "Usuario no encontrado" });
    }

    const user = rows[0];

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ error: "Contraseña incorrecta" });
    }
    let empresaId = null;

    if (user.role === "admin") {
      const empresaRows = await sql`
    SELECT id
    FROM empresa_180
    WHERE user_id = ${user.id}
  `;

      if (empresaRows.length === 0) {
        return res.status(500).json({ error: "Empresa no encontrada" });
      }

      empresaId = empresaRows[0].id;
    }
    let empleadoId = null;

    // =========================
    // ADMIN → empleado lógico (si módulo empleados activo)
    // =========================

    if (user.role === "admin" && empresaId) {
      const cfg = await sql`
        SELECT modulos
        FROM empresa_config_180
        WHERE empresa_id = ${empresaId}
        LIMIT 1
      `;

      const modulos = cfg[0]?.modulos || {};

      if (modulos.empleados !== false) {
        empleadoId = await ensureSelfEmployee({
          userId: user.id,
          empresaId,
          nombre: user.nombre,
        });
      }
    }

    // =========================
    // EMPLEADO REAL
    // =========================
    if (user.role === "empleado") {
      const empleadoRows = await sql`
    SELECT id, empresa_id
    FROM employees_180
    WHERE user_id = ${user.id}
  `;

      if (empleadoRows.length === 0) {
        return res.status(403).json({
          error: "Empleado no asociado a ninguna empresa",
        });
      }

      empleadoId = empleadoRows[0].id;
      empresaId = empleadoRows[0].empresa_id;

      // 🔐 device_hash obligatorio para empleados
      if (!device_hash) {
        return res.status(400).json({
          error: "Falta device_hash (obligatorio para empleados)",
        });
      }

      // 🚫 empleado sin empresa → bloqueo inmediato
      if (!empresaId) {
        return res.status(403).json({
          error: "Empleado sin empresa asignada",
        });
      }

    }
    // cargar módulos empresa
    let modulos = {};

    if (empresaId) {
      const cfg = await sql`
        SELECT modulos
        FROM empresa_config_180
        WHERE empresa_id = ${empresaId}
        LIMIT 1
      `;

      modulos = cfg[0]?.modulos || {};
    }

    // =========================
    // CONTROL DE DISPOSITIVO (Compartido Admin/Empleado)
    // =========================
    if (empleadoId && device_hash) {
      const deviceRows = await sql`
        SELECT *
        FROM employee_devices_180
        WHERE empleado_id = ${empleadoId}
      `;

      if (deviceRows.length === 0) {
        await sql`
          INSERT INTO employee_devices_180
            (user_id, empleado_id, empresa_id, device_hash, user_agent, activo, ip_habitual)
          VALUES
            (${user.id}, ${empleadoId}, ${empresaId}, ${device_hash},
             ${user_agent || null}, true, ${ipActual})
        `;
      } else {
        const device = deviceRows[0];

        // Si cambia el hash, verificar si era único o actualizar
        if (device.device_hash !== device_hash) {
          const count = await sql`
            SELECT COUNT(*)::int AS total
            FROM employee_devices_180
            WHERE empleado_id = ${empleadoId}
          `;

          if (count[0].total === 1) {
            await sql`
              UPDATE employee_devices_180
              SET device_hash = ${device_hash},
                  user_agent = ${user_agent || device.user_agent},
                  ip_habitual = ${ipActual},
                  updated_at = now()
              WHERE id = ${device.id}
            `;
          } else {
            // Nota: Para admins tal vez no queramos bloquear el login, 
            // pero mantenemos la lógica estricta de dispositivo único por ahora.
            if (user.role === 'empleado') {
              return res.status(403).json({
                error: "Este usuario ya tiene asignado un dispositivo. Solicita autorización para cambiarlo.",
              });
            }
            // Si es admin, permitimos actualizar (o ignoramos, pero mejor actualizar para que funcione el fichaje)
            await sql`
              UPDATE employee_devices_180
              SET device_hash = ${device_hash},
                  user_agent = ${user_agent || device.user_agent},
                  ip_habitual = ${ipActual},
                  updated_at = now()
              WHERE id = ${device.id}
             `;
          }
        }

        if (!device.ip_habitual) {
          await sql`
            UPDATE employee_devices_180
            SET ip_habitual = ${ipActual}
            WHERE id = ${device.id}
          `;
        }
      }

      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
          nombre: user.nombre,
          empresa_id: empresaId,
          empleado_id: empleadoId,
          modulos,
          device_hash: device_hash || null,
          password_forced: user.password_forced === true, // 👈 CLAVE
        },
        config.jwtSecret,
        { expiresIn: "10h" },
      );

      // 👈 MUY IMPORTANTE: responder exactamente esto
      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          nombre: user.nombre,
          role: user.role,
          empresa_id: empresaId,
          empleado_id: empleadoId,
          modulos,
          password_forced: user.password_forced === true,
        },
      });
    } catch (err) {
      console.error("❌ Error en login:", err);
      return res.status(500).json({ error: "Error al iniciar sesión" });
    }
  };

  // ======================================
  // ACTIVACIÓN DEL DISPOSITIVO MEDIANTE INVITACIÓN
  // ======================================
  export const activateInstall = async (req, res) => {
    try {
      const { token, device_hash, user_agent } = req.body;
      const ipActual = req.ip;

      if (!token || !device_hash) {
        return res.status(400).json({ error: "Faltan token o device_hash" });
      }

      const invites = await sql`
      SELECT *
      FROM invite_180
      WHERE token = ${token} OR code = ${token}
      LIMIT 1
    `;

      if (invites.length === 0) {
        return res.status(400).json({ error: "Token de invitación inválido" });
      }

      const invite = invites[0];

      // ❌ ya usada - PERO permitir si el dispositivo no está activo (instalación fallida)
      if (invite.usado === true || invite.used_at) {
        // Verificar si el dispositivo está activo
        const deviceCheck = await sql`
        SELECT activo
        FROM employee_devices_180
        WHERE empleado_id = ${invite.empleado_id}
        LIMIT 1
      `;

        // Si el dispositivo existe y está activo, no permitir reutilizar
        if (deviceCheck.length > 0 && deviceCheck[0].activo === true) {
          return res.status(409).json({
            error: "Esta invitación ya fue usada. Solicita otra al administrador.",
          });
        }

        // Si el dispositivo no está activo o no existe, permitir reinstalar
        console.log("⚠️ Token usado pero dispositivo inactivo, permitiendo reinstalación");
      }

      // ⏳ caducada
      if (
        invite.expires_at &&
        new Date(invite.expires_at).getTime() < Date.now()
      ) {
        return res.status(410).json({
          error: "Invitación caducada. Solicita otra al administrador.",
        });
      }

      // 🔐 limpieza de dispositivos anteriores
      await sql`
      DELETE FROM employee_devices_180
      WHERE empleado_id = ${invite.empleado_id}
    `;

      // 🔁 registrar nuevo dispositivo
      const device = await sql`
      INSERT INTO employee_devices_180
        (user_id, empleado_id, empresa_id, device_hash, user_agent, activo, ip_habitual)
      VALUES
        (${invite.user_id},
         ${invite.empleado_id},
         ${invite.empresa_id},
         ${device_hash},
         ${user_agent || null},
         true,
         ${ipActual})
      RETURNING *;
    `;

      // marcar invitación como usada (solo si no estaba ya marcada)
      if (!invite.usado) {
        await sql`
        UPDATE invite_180
        SET usado = true,
            usado_en = now(),
            used_at = now()
        WHERE id = ${invite.id}
      `;
      }

      // obtener usuario
      const userRows = await sql`
  SELECT id, email, nombre, role, password_forced
  FROM users_180
  WHERE id = ${invite.user_id}
  LIMIT 1
`;

      const user = userRows[0];

      const tokenJwt = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
          nombre: user.nombre,
          empresa_id: invite.empresa_id,
          empleado_id: invite.empleado_id,
          device_hash,
          password_forced: true,
        },
        config.jwtSecret,
        { expiresIn: "10h" },
      );

      return res.json({
        success: true,
        message: "Dispositivo autorizado y sesión iniciada",
        token: tokenJwt,
        user: {
          id: user.id,
          email: user.email,
          nombre: user.nombre,
          role: user.role,
          empresa_id: invite.empresa_id,
          empleado_id: invite.empleado_id,
          password_forced: true,
        },
      });
    } catch (err) {
      console.error("❌ Error en activateInstall:", err);
      return res.status(500).json({ error: "Error al activar instalación" });
    }
  };

  // src/controllers/authController.js

  export const changePassword = async (req, res) => {
    try {
      const userId = req.user.id;
      const { current_password, new_password } = req.body;

      if (!current_password || !new_password) {
        return res.status(400).json({ error: "Faltan datos" });
      }

      if (new_password.length < 6) {
        return res.status(400).json({
          error: "La nueva contraseña debe tener al menos 6 caracteres",
        });
      }

      const rows = await sql`
      SELECT id, password, email, nombre, role
      FROM users_180
      WHERE id = ${userId}
    `;

      if (rows.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      const user = rows[0];

      const match = await bcrypt.compare(current_password, user.password);
      if (!match) {
        return res.status(400).json({ error: "Contraseña actual incorrecta" });
      }

      const hashed = await bcrypt.hash(new_password, 10);

      await sql`
      UPDATE users_180
      SET password = ${hashed},
          password_forced = false,
          updated_at = now()
      WHERE id = ${userId}
    `;

      // 🔐 Generar nuevo token manteniendo el contexto completo
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
          nombre: user.nombre,

          // 👉 MUY IMPORTANTE: mantener contexto
          empresa_id: req.user.empresa_id ?? null,
          empleado_id: req.user.empleado_id ?? null,

          // 👉 ya NO forzado
          password_forced: false,
        },
        config.jwtSecret,
        { expiresIn: "10h" },
      );

      return res.json({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          nombre: user.nombre,
          role: user.role,
          empresa_id: req.user.empresa_id ?? null,
          empleado_id: req.user.empleado_id ?? null,
          password_forced: false,
        },
      });
    } catch (err) {
      console.error("❌ Error en changePassword:", err);
      return res.status(500).json({ error: "Error al cambiar la contraseña" });
    }
  };

  export const autorizarCambioDispositivo = async (req, res) => {
    try {
      const adminUserId = req.user.id;
      const { empleado_id } = req.params;

      console.log(`🔄 Autorizando cambio de dispositivo para empleado ${empleado_id}`);

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

      // 1️⃣ invalidar invitaciones anteriores
      const invalidated = await sql`
      UPDATE invite_180
      SET usado = true,
          usado_en = now(),
          used_at = now()
      WHERE empleado_id = ${empleado_id}
        AND (usado IS DISTINCT FROM true)
      RETURNING id
    `;

      if (invalidated.length > 0) {
        console.log(`♻️ Invalidadas ${invalidated.length} invitaciones anteriores`);
      }

      // 2️⃣ generar token
      const token = crypto.randomBytes(24).toString("hex");

      // 3️⃣ guardar invitación (24h)
      const invite = await sql`
      INSERT INTO invite_180 (
        token,
        empleado_id,
        empresa_id,
        user_id,
        usado,
        expires_at
      )
      VALUES (
        ${token},
        ${empleado_id},
        ${empresa_id},
        ${user_id},
        false,
        now() + interval '24 hours'
      )
      RETURNING token, expires_at
    `;

      const link = `${process.env.FRONTEND_URL}/empleado/instalar?token=${token}`;

      console.log(`✅ Cambio de dispositivo autorizado para ${nombre} (${email})`);
      console.log(`🔗 Enlace: ${link}`);
      console.log(`⏰ Expira: ${invite[0].expires_at}`);

      // ✅ NO enviar email automáticamente
      // El admin decidirá cómo compartir el enlace

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
      console.error("❌ autorizarCambioDispositivo", err);
      return res
        .status(500)
        .json({ error: "Error autorizando cambio de dispositivo" });
    }
  };

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
  export const getMe = async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "No autenticado" });
      }

      const userId = req.user.id;

      // Cargar usuario actualizado
      const rows = await sql`
      SELECT
        u.id,
        u.email,
        u.nombre,
        u.role,
        u.password_forced,

        e.id AS empleado_id,
        e.empresa_id,

        ec.modulos

      FROM users_180 u

      LEFT JOIN empresa_180 emp
        ON emp.user_id = u.id

      LEFT JOIN employees_180 e
        ON e.user_id = u.id

      LEFT JOIN empresa_config_180 ec
        ON ec.empresa_id = COALESCE(e.empresa_id, emp.id)

      WHERE u.id = ${userId}
      LIMIT 1
    `;

      if (!rows.length) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      const r = rows[0];

      return res.json({
        id: r.id,
        email: r.email,
        nombre: r.nombre,
        role: r.role,

        empresa_id: r.empresa_id,
        empleado_id: r.empleado_id,

        modulos: r.modulos || {},

        password_forced: r.password_forced === true,
      });
    } catch (err) {
      console.error("❌ getMe:", err);
      res.status(500).json({ error: "Error obteniendo sesión" });
    }
  };

  // =====================================================
  // GOOGLE SIGN-IN / SIGN-UP (ID Token verification)
  // =====================================================
  export const googleAuth = async (req, res) => {
    try {
      const { credential } = req.body;

      if (!credential) {
        return res.status(400).json({ error: "Falta credential de Google" });
      }

      // Verify ID token with Google
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      const googleId = payload.sub;
      const email = payload.email;
      const nombre = payload.name || email.split("@")[0];
      const avatarUrl = payload.picture || null;

      console.log(`🔵 Google Auth: ${email} (${googleId})`);

      // Check if user exists by google_id
      let userRows = await sql`
      SELECT id, email, nombre, role, google_id, password_forced
      FROM users_180
      WHERE google_id = ${googleId}
    `;

      // Also check by email (user might exist with email+password)
      if (userRows.length === 0) {
        userRows = await sql`
        SELECT id, email, nombre, role, google_id, password_forced
        FROM users_180
        WHERE email = ${email}
      `;
      }

      let user;
      let empresaId;
      let isNewUser = false;

      if (userRows.length > 0) {
        // ---- EXISTING USER → LOGIN ----
        user = userRows[0];

        // Update google_id and avatar if not set
        if (!user.google_id) {
          await sql`
          UPDATE users_180
          SET google_id = ${googleId}, avatar_url = ${avatarUrl}, updated_at = now()
          WHERE id = ${user.id}
        `;
        }

        // Get empresa
        if (user.role === "admin") {
          const empresaRows = await sql`
          SELECT id FROM empresa_180 WHERE user_id = ${user.id}
        `;
          if (empresaRows.length === 0) {
            return res.status(500).json({ error: "Empresa no encontrada" });
          }
          empresaId = empresaRows[0].id;
        } else {
          const empRows = await sql`
          SELECT empresa_id FROM employees_180 WHERE user_id = ${user.id}
        `;
          empresaId = empRows[0]?.empresa_id;
        }

        console.log(`✅ Google Login: ${email} (existing user)`);
      } else {
        // ---- NEW USER → SIGNUP ----
        isNewUser = true;

        // Create user (no password - Google-only)
        const newUser = await sql`
        INSERT INTO users_180 (email, nombre, role, google_id, avatar_url, password_forced)
        VALUES (${email}, ${nombre}, 'admin', ${googleId}, ${avatarUrl}, false)
        RETURNING id, email, nombre, role
      `;

        user = newUser[0];

        // Create empresa
        const domain = email.split("@")[1]?.split(".")[0] || nombre;
        const empresaNombre = domain.charAt(0).toUpperCase() + domain.slice(1);

        const empresa = await sql`
        INSERT INTO empresa_180 (user_id, nombre)
        VALUES (${user.id}, ${empresaNombre})
        RETURNING id
      `;

        empresaId = empresa[0].id;

        // Create default config with all modules enabled by default
        const defaultModulos = {
          clientes: true,
          fichajes: true,
          calendario: true,
          calendario_import: true,
          worklogs: true,
          empleados: true,
          facturacion: false,
          pagos: false,
        };
        await sql`
        INSERT INTO empresa_config_180 (empresa_id, modulos)
        VALUES (${empresaId}, ${defaultModulos}::jsonb)
      `;

        console.log(`✅ Google Signup: ${email} → empresa "${empresaNombre}" created`);
      }

      // Load modules
      let modulos = {};
      if (empresaId) {
        const cfg = await sql`
        SELECT modulos FROM empresa_config_180
        WHERE empresa_id = ${empresaId} LIMIT 1
      `;
        modulos = cfg[0]?.modulos || {};
      }

      // Ensure self employee if module active
      let empleadoId = null;
      if (user.role === "admin" && empresaId && modulos.empleados !== false) {
        empleadoId = await ensureSelfEmployee({
          userId: user.id,
          empresaId,
          nombre: user.nombre,
        });
      }

      // Generate JWT
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
          nombre: user.nombre,
          empresa_id: empresaId,
          empleado_id: empleadoId,
          modulos,
          password_forced: false,
        },
        config.jwtSecret,
        { expiresIn: "10h" },
      );

      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          nombre: user.nombre,
          role: user.role,
          empresa_id: empresaId,
          empleado_id: empleadoId,
          modulos,
          avatar_url: avatarUrl,
          password_forced: false,
        },
        is_new_user: isNewUser,
      });
    } catch (err) {
      console.error("❌ googleAuth:", err);
      return res.status(500).json({ error: "Error con autenticación de Google" });
    }
  };

  // =====================================================
  // COMPLETE SETUP: OAuth2 con scopes Calendar + Gmail
  // =====================================================
  export const googleCompleteSetup = async (req, res) => {
    try {
      const { empresa_nombre } = req.body;
      const userId = req.user.id;
      const empresaId = req.user.empresa_id;

      // Update empresa name if provided
      if (empresa_nombre) {
        await sql`
        UPDATE empresa_180 SET nombre = ${empresa_nombre}
        WHERE id = ${empresaId}
      `;
      }

      // Generate OAuth2 URL with all scopes (Calendar + Gmail)
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI,
      );

      const scopes = [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/calendar",
        "https://mail.google.com/",
      ];

      const state = Buffer.from(
        JSON.stringify({
          userId,
          empresaId,
          type: "complete_setup",
        }),
      ).toString("base64");

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        state,
        prompt: "consent",
      });

      return res.json({ authUrl });
    } catch (err) {
      console.error("❌ googleCompleteSetup:", err);
      return res.status(500).json({ error: "Error iniciando setup" });
    }
  };

  // =====================================================
  // UNIFIED CALLBACK: Guarda Calendar + Gmail tokens
  // =====================================================
  export const handleUnifiedCallback = async (req, res) => {
    try {
      const { code, state, error: authError } = req.query;

      if (authError) {
        return res.send(callbackHTML("error", "Autenticación cancelada"));
      }

      if (!code || !state) {
        return res.status(400).send(callbackHTML("error", "Faltan parámetros"));
      }

      const { userId, empresaId, type } = JSON.parse(
        Buffer.from(state, "base64").toString(),
      );

      // Exchange code for tokens
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI,
      );

      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.refresh_token) {
        return res.send(
          callbackHTML("error", "No se obtuvo refresh token. Intenta de nuevo."),
        );
      }

      // Get user email
      oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      const email = userInfo.data.email;

      const encryptedToken = encrypt(tokens.refresh_token);

      if (type === "complete_setup") {
        // Save BOTH Calendar and Gmail config

        // 1. Gmail config
        await sql`
        INSERT INTO empresa_email_config_180 (empresa_id, modo, oauth2_provider, oauth2_email, oauth2_refresh_token, oauth2_connected_at, from_name, from_email)
        VALUES (${empresaId}, 'oauth2', 'gmail', ${email}, ${encryptedToken}, now(), ${email.split("@")[0]}, ${email})
        ON CONFLICT (empresa_id) DO UPDATE SET
          modo = 'oauth2',
          oauth2_provider = 'gmail',
          oauth2_email = ${email},
          oauth2_refresh_token = ${encryptedToken},
          oauth2_connected_at = now(),
          from_email = ${email},
          updated_at = now()
      `;

        // 2. Calendar config
        await sql`
        INSERT INTO empresa_calendar_config_180 (empresa_id, oauth2_provider, oauth2_email, oauth2_refresh_token, oauth2_connected_at, sync_enabled)
        VALUES (${empresaId}, 'google', ${email}, ${encryptedToken}, now(), true)
        ON CONFLICT (empresa_id) DO UPDATE SET
          oauth2_email = ${email},
          oauth2_refresh_token = ${encryptedToken},
          oauth2_connected_at = now(),
          sync_enabled = true,
          updated_at = now()
      `;

        console.log(`✅ Complete setup: Calendar + Gmail configured for empresa ${empresaId}`);
      } else if (type === "calendar") {
        // Only Calendar
        await sql`
        INSERT INTO empresa_calendar_config_180 (empresa_id, oauth2_provider, oauth2_email, oauth2_refresh_token, oauth2_connected_at, sync_enabled)
        VALUES (${empresaId}, 'google', ${email}, ${encryptedToken}, now(), true)
        ON CONFLICT (empresa_id) DO UPDATE SET
          oauth2_email = ${email},
          oauth2_refresh_token = ${encryptedToken},
          oauth2_connected_at = now(),
          sync_enabled = true,
          updated_at = now()
      `;
      } else {
        // Only Gmail (existing flow)
        await sql`
        INSERT INTO empresa_email_config_180 (empresa_id, modo, oauth2_provider, oauth2_email, oauth2_refresh_token, oauth2_connected_at, from_name, from_email)
        VALUES (${empresaId}, 'oauth2', 'gmail', ${email}, ${encryptedToken}, now(), ${email.split("@")[0]}, ${email})
        ON CONFLICT (empresa_id) DO UPDATE SET
          modo = 'oauth2',
          oauth2_provider = 'gmail',
          oauth2_email = ${email},
          oauth2_refresh_token = ${encryptedToken},
          oauth2_connected_at = now(),
          from_email = ${email},
          updated_at = now()
      `;
      }

      return res.send(callbackHTML("success", "Servicios configurados correctamente"));
    } catch (err) {
      console.error("❌ handleUnifiedCallback:", err);
      return res.status(500).send(callbackHTML("error", err.message));
    }
  };

  // Helper: HTML for callback popup
  function callbackHTML(status, message) {
    const isSuccess = status === "success";
    return `<!DOCTYPE html>
<html><head><title>${isSuccess ? "Conectado" : "Error"}</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: ${isSuccess ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" : "#fee"}; }
  .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center; max-width: 400px; }
  .icon { font-size: 4rem; margin-bottom: 1rem; }
  h1 { color: ${isSuccess ? "#10b981" : "#dc2626"}; margin: 0 0 0.5rem; }
  p { color: #6b7280; }
  button { background: #3b82f6; color: white; border: none; padding: 0.75rem 2rem; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; font-weight: 600; margin-top: 1rem; }
</style></head>
<body><div class="card">
  <div class="icon">${isSuccess ? "&#10003;" : "&#10007;"}</div>
  <h1>${isSuccess ? "Conectado" : "Error"}</h1>
  <p>${message}</p>
  <button onclick="window.close()">Cerrar</button>
</div>
<script>
  if (window.opener) { window.opener.postMessage({ type: '${isSuccess ? "oauth-success" : "oauth-error"}', status: '${status}' }, '*'); }
  ${isSuccess ? "setTimeout(() => window.close(), 3000);" : ""}
</script>
</body></html>`;
  }
};

