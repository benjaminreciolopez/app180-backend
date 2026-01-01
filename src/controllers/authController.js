import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sql } from "../db.js";
import { config } from "../config.js";

// =====================
// REGISTRO DE USUARIO
// =====================
export const register = async (req, res) => {
  try {
    const { email, password, nombre, role } = req.body;

    if (!email || !password || !nombre || !role) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await sql`
      INSERT INTO users_180 (email, password, nombre, role)
      VALUES (${email}, ${hashed}, ${nombre}, ${role})
      RETURNING id, email, nombre, role
    `;

    const user = result[0];

    if (role === "admin") {
      await sql`
        INSERT INTO empresa_180 (user_id, nombre)
        VALUES (${user.id}, ${nombre})
      `;
    }

    return res.json({ success: true, user });
  } catch (err) {
    console.error("Error en register:", err);
    return res.status(500).json({ error: "Error al registrar usuario" });
  }
};

// =====================
// LOGIN DE USUARIO
// =====================

// src/controllers/authController.js

export const login = async (req, res) => {
  try {
    const { email, password, device_hash, user_agent } = req.body;
    const ipActual = req.ip;

    const rows = await sql`
      SELECT * FROM users_180 WHERE email = ${email}
    `;

    if (rows.length === 0) {
      return res.status(400).json({ error: "Usuario no encontrado" });
    }

    const user = rows[0];

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ error: "Contraseña incorrecta" });
    }

    // comprobar si es empleado
    const empleadoRows = await sql`
      SELECT id FROM employees_180
      WHERE user_id = ${user.id}
    `;

    const esEmpleado = empleadoRows.length > 0;
    let empleadoId = esEmpleado ? empleadoRows[0].id : null;

    if (esEmpleado) {
      if (!device_hash) {
        return res.status(400).json({
          error: "Falta device_hash (obligatorio para empleados)",
        });
      }

      const deviceRows = await sql`
        SELECT * FROM employee_devices_180
        WHERE empleado_id = ${empleadoId}
      `;

      if (deviceRows.length === 0) {
        await sql`
          INSERT INTO employee_devices_180
            (user_id, empleado_id, device_hash, user_agent, activo, ip_habitual)
          VALUES
            (${user.id}, ${empleadoId}, ${device_hash}, ${
          user_agent || null
        }, true, ${ipActual})
        `;
      } else {
        const device = deviceRows[0];

        if (device.device_hash !== device_hash) {
          return res.status(403).json({
            error:
              "Este usuario ya tiene asignado un dispositivo. Solicita al administrador autorización para cambiarlo.",
          });
        }

        if (!device.activo) {
          return res.status(403).json({
            error: "Este dispositivo está desactivado por el administrador.",
          });
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

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        nombre: user.nombre,
        empleado_id: empleadoId,
        device_hash: device_hash || null,
      },
      config.jwtSecret,
      { expiresIn: "7d" }
    );

    // 👈 MUY IMPORTANTE: responder exactamente esto
    return res.json({ token, user });
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
      SELECT * FROM invite_180 WHERE token = ${token}
    `;

    if (invites.length === 0) {
      return res.status(400).json({ error: "Token de invitación inválido" });
    }

    const invite = invites[0];

    if (invite.usado) {
      return res.status(400).json({ error: "La invitación ya fue usada" });
    }

    // 🔎 Ver si ya tiene dispositivo
    const existing = await sql`
      SELECT * FROM employee_devices_180
      WHERE empleado_id = ${invite.empleado_id}
      AND activo = true
    `;

    // 🚫 Si ya tiene dispositivo y la invitación NO es de cambio → bloquear
    if (existing.length > 0 && invite.tipo !== "cambio") {
      return res.status(403).json({
        error:
          "Este empleado ya tiene un dispositivo asignado. El administrador debe autorizar un cambio.",
      });
    }

    // 🔐 Seguridad: desactivamos anteriores
    await sql`
      UPDATE employee_devices_180
      SET activo = false
      WHERE empleado_id = ${invite.empleado_id}
    `;

    // 🔁 Activamos (o creamos) el nuevo
    const device = await sql`
      INSERT INTO employee_devices_180
        (user_id, empleado_id, empresa_id, device_hash, user_agent, activo, ip_habitual)
      VALUES
        (${invite.user_id}, ${invite.empleado_id}, ${invite.empresa_id},
         ${device_hash}, ${user_agent || null}, true, ${ipActual})
      ON CONFLICT (empleado_id, device_hash)
      DO UPDATE SET
        activo = true,
        ip_habitual = EXCLUDED.ip_habitual,
        user_agent = EXCLUDED.user_agent,
        empresa_id = EXCLUDED.empresa_id,
        updated_at = now()
      RETURNING *;
    `;

    // marcar invitación usada
    await sql`
      UPDATE invite_180
      SET usado = true, usado_en = now()
      WHERE id = ${invite.id}
    `;

    return res.json({
      success: true,
      message: "Dispositivo registrado correctamente",
      device: device[0],
    });
  } catch (err) {
    console.error("❌ Error en activateInstall:", err);
    return res.status(500).json({ error: "Error al activar instalación" });
  }
};
