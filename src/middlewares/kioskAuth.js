// backend/src/middlewares/kioskAuth.js

import { sql } from "../db.js";

/**
 * Middleware de autenticación para dispositivos kiosko.
 * Usa un token de dispositivo en lugar de JWT de usuario.
 * Header: Authorization: KioskToken <device_token>
 */
export const kioskAuthRequired = async (req, res, next) => {
  if (req.method === "OPTIONS") return next();

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("KioskToken ")) {
    return res.status(401).json({ error: "Token de dispositivo no proporcionado" });
  }

  const token = authHeader.split(" ")[1];

  if (!token || token.length < 32) {
    return res.status(401).json({ error: "Token de dispositivo inválido" });
  }

  try {
    const [device] = await sql`
      SELECT
        kd.id,
        kd.empresa_id,
        kd.centro_trabajo_id,
        kd.nombre,
        kd.offline_pin,
        kd.activo,
        ct.nombre AS centro_nombre,
        e.nombre AS empresa_nombre
      FROM kiosk_devices_180 kd
      LEFT JOIN centros_trabajo_180 ct ON ct.id = kd.centro_trabajo_id
      LEFT JOIN empresa_180 e ON e.id = kd.empresa_id
      WHERE kd.device_token = ${token}
      LIMIT 1
    `;

    if (!device) {
      return res.status(401).json({ error: "Dispositivo no registrado" });
    }

    if (!device.activo) {
      return res.status(403).json({ error: "Dispositivo desactivado. Contacta con el administrador." });
    }

    // Actualizar último uso (no bloqueante)
    sql`UPDATE kiosk_devices_180 SET ultimo_uso = now() WHERE id = ${device.id}`.catch(() => {});

    // Inyectar contexto del kiosko
    req.kiosk = {
      id: device.id,
      empresa_id: device.empresa_id,
      centro_trabajo_id: device.centro_trabajo_id,
      nombre: device.nombre,
      centro_nombre: device.centro_nombre,
      empresa_nombre: device.empresa_nombre,
      offline_pin: device.offline_pin,
    };

    next();
  } catch (err) {
    console.error("❌ Error en kioskAuth:", err);
    return res.status(500).json({ error: "Error de autenticación del dispositivo" });
  }
};
