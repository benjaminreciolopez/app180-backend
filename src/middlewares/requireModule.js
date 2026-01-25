// backend/src/middlewares/requireModule.js

export function requireModule(name) {
  return (req, res, next) => {
    if (!req.user?.modulos?.[name]) {
      return res.status(403).json({
        error: `Módulo "${name}" desactivado`,
      });
    }

    next();
  };
}
