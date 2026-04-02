// backend/src/middlewares/asesorWriteGuard.js
// Guard que verifica permisos de escritura cuando un asesor opera en contexto de cliente

export function asesorWriteGuard(permisoKey) {
  return (req, res, next) => {
    // Si no es context switch de asesor, dejar pasar (es admin normal)
    if (!req.user?.isAsesorContext) return next();

    const permisos = req.user.asesorPermisos || {};
    const perm = permisos[permisoKey];

    // GET → solo necesita read
    if (req.method === "GET" || req.method === "HEAD") {
      if (perm?.read) return next();
      return res.status(403).json({ error: "Sin permiso de lectura para esta sección" });
    }

    // POST, PUT, DELETE → necesita write
    if (perm?.write) return next();

    return res.status(403).json({ error: "Sin permiso de escritura para esta sección" });
  };
}
