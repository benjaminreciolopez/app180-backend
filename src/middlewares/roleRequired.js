// backend/src/middlewares/roleRequired.js

export function roleRequired(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "No autenticado" });
    }

    // Permitir acceso a admins en rutas de empleados
    if (role === "empleado" && req.user.role === "admin") {
      return next();
    }

    // Permitir acceso a asesores en rutas admin/empleado cuando tienen context switching activo
    if (req.user.role === "asesor" && req.user.isAsesorContext) {
      if (role === "admin" || role === "empleado") {
        return next();
      }
    }

    if (req.user.role !== role) {
      return res.status(403).json({ error: "No autorizado" });
    }

    next();
  };
}
