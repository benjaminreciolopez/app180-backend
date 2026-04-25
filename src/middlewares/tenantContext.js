// backend/src/middlewares/tenantContext.js
//
// RLS Phase 1 — variante AsyncLocalStorage.
//
// Reserva una conexión del pool postgres durante toda la vida del request,
// fija `app.empresa_id` / `app.role` / `app.asesoria_id` como configuración
// de sesión, y publica esa conexión en un AsyncLocalStorage que `db.js`
// inspecciona desde su proxy `sql`. De este modo cualquier `import { sql }`
// existente queda tenant-aware automáticamente — sin tocar controllers.
//
// Gated tras RLS_TENANT_CONTEXT_ENABLED para poder desplegar inerte.
//
// Ver backend/docs/RLS_DESIGN.md para el plan completo.

import { poolSql, tenantStorage } from "../db.js";
import logger from "../utils/logger.js";

const ENABLED = process.env.RLS_TENANT_CONTEXT_ENABLED === "true";

export async function tenantContext(req, res, next) {
  if (!ENABLED) return next();

  // Preflight CORS no tiene auth — pasa sin contexto.
  if (req.method === "OPTIONS") return next();

  // Rutas sin tenant resuelto (auth bootstrap, public, kiosk pre-login)
  // no reservan conexión.
  if (!req.user?.empresa_id) return next();

  let reserved;
  let released = false;
  const release = () => {
    if (released || !reserved) return;
    released = true;
    try {
      reserved.release();
    } catch (e) {
      logger.warn("tenantContext release failed", { message: e.message });
    }
  };

  try {
    reserved = await poolSql.reserve();

    const empresaId = String(req.user.empresa_id);
    const role = req.user.role || "admin";

    // set_config(_, _, false) = sesión (no transacción).
    // Persiste durante la vida de esta conexión reservada.
    await reserved`SELECT set_config('app.empresa_id', ${empresaId}, false)`;
    await reserved`SELECT set_config('app.role', ${role}, false)`;

    if (req.user.asesoria_id) {
      await reserved`SELECT set_config('app.asesoria_id', ${String(req.user.asesoria_id)}, false)`;
    }

    res.on("finish", release);
    res.on("close", release);

    // Ejecuta el resto del pipeline dentro del contexto ALS — el proxy `sql`
    // de db.js leerá `reserved` desde tenantStorage.getStore().
    tenantStorage.run(reserved, () => next());
  } catch (err) {
    release();
    logger.error("tenantContext setup failed", {
      message: err.message,
      empresa_id: req.user?.empresa_id,
      path: req.originalUrl,
    });
    return next(err);
  }
}
