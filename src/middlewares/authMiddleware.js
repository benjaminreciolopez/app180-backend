import jwt from "jsonwebtoken";
import { config } from "../config.js";

export const authRequired = (req, res, next) => {
  // ✅ PERMITIR PREFLIGHT CORS
  if (req.method === "OPTIONS") {
    return next();
  }

  const authHeader = req.headers.authorization;

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
    // 🔐 BLOQUEO POR PASSWORD FORZADA
    // ==========================
    const isEmpleado = decoded.role === "empleado";
    const passwordForced = decoded.password_forced === true;

    if (isEmpleado && passwordForced) {
      const ruta = req.originalUrl;

      const rutasPermitidas = ["/auth/change-password", "/auth/logout"];

      const esRutaPermitida = rutasPermitidas.some((r) => ruta.startsWith(r));

      if (!esRutaPermitida) {
        return res.status(403).json({
          error: "Debes cambiar tu contraseña antes de continuar",
          code: "PASSWORD_FORCED",
        });
      }
    }

    next();
  } catch (err) {
    console.error("JWT ERROR:", err);
    return res.status(401).json({ error: "Token inválido" });
  }
};
