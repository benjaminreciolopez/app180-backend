import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sql } from "../db.js";
import { config } from "../config.js";
import { ensureSelfEmployee } from "../services/ensureSelfEmployee.js";
import crypto from "crypto";
import { sendEmail } from "../services/emailService.js";

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

      // =========================
      // CONTROL DE DISPOSITIVO
      // =========================
      const deviceRows = await sql`
    SELECT *
    FROM employee_devices_180
    WHERE empleado_id = ${empleadoId}
  `;

      if (deviceRows.length === 0) {
        await sql`
      INSERT INTO employee_devices_180
        (user_id, empleado_id, device_hash, user_agent, activo, ip_habitual)
      VALUES
        (${user.id}, ${empleadoId}, ${device_hash},
         ${user_agent || null}, true, ${ipActual})
    `;
      } else {
        const device = deviceRows[0];

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
            return res.status(403).json({
              error:
                "Este usuario ya tiene asignado un dispositivo. Solicita autorización para cambiarlo.",
            });
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
      { expiresIn: "1d" },
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
      WHERE token = ${token}
      LIMIT 1
    `;

    if (invites.length === 0) {
      return res.status(400).json({ error: "Token de invitación inválido" });
    }

    const invite = invites[0];

    // ❌ ya usada
    if (invite.usado === true || invite.used_at) {
      return res.status(409).json({
        error: "Esta invitación ya fue usada. Solicita otra al administrador.",
      });
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

    // marcar invitación como usada
    await sql`
      UPDATE invite_180
      SET usado = true,
          usado_en = now(),
          used_at = now()
      WHERE id = ${invite.id}
    `;

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
      { expiresIn: "1d" },
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
      { expiresIn: "1d" },
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
    await sql`
      UPDATE invite_180
      SET usado = true,
          usado_en = now(),
          used_at = now()
      WHERE empleado_id = ${empleado_id}
        AND (usado IS DISTINCT FROM true)
    `;

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

    // 4️⃣ enviar email
    await sendEmail({
      to: email,
      subject: "Activación de nuevo dispositivo – APP180",
      html: `
        <p>Hola ${nombre},</p>
        <p>Tu administrador ha autorizado un nuevo dispositivo.</p>
        <p>Este enlace caduca en <strong>24 horas</strong>:</p>
        <p><a href="${link}">${link}</a></p>
        <p>Abre este enlace desde el móvil donde instalarás la PWA.</p>
      `,
      text: `Hola ${nombre},

Tu administrador ha autorizado un nuevo dispositivo.

Este enlace caduca en 24 horas:
${link}

Ábrelo desde el móvil donde instalarás la PWA.`,
    });

    return res.json({
      success: true,
      link,
      expires_at: invite[0].expires_at,
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

    // 1️⃣ Invalidar invitaciones anteriores
    await sql`
      UPDATE invite_180
      SET usado = true,
          usado_en = now(),
          used_at = now()
      WHERE empleado_id = ${empleado_id}
        AND (usado IS DISTINCT FROM true)
    `;

    // 2️⃣ Si es cambio → limpiar dispositivos
    if (tipo === "cambio") {
      await sql`
        DELETE FROM employee_devices_180
        WHERE empleado_id = ${empleado_id}
      `;
    }

    // 3️⃣ Token
    const token = crypto.randomBytes(24).toString("hex");

    // 4️⃣ Guardar invitación (24h)
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

    // 5️⃣ Enviar email
    await sendEmail({
      to: email,
      subject: "Activación de dispositivo – APP180",
      html: `
        <p>Hola ${nombre},</p>
        <p>Tu administrador ha autorizado el acceso a APP180.</p>
        <p>Este enlace caduca en <strong>24 horas</strong>:</p>
        <p><a href="${link}">${link}</a></p>
        <p>Ábrelo desde el móvil donde instalarás la PWA.</p>
      `,
      text: `Hola ${nombre},

Tu administrador ha autorizado el acceso a APP180.

Este enlace caduca en 24 horas:
${link}

Ábrelo desde el móvil donde instalarás la PWA.`,
    });

    return res.json({
      success: true,
      installUrl: link,
      expires_at: invite[0].expires_at,
    });
  } catch (err) {
    console.error("❌ inviteEmpleado", err);
    return res.status(500).json({ error: "No se pudo generar la invitación" });
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

      LEFT JOIN employees_180 e
        ON e.user_id = u.id

      LEFT JOIN empresa_config_180 ec
        ON ec.empresa_id = e.empresa_id

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
