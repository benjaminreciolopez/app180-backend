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

  // Si ya fue procesado por este middleware (doble authRequired), no re-procesar
  // Usamos req._authProcessed (no req.user) porque req.user = decoded lo sobreescribiría
  if (req._authProcessed) {
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

  let token = null;
  const authHeader = req.headers.authorization || req.get("Authorization");

  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0] === "Bearer") {
      token = parts[1];
    }
  } else if (req.query.token) {
    // Permitir token en query string para iframes/proxies (ej: proxy de documentos)
    // NOTA: Solo usar para endpoints que lo necesiten (proxy, descargas)
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: "Token no proporcionado o inválido" });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;

    // ==========================
    // 🏢 RESOLVER ASESORIA_ID PARA ASESORES
    // ==========================
    if (req.user.role === "asesor") {
      if (!req.user.asesoria_id) {
        const asesorRows = await sql`
          SELECT asesoria_id, activo
          FROM asesoria_usuarios_180
          WHERE user_id = ${req.user.id}
          LIMIT 1
        `;

        if (asesorRows.length === 0) {
          return res.status(404).json({ error: "Asesor no vinculado a ninguna asesoría" });
        }

        if (!asesorRows[0].activo) {
          return res.status(403).json({ error: "Cuenta de asesor desactivada" });
        }

        req.user.asesoria_id = asesorRows[0].asesoria_id;
      }

      // ==========================
      // 🔄 CONTEXT SWITCHING: X-Empresa-Id
      // ==========================
      // Si el asesor envía X-Empresa-Id, validamos el vínculo y permisos,
      // e inyectamos empresa_id para que los controladores admin existentes funcionen sin cambios.
      const targetEmpresaId = req.headers["x-empresa-id"];
      if (targetEmpresaId) {
        const vinculo = await sql`
          SELECT permisos
          FROM asesoria_clientes_180
          WHERE asesoria_id = ${req.user.asesoria_id}
            AND empresa_id = ${targetEmpresaId}
            AND estado = 'activo'
          LIMIT 1
        `;

        if (vinculo.length === 0) {
          return res.status(403).json({ error: "Sin acceso a esta empresa" });
        }

        req.user.empresa_id = targetEmpresaId;
        req.user.asesorPermisos = vinculo[0].permisos || {};
        req.user.isAsesorContext = true;

        // Cargar módulos de la empresa objetivo
        const cfg = await sql`
          SELECT modulos
          FROM empresa_config_180
          WHERE empresa_id = ${targetEmpresaId}
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
          fiscal: false,
        };
        req._authProcessed = true;
        return next();
      } else {
        // Asesor accediendo a sus propios módulos (empresa propia de la asesoría)
        // Si empresa_id no está en el JWT, buscarlo de la asesoría
        if (!req.user.empresa_id) {
          const asesoriaRows = await sql`
            SELECT empresa_id FROM asesorias_180
            WHERE id = ${req.user.asesoria_id}
            LIMIT 1
          `;
          if (asesoriaRows.length > 0 && asesoriaRows[0].empresa_id) {
            req.user.empresa_id = asesoriaRows[0].empresa_id;
          }
        }

        if (req.user.empresa_id) {
          // Elevamos el role a "admin" para que los controladores existentes funcionen sin cambios
          req.user.isAsesorOwnBusiness = true;
          req.user.originalRole = "asesor";
          req.user.role = "admin";
          // NO hacer return aquí — el asesor elevado debe pasar por ensureSelfEmployee y carga de módulos
        } else {
          // Asesor sin empresa propia ni X-Empresa-Id: solo rutas de asesor puras
          req._authProcessed = true;
          return next();
        }
      }
    }

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
        fiscal: false,
      };
    }
    req._authProcessed = true;

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
