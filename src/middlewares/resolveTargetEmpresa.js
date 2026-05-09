// backend/src/middlewares/resolveTargetEmpresa.js
//
// Middleware que resuelve la empresa_id objetivo para una request, soportando
// que el frontend mande la empresa explícita por query/params/body (no sólo
// vía header X-Empresa-Id, que ya gestiona authMiddleware).
//
// Modos:
//   - Despacho propio del asesor → usa req.user.empresa_id (su asesoría)
//   - Cliente gestionado del asesor → usa empresa_id explícito, valida vínculo
//     en asesoria_clientes_180 y permisos granulares
//   - Admin (autónomo) → sólo su propia empresa
//
// IMPORTANTE — RLS: si tenantContext ya reservó conexión con
// app.empresa_id = req.user.empresa_id (la previa), aquí debemos:
//   1. Sobreescribir req.user.empresa_id con el target (para que cualquier
//      controller que lea req.user.empresa_id siga viendo la correcta).
//   2. Resetear el GUC app.empresa_id en la conexión reservada para que las
//      RLS filtren por la empresa correcta (no por la del JWT).
//
// Sin (2) las queries devolverían filas vacías o RLS bloquearía writes,
// generando warnings/errores en Supabase.

import { sql, tenantStorage } from "../db.js";

const RLS_ENABLED = process.env.RLS_TENANT_CONTEXT_ENABLED === "true";

/**
 * @param {object} [opts]
 * @param {string} [opts.permission] - clave de permisos (ej. "contabilidad", "fiscal", "facturas").
 *   Si se pasa y el target es un cliente del asesor, se valida que tenga ese permiso.
 * @param {"read"|"write"} [opts.access="read"]
 */
export function resolveTargetEmpresa(opts = {}) {
  const { permission = null, access = "read" } = opts;

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "No autenticado" });
      }

      const requested =
        req.params.empresa_id ||
        req.query.empresa_id ||
        req.body?.empresa_id ||
        null;

      const userEmpresaId = req.user.empresa_id || null;
      const role = req.user.role;
      const originalRole = req.user.originalRole;
      const isAsesor = role === "asesor" || originalRole === "asesor";

      // ─────────────────────────────────────────────────────────
      // Caso 1: no se ha pedido empresa explícita → usar la del user.
      // No tocamos nada (RLS ya está bien configurada por tenantContext).
      // ─────────────────────────────────────────────────────────
      if (!requested) {
        if (!userEmpresaId) {
          return res.status(400).json({
            error:
              "No hay empresa objetivo. Pasa empresa_id en la query o asegúrate de que tu usuario tenga empresa asignada.",
          });
        }
        req.targetEmpresaId = userEmpresaId;
        req.targetContext = isAsesor ? "despacho_propio" : "empresa_propia";
        return next();
      }

      // ─────────────────────────────────────────────────────────
      // Caso 2: la empresa pedida coincide con la del user → no-op.
      // ─────────────────────────────────────────────────────────
      if (requested === userEmpresaId) {
        req.targetEmpresaId = requested;
        req.targetContext = isAsesor ? "despacho_propio" : "empresa_propia";
        return next();
      }

      // ─────────────────────────────────────────────────────────
      // Caso 3: admin pidiendo otra empresa → prohibido.
      // ─────────────────────────────────────────────────────────
      if (!isAsesor) {
        return res.status(403).json({ error: "Sin acceso a esta empresa" });
      }

      // ─────────────────────────────────────────────────────────
      // Caso 4: asesor pidiendo empresa de cliente → validar.
      // ─────────────────────────────────────────────────────────
      const asesoriaId = req.user.asesoria_id;
      if (!asesoriaId) {
        return res.status(403).json({ error: "Asesor sin asesoría asignada" });
      }

      let permisos = {};
      let isOwn = false;

      const rows = await sql`
        SELECT permisos
        FROM asesoria_clientes_180
        WHERE asesoria_id = ${asesoriaId}
          AND empresa_id = ${requested}
          AND estado = 'activo'
        LIMIT 1
      `;

      if (rows.length === 0) {
        // Puede ser la propia empresa de la asesoría (no entró por userEmpresaId
        // si el JWT no la tenía).
        const [asesoria] = await sql`
          SELECT empresa_id FROM asesorias_180 WHERE id = ${asesoriaId}
        `;
        if (asesoria?.empresa_id !== requested) {
          return res.status(403).json({ error: "Sin acceso a esta empresa" });
        }
        isOwn = true;
      } else {
        permisos = rows[0].permisos || {};
      }

      // Validar permiso granular si se pidió y no es la propia empresa.
      if (permission && !isOwn) {
        const seccion = permisos[permission];
        if (!seccion || !seccion[access]) {
          return res.status(403).json({
            error: `Sin permiso de ${access} para ${permission} en este cliente`,
          });
        }
      }

      // ─────────────────────────────────────────────────────────
      // Sincronizar req.user y la GUC de RLS con la empresa objetivo.
      // ─────────────────────────────────────────────────────────
      req.user.empresa_id = requested;
      req.user.isAsesorContext = !isOwn;
      req.user.asesorPermisos = permisos;

      req.targetEmpresaId = requested;
      req.targetContext = isOwn ? "despacho_propio" : "cliente";
      req.asesorPermisos = permisos;

      if (RLS_ENABLED) {
        const reserved = tenantStorage.getStore();
        if (reserved) {
          // tenantContext ya nos reservó la conexión y fijó app.empresa_id.
          // Repetimos set_config con la nueva empresa para que RLS filtre por
          // la correcta. Importante: no retornamos antes — esto debe
          // completarse antes de que el controller ejecute SQL.
          await reserved`SELECT set_config('app.empresa_id', ${String(requested)}, false)`;
        }
      }

      return next();
    } catch (err) {
      console.error("resolveTargetEmpresa error:", err);
      return res.status(500).json({ error: "Error resolviendo empresa objetivo" });
    }
  };
}
