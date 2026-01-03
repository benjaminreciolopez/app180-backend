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
// GET /empleado/device-hash
export const getDeviceHash = async (req, res) => {
  try {
    const empleadoId = req.user.empleado_id;

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

// src/controllers/authController.js

export const login = async (req, res) => {
  try {
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
          console.log(
            "⚠️ device_hash distinto pero mismo empleado, actualizando..."
          );

          await sql`
    UPDATE employee_devices_180
    SET device_hash = ${device_hash},
        ip_habitual = ${ipActual},
        user_agent = ${user_agent || null},
        updated_at = now()
    WHERE id = ${device.id}
  `;
        }

        // Si el hash NO coincide, puede ser PWA / reinstall / borrar datos
        // ==========================
        // POLÍTICA DE DISPOSITIVO
        // ==========================
        if (device.device_hash !== device_hash) {
          console.log("⚠️ Device hash diferente detectado");
          console.log("BD:", device.device_hash);
          console.log("Nuevo:", device_hash);
          console.log("UA viejo:", device.user_agent);
          console.log("UA nuevo:", user_agent);
          console.log("IP vieja:", device.ip_habitual);
          console.log("IP nueva:", ipActual);

          // 🔐 NUEVA POLÍTICA:
          // Si solo existe 1 dispositivo registrado → asumimos mismo móvil
          const count = await sql`
    SELECT COUNT(*)::int AS total
    FROM employee_devices_180
    WHERE empleado_id = ${empleadoId}
  `;

          if (count[0].total === 1) {
            console.log(
              "🔄 Actualizando device_hash por cambio legítimo en iOS"
            );

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
                "Este usuario ya tiene asignado un dispositivo. Solicita al administrador autorización para cambiarlo.",
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

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        nombre: user.nombre,
        empleado_id: empleadoId,
        device_hash: device_hash || null,
        password_forced: user.password_forced === true, // 👈 CLAVE
      },
      config.jwtSecret,
      { expiresIn: "7d" }
    );

    // 👈 MUY IMPORTANTE: responder exactamente esto
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        role: user.role,
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

    // 🔐 SEGURIDAD: eliminamos cualquier dispositivo anterior
    await sql`
      DELETE FROM employee_devices_180
      WHERE empleado_id = ${invite.empleado_id}
    `;

    // 🔁 Registramos nuevo dispositivo limpio
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

    // marcar invitación usada
    await sql`
      UPDATE invite_180
      SET usado = true, usado_en = now()
      WHERE id = ${invite.id}
    `;

    return res.json({
      success: true,
      message: "Dispositivo autorizado y activado",
      device: device[0],
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

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        nombre: user.nombre,
        password_forced: false,
      },
      config.jwtSecret,
      { expiresIn: "7d" }
    );

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        role: user.role,
        password_forced: false,
      },
    });
  } catch (err) {
    console.error("❌ Error en changePassword:", err);
    return res.status(500).json({ error: "Error al cambiar la contraseña" });
  }
};
