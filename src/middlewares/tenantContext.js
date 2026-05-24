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

/**
 * Ejecuta `fn` dentro de un contexto RLS programático.
 * Útil en handlers que no pasan por el middleware (auth/login) y que
 * necesitan setear app.empresa_id una vez identificada la empresa.
 *
 * Si RLS está desactivado, simplemente ejecuta `fn` sin reservar conexión.
 */
export async function withTenantContext({ empresaId, role = "admin", asesoriaId = null, userId = null }, fn) {
  if (!ENABLED || !empresaId) return fn();

  const reserved = await poolSql.reserve();
  try {
    await reserved`SELECT set_config('app.empresa_id', ${String(empresaId)}, false)`;
    await reserved`SELECT set_config('app.role', ${role}, false)`;
    if (asesoriaId) {
      await reserved`SELECT set_config('app.asesoria_id', ${String(asesoriaId)}, false)`;
    }
    // Forge request.jwt.claims so Supabase's auth.uid() returns the user UUID
    // when RLS policies are evaluated. The backend connects directly via
    // postgres.js (not via PostgREST), so auth.uid() would otherwise be NULL
    // and every policy using `(SELECT ... WHERE id = auth.uid())` would fail.
    if (userId) {
      await reserved`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: String(userId) })}, false)`;
    }
    return await new Promise((resolve, reject) => {
      tenantStorage.run(reserved, () => {
        Promise.resolve(fn()).then(resolve, reject);
      });
    });
  } finally {
    try { reserved.release(); } catch (e) { logger.warn("withTenantContext release failed", { message: e.message }); }
  }
}

export async function tenantContext(req, res, next) {
  if (!ENABLED) return next();

  // Preflight CORS no tiene auth — pasa sin contexto.
  if (req.method === "OPTIONS") return next();

  // Rutas sin tenant resuelto (auth bootstrap, public, kiosk pre-login)
  // no reservan conexión.
  if (!req.user?.empresa_id) return next();

  // Idempotente: si ya hay una conexión reservada para este request
  // (porque otra ruta encadenó tenantContext dos veces), no abrir otra.
  if (req._tenantContextActive) return next();
  req._tenantContextActive = true;

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

    // Forge request.jwt.claims so Supabase's auth.uid() returns the user UUID
    // when RLS policies are evaluated. The backend connects directly via
    // postgres.js (not via PostgREST), so auth.uid() would otherwise be NULL
    // and every policy using `(SELECT ... WHERE id = auth.uid())` would fail.
    if (req.user.id) {
      await reserved`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: String(req.user.id) })}, false)`;
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
