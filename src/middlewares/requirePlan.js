import { sql } from "../db.js";

/**
 * Middleware que verifica si la empresa tiene acceso a un módulo según su plan.
 * Empresas VIP bypasean todas las restricciones.
 */
export function requirePlanModule(moduleName) {
  return async (req, res, next) => {
    try {
      const empresaId = req.user?.empresa_id;
      if (!empresaId) return res.status(401).json({ error: "No autenticado" });

      const [empresa] = await sql`
        SELECT e.es_vip, e.plan_status, p.modulos_incluidos
        FROM empresa_180 e
        LEFT JOIN plans_180 p ON e.plan_id = p.id
        WHERE e.id = ${empresaId}
      `;

      if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });

      // VIP bypass
      if (empresa.es_vip) return next();

      // Plan expirado o impago
      if (empresa.plan_status === "past_due") {
        return res.status(402).json({
          error: "Tu suscripción tiene un pago pendiente. Actualiza tu método de pago.",
          code: "PAYMENT_REQUIRED",
        });
      }

      // Verificar módulo en plan
      const modulos = empresa.modulos_incluidos || {};
      if (modulos[moduleName] === false) {
        return res.status(403).json({
          error: `El módulo "${moduleName}" no está incluido en tu plan. Mejora tu plan para acceder.`,
          code: "PLAN_UPGRADE_REQUIRED",
          module: moduleName,
        });
      }

      next();
    } catch (err) {
      console.error("Error requirePlanModule:", err.message);
      next(); // En caso de error, permitir acceso (fail-open para no bloquear)
    }
  };
}

/**
 * Middleware que verifica límites de uso (clientes, facturas, gastos, etc.)
 * @param {string} resource - "clientes" | "facturas" | "gastos" | "ocr" | "ai"
 */
export function requirePlanLimit(resource) {
  return async (req, res, next) => {
    try {
      const empresaId = req.user?.empresa_id;
      if (!empresaId) return res.status(401).json({ error: "No autenticado" });

      const [empresa] = await sql`
        SELECT e.es_vip, p.max_clientes, p.max_facturas_mes, p.max_gastos_mes,
               p.max_ocr_mes, p.max_ai_mensajes_mes
        FROM empresa_180 e
        LEFT JOIN plans_180 p ON e.plan_id = p.id
        WHERE e.id = ${empresaId}
      `;

      if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });

      // VIP bypass
      if (empresa.es_vip) return next();

      let currentCount = 0;
      let maxAllowed = null;

      switch (resource) {
        case "clientes": {
          maxAllowed = empresa.max_clientes;
          if (maxAllowed !== null) {
            const [{ count }] = await sql`
              SELECT COUNT(*)::int AS count FROM clients_180
              WHERE empresa_id = ${empresaId} AND activo = true
            `;
            currentCount = count;
          }
          break;
        }
        case "facturas": {
          maxAllowed = empresa.max_facturas_mes;
          if (maxAllowed !== null) {
            const [{ count }] = await sql`
              SELECT COUNT(*)::int AS count FROM factura_180
              WHERE empresa_id = ${empresaId}
              AND date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)
            `;
            currentCount = count;
          }
          break;
        }
        case "gastos": {
          maxAllowed = empresa.max_gastos_mes;
          if (maxAllowed !== null) {
            const [{ count }] = await sql`
              SELECT COUNT(*)::int AS count FROM purchases_180
              WHERE empresa_id = ${empresaId}
              AND date_trunc('month', fecha_compra) = date_trunc('month', CURRENT_DATE)
            `;
            currentCount = count;
          }
          break;
        }
        case "ocr": {
          maxAllowed = empresa.max_ocr_mes;
          if (maxAllowed !== null) {
            // Contamos gastos con documento_url (indican OCR usado)
            const [{ count }] = await sql`
              SELECT COUNT(*)::int AS count FROM purchases_180
              WHERE empresa_id = ${empresaId}
              AND documento_url IS NOT NULL
              AND date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)
            `;
            currentCount = count;
          }
          break;
        }
        case "ai": {
          maxAllowed = empresa.max_ai_mensajes_mes;
          if (maxAllowed !== null) {
            const [{ count }] = await sql`
              SELECT COUNT(*)::int AS count FROM contendo_memory_180
              WHERE empresa_id = ${empresaId}
              AND role = 'user'
              AND date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)
            `;
            currentCount = count;
          }
          break;
        }
      }

      // NULL = ilimitado
      if (maxAllowed !== null && currentCount >= maxAllowed) {
        return res.status(402).json({
          error: `Has alcanzado el límite de ${maxAllowed} ${resource} en tu plan. Mejora tu plan para continuar.`,
          code: "PLAN_LIMIT_REACHED",
          resource,
          current: currentCount,
          max: maxAllowed,
        });
      }

      next();
    } catch (err) {
      console.error("Error requirePlanLimit:", err.message);
      next(); // Fail-open
    }
  };
}
