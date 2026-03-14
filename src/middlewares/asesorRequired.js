// backend/src/middlewares/asesorRequired.js
// Middleware que valida que un asesor tiene vinculo activo con la empresa objetivo
// y comprueba permisos granulares por seccion

import { sql } from "../db.js";

/**
 * Valida que el asesor tiene acceso a la empresa especificada en req.params.empresa_id
 * y opcionalmente comprueba un permiso especifico.
 *
 * @param {string|null} permissionKey - Clave de permiso a verificar (ej: 'facturas', 'fiscal', 'nominas')
 * @param {string} accessType - Tipo de acceso requerido: 'read' o 'write' (default: 'read')
 */
export function asesorClienteRequired(permissionKey = null, accessType = "read") {
  return async (req, res, next) => {
    try {
      if (!req.user || (req.user.role !== "asesor" && req.user.originalRole !== "asesor")) {
        return res.status(403).json({ error: "Acceso solo para asesores" });
      }

      // Restaurar role original si fue elevado por authMiddleware
      if (req.user.originalRole === "asesor" && req.user.role === "admin") {
        req.user.role = "asesor";
      }

      const empresaId = req.params.empresa_id || req.query.empresa_id;
      if (!empresaId) {
        return res.status(400).json({ error: "empresa_id requerido" });
      }

      const asesoriaId = req.user.asesoria_id;
      if (!asesoriaId) {
        return res.status(403).json({ error: "Asesor sin asesoría asignada" });
      }

      // Verificar vinculo activo entre asesoria y empresa
      const rows = await sql`
        SELECT permisos
        FROM asesoria_clientes_180
        WHERE asesoria_id = ${asesoriaId}
          AND empresa_id = ${empresaId}
          AND estado = 'activo'
        LIMIT 1
      `;

      if (rows.length === 0) {
        return res.status(403).json({ error: "Sin acceso a esta empresa" });
      }

      const permisos = rows[0].permisos || {};

      // Comprobar permiso especifico si se requiere
      if (permissionKey) {
        const seccionPermisos = permisos[permissionKey];
        if (!seccionPermisos || !seccionPermisos[accessType]) {
          return res.status(403).json({
            error: `Sin permiso de ${accessType} para ${permissionKey}`,
          });
        }
      }

      // Adjuntar al request para uso en controladores
      req.asesorPermisos = permisos;
      req.targetEmpresaId = empresaId;

      next();
    } catch (err) {
      console.error("❌ asesorClienteRequired error:", err);
      return res.status(500).json({ error: "Error verificando permisos de asesor" });
    }
  };
}
