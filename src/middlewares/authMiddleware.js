// backend\src\middlewares\authMiddleware.js
import { sql } from "../db.js";

import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { ensureSelfEmployee } from "../services/ensureSelfEmployee.js";

export const authRequired = async (req, res, next) => {
  // ✅ PERMITIR PREFLIGHT CORS
  if (req.method === "OPTIONS") {
    return next();
  }
  // ==========================
  // 🌐 RUTAS PÚBLICAS
  // ==========================
  const bootstrapRoutes = ["/auth/register-admin", "/system/status"];

  const publicRegex = [
    /^\/manifest\.json$/,
    /^\/favicon\.ico$/,
    /^\/sw\.js$/,
    /^\/robots\.txt$/,
    /^\/icons\//,
    /^\/_next\//,
    /^\/static\//,
  ];

  const path = req.originalUrl.split("?")[0];

  if (bootstrapRoutes.some((r) => path.startsWith(r))) {
    return next();
  }

  if (publicRegex.some((r) => r.test(path))) {
    return next();
  }

  const authHeader = req.headers.authorization || req.get("Authorization");

  if (!authHeader) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }

  const [type, token] = authHeader.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ error: "Token inválido" });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;

    // ==========================
    // 👷 GARANTIZAR EMPLEADO_ID PARA EMPLEADOS
    // ==========================
    if (req.user.role === "empleado" && !req.user.empleado_id) {
      const rows = await sql`
    SELECT id, empresa_id, activo
    FROM employees_180
    WHERE user_id = ${req.user.id}
    LIMIT 1
  `;

      if (rows.length === 0) {
        return res.status(404).json({ error: "Empleado no encontrado" });
      }

      if (!rows[0].activo) {
        return res.status(403).json({ error: "Empleado desactivado" });
      }

      req.user.empleado_id = rows[0].id;
      req.user.empresa_id = rows[0].empresa_id;
    }

    // ==========================
    // 👤 EMPLEADO LÓGICO PARA ADMIN (AUTÓNOMO)
    // ==========================
    if (
      req.user.role === "admin" &&
      req.user.empresa_id &&
      !req.user.empleado_id
    ) {
      req.user.empleado_id = await ensureSelfEmployee({
        userId: req.user.id,
        empresaId: req.user.empresa_id,
        nombre: req.user.nombre,
      });
    }
    // 📦 Ahora sí: módulos
    if (req.user.empresa_id) {
      const cfg = await sql`
        SELECT modulos
        FROM empresa_config_180
        WHERE empresa_id = ${req.user.empresa_id}
        LIMIT 1
      `;

      req.user.modulos = cfg[0]?.modulos || {
        clientes: true,
        empleados: true,
        fichajes: true,
        calendario: true,
        calendario_import: true,
        worklogs: true,
        ausencias: true,
        facturacion: false,
        pagos: false,
      };
    }
    // ==========================
    // 🔐 BLOQUEO POR PASSWORD FORZADA
    // ==========================
    const isEmpleado = req.user.role === "empleado";
    const passwordForced = req.user.password_forced === true;

    const fullPath = req.originalUrl.split("?")[0];

    if (isEmpleado && passwordForced) {
      // ✅ IMPORTANTE: Permitir /auth/me para que AuthInit funcione y no desconecte al usuario
      const rutasPermitidas = [
        "/auth/change-password",
        "/auth/logout",
        "/auth/me",
      ];

      if (!rutasPermitidas.some((r) => fullPath.startsWith(r))) {
        return res.status(403).json({
          error: "Debes cambiar tu contraseña antes de continuar",
          code: "PASSWORD_FORCED",
        });
      }
    }


    return next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Token expirado",
        code: "TOKEN_EXPIRED",
        expiredAt: err.expiredAt,
      });
    }
    console.error("JWT ERROR:", err);
    return res.status(401).json({ error: "Token inválido" });
  }
};
