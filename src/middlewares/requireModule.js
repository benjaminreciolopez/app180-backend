// backend/src/middlewares/requireModule.js

// Map between module config keys and asesor permission keys
const MODULE_TO_PERMISO = {
  contable: "contabilidad",
  facturacion: "facturas",
  pagos: "gastos",
  fiscal: "fiscal",
  clientes: "clientes",
  empleados: "empleados",
  worklogs: "worklogs",
};

export function requireModule(name) {
  return (req, res, next) => {
    // If the module is enabled for the empresa, allow
    if (req.user?.modulos?.[name]) return next();

    // If asesor in context-switch mode, check asesor permissions instead
    // (the client may not have the module enabled in their own config,
    // but the asesor has access via their asesoria link)
    if (req.user?.isAsesorContext) {
      const permisoKey = MODULE_TO_PERMISO[name] || name;
      const perm = req.user.asesorPermisos?.[permisoKey];
      if (perm?.read || perm?.write) return next();
    }

    return res.status(403).json({
      error: `Módulo "${name}" desactivado`,
    });
  };
}
