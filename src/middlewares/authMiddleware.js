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
  // 🌐 RUTAS PÚBLICAS (SIN AUTH)
  // ==========================

  const publicPaths = [
    "/manifest.json",
    "/favicon.ico",
    "/sw.js",
    "/robots.txt",
    "/icons/",
    "/_next/",
    "/static/",
  ];

  if (publicPaths.some((p) => req.path.startsWith(p))) {
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
    // 🔐 BLOQUEO POR PASSWORD FORZADA
    // ==========================
    const isEmpleado = decoded.role === "empleado";
    const passwordForced = decoded.password_forced === true;

    if (isEmpleado && passwordForced) {
      const ruta = req.path;

      const rutasPermitidas = ["/auth/change-password", "/auth/logout"];

      const esRutaPermitida = rutasPermitidas.some((r) => ruta.startsWith(r));

      if (!esRutaPermitida) {
        return res.status(403).json({
          error: "Debes cambiar tu contraseña antes de continuar",
          code: "PASSWORD_FORCED",
        });
      }
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

    return next();
  } catch (err) {
    console.error("JWT ERROR:", err);
    return res.status(401).json({ error: "Token inválido" });
  }
};
