// backend/src/controllers/asesoriaController.js
// Dashboard and client management for the asesor portal
import { sql } from "../db.js";
import { ensureAutonomoOwnerEmployee } from "../services/autonomoOwnerService.js";

/**
 * GET /asesor/dashboard
 * Returns summary of all linked clients for the authenticated asesor:
 * - count of active clients
 * - pending invitations
 * - unread messages total
 * - per-client details: empresa_id, nombre, ultimo_acceso, facturas_pendientes, alertas
 */
export async function getDashboard(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;

    // Count active clients
    const [activeCount] = await sql`
      SELECT COUNT(*)::int AS total
      FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoriaId}
        AND estado = 'activo'
    `;

    // Count pending invitations (both directions)
    const [pendingCount] = await sql`
      SELECT COUNT(*)::int AS total
      FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoriaId}
        AND estado = 'pendiente'
    `;

    // Count total unread messages across all clients (messages sent TO the asesor)
    const [unreadCount] = await sql`
      SELECT COUNT(*)::int AS total
      FROM asesoria_mensajes_180
      WHERE asesoria_id = ${asesoriaId}
        AND autor_tipo != 'asesor'
        AND leido = false
    `;

    // Per-client details for active clients
    const clientes = await sql`
      SELECT
        ac.empresa_id,
        e.nombre,
        (
          SELECT MAX(m.created_at)
          FROM asesoria_mensajes_180 m
          WHERE m.asesoria_id = ${asesoriaId}
            AND m.empresa_id = ac.empresa_id
        ) AS ultimo_acceso,
        (
          SELECT COUNT(*)::int
          FROM factura_180 f
          WHERE f.empresa_id = ac.empresa_id
            AND f.estado = 'BORRADOR'
        ) AS facturas_pendientes,
        (
          SELECT COUNT(*)::int
          FROM asesoria_mensajes_180 m
          WHERE m.asesoria_id = ${asesoriaId}
            AND m.empresa_id = ac.empresa_id
            AND m.autor_tipo != 'asesor'
            AND m.leido = false
        ) AS alertas
      FROM asesoria_clientes_180 ac
      JOIN empresa_180 e ON e.id = ac.empresa_id
      WHERE ac.asesoria_id = ${asesoriaId}
        AND ac.estado = 'activo'
      ORDER BY e.nombre ASC
    `;

    return res.json({
      success: true,
      data: {
        clientes_activos: activeCount.total,
        invitaciones_pendientes: pendingCount.total,
        mensajes_no_leidos: unreadCount.total,
        clientes,
      },
    });
  } catch (err) {
    console.error("Error getDashboard (asesoria):", err);
    return res.status(500).json({ error: "Error obteniendo dashboard de asesoría" });
  }
}

/**
 * GET /asesor/clientes
 * List all clients linked to this asesoria
 */
export async function getClientes(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;

    // Get the asesoria's own empresa_id
    const [asesoria] = await sql`
      SELECT empresa_id FROM asesorias_180 WHERE id = ${asesoriaId}
    `;
    const ownEmpresaId = asesoria?.empresa_id;

    // Get the asesoria's own empresa details (prepended with es_propia: true)
    let empresaPropia = null;
    if (ownEmpresaId) {
      const [ep] = await sql`
        SELECT
          e.id AS empresa_id,
          e.nombre,
          e.tipo_contribuyente,
          (
            SELECT u.email
            FROM users_180 u
            WHERE u.id = e.user_id
            LIMIT 1
          ) AS email
        FROM empresa_180 e
        WHERE e.id = ${ownEmpresaId}
      `;
      if (ep) {
        empresaPropia = {
          vinculo_id: null,
          empresa_id: ep.empresa_id,
          nombre: ep.nombre,
          tipo_contribuyente: ep.tipo_contribuyente,
          estado: 'activo',
          invitado_por: null,
          permisos: null,
          connected_at: null,
          created_at: null,
          email: ep.email,
          es_propia: true,
        };
      }
    }

    // Get client empresas (incluye gestionadas sin app: e.user_id IS NULL)
    const clientes = await sql`
      SELECT
        ac.id AS vinculo_id,
        ac.empresa_id,
        e.nombre,
        e.tipo_contribuyente,
        e.gestionada_por_asesoria_id,
        e.user_id AS empresa_user_id,
        ac.estado,
        ac.invitado_por,
        ac.permisos,
        ac.connected_at,
        ac.created_at,
        (
          SELECT u.email
          FROM users_180 u
          WHERE u.id = e.user_id
          LIMIT 1
        ) AS email
      FROM asesoria_clientes_180 ac
      JOIN empresa_180 e ON e.id = ac.empresa_id
      WHERE ac.asesoria_id = ${asesoriaId}
      ORDER BY ac.estado ASC, e.nombre ASC
    `;

    const clientesConFlag = clientes.map((c) => ({
      ...c,
      es_propia: false,
      gestionada: c.gestionada_por_asesoria_id === asesoriaId || c.empresa_user_id === null,
    }));
    const data = empresaPropia ? [empresaPropia, ...clientesConFlag] : clientesConFlag;

    return res.json({ success: true, data });
  } catch (err) {
    console.error("Error getClientes (asesoria):", err);
    return res.status(500).json({ error: "Error obteniendo clientes" });
  }
}

/**
 * GET /asesor/clientes/:empresa_id/resumen
 * Quick summary for one client
 */
export async function getClienteResumen(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const empresaId = req.params.empresa_id;

    // Validate asesor has active link to this empresa
    const vinculo = await sql`
      SELECT permisos FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoriaId}
        AND empresa_id = ${empresaId}
        AND estado = 'activo'
      LIMIT 1
    `;
    if (vinculo.length === 0) return res.status(403).json({ error: "Sin acceso" });

    const currentYear = new Date().getFullYear();

    // Get empresa name and tipo_contribuyente
    const [empresa] = await sql`
      SELECT nombre, tipo_contribuyente FROM empresa_180
      WHERE id = ${empresaId}
      LIMIT 1
    `;

    // Total facturas emitidas this year (solo validas, sin test ni proformas)
    const [facturasEmitidas] = await sql`
      SELECT COUNT(*)::int AS total, COALESCE(SUM(total), 0)::numeric AS importe
      FROM factura_180
      WHERE empresa_id = ${empresaId}
        AND (es_test IS NOT TRUE)
        AND (tipo_factura IS NULL OR tipo_factura = 'NORMAL')
        AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND EXTRACT(YEAR FROM fecha) = ${currentYear}
    `;

    // Total gastos this year
    const [gastos] = await sql`
      SELECT COUNT(*)::int AS total, COALESCE(SUM(total), 0)::numeric AS importe
      FROM purchases_180
      WHERE empresa_id = ${empresaId}
        AND activo = true
        AND EXTRACT(YEAR FROM fecha_compra) = ${currentYear}
    `;

    await ensureAutonomoOwnerEmployee(empresaId);

    // Total empleados activos
    const [empleados] = await sql`
      SELECT COUNT(*)::int AS total
      FROM employees_180
      WHERE empresa_id = ${empresaId}
        AND activo = true
    `;

    // Ultimo modelo fiscal generado
    const ultimoModelo = await sql`
      SELECT modelo, trimestre, anio, created_at
      FROM modelos_fiscales_180
      WHERE empresa_id = ${empresaId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    return res.json({
      success: true,
      data: {
        nombre: empresa?.nombre || null,
        tipo_contribuyente: empresa?.tipo_contribuyente || null,
        facturas_emitidas: {
          total: facturasEmitidas.total,
          importe: parseFloat(facturasEmitidas.importe),
        },
        gastos: {
          total: gastos.total,
          importe: parseFloat(gastos.importe),
        },
        empleados_activos: empleados.total,
        ultimo_modelo_fiscal: ultimoModelo[0] || null,
        permisos: vinculo[0].permisos,
        anio: currentYear,
      },
    });
  } catch (err) {
    console.error("Error getClienteResumen (asesoria):", err);
    return res.status(500).json({ error: "Error obteniendo resumen del cliente" });
  }
}

/**
 * GET /asesor/configuracion
 * Returns asesoria details for the settings page
 */
export async function getConfiguracion(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;

    const [asesoria] = await sql`
      SELECT id, nombre, cif, email_contacto, telefono, direccion, logo_url, plan, max_clientes, activo, created_at, modulos, modulos_mobile
      FROM asesorias_180
      WHERE id = ${asesoriaId}
    `;

    if (!asesoria) {
      return res.status(404).json({ error: "Asesoría no encontrada" });
    }

    // Count current clients
    const [clientCount] = await sql`
      SELECT COUNT(*)::int AS total
      FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoriaId}
        AND estado = 'activo'
    `;

    // List team members
    const miembros = await sql`
      SELECT au.id, au.rol_interno, au.activo, au.created_at,
             u.nombre, u.email
      FROM asesoria_usuarios_180 au
      JOIN users_180 u ON u.id = au.user_id
      WHERE au.asesoria_id = ${asesoriaId}
      ORDER BY au.created_at
    `;

    return res.json({
      success: true,
      data: {
        ...asesoria,
        clientes_activos: clientCount.total,
        miembros,
      },
    });
  } catch (err) {
    console.error("Error getConfiguracion (asesoria):", err);
    return res.status(500).json({ error: "Error obteniendo configuración" });
  }
}

/**
 * GET /asesor/configuracion/widgets
 * Returns saved dashboard widget config for this asesoria
 */
export async function getDashboardWidgets(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const [row] = await sql`
      SELECT dashboard_widgets, dashboard_widgets_mobile FROM asesorias_180 WHERE id = ${asesoriaId}
    `;
    if (!row) return res.status(404).json({ error: "Asesoría no encontrada" });

    let widgets = row.dashboard_widgets || [];
    let widgets_mobile = row.dashboard_widgets_mobile || [];
    // Handle double-encoded JSON
    if (typeof widgets === "string") {
      try { widgets = JSON.parse(widgets); } catch { widgets = []; }
    }
    if (typeof widgets_mobile === "string") {
      try { widgets_mobile = JSON.parse(widgets_mobile); } catch { widgets_mobile = []; }
    }

    return res.json({ success: true, widgets, widgets_mobile });
  } catch (err) {
    console.error("Error getDashboardWidgets (asesoria):", err);
    return res.status(500).json({ error: "Error obteniendo widgets" });
  }
}

/**
 * PUT /asesor/configuracion/widgets
 * Save dashboard widget config for this asesoria
 * Accepts { widgets, widgets_mobile } independently
 */
export async function updateDashboardWidgets(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const { widgets, widgets_mobile } = req.body;

    if (widgets !== undefined && !Array.isArray(widgets)) {
      return res.status(400).json({ error: "widgets debe ser un array" });
    }
    if (widgets_mobile !== undefined && !Array.isArray(widgets_mobile)) {
      return res.status(400).json({ error: "widgets_mobile debe ser un array" });
    }

    // Build dynamic update — use sql.json() to avoid double-encoding JSONB
    if (widgets !== undefined && widgets_mobile !== undefined) {
      await sql`
        UPDATE asesorias_180
        SET dashboard_widgets = ${sql.json(widgets)},
            dashboard_widgets_mobile = ${sql.json(widgets_mobile)},
            updated_at = now()
        WHERE id = ${asesoriaId}
      `;
    } else if (widgets !== undefined) {
      await sql`
        UPDATE asesorias_180
        SET dashboard_widgets = ${sql.json(widgets)},
            updated_at = now()
        WHERE id = ${asesoriaId}
      `;
    } else if (widgets_mobile !== undefined) {
      await sql`
        UPDATE asesorias_180
        SET dashboard_widgets_mobile = ${sql.json(widgets_mobile)},
            updated_at = now()
        WHERE id = ${asesoriaId}
      `;
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Error updateDashboardWidgets (asesoria):", err);
    return res.status(500).json({ error: "Error guardando widgets" });
  }
}

/**
 * PUT /asesor/configuracion
 * Update asesoria details
 */
export async function updateConfiguracion(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const { nombre, cif, email_contacto, telefono, direccion } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: "El nombre es obligatorio" });
    }

    const [updated] = await sql`
      UPDATE asesorias_180
      SET
        nombre = ${nombre.trim()},
        cif = ${cif || null},
        email_contacto = ${email_contacto?.trim() || null},
        telefono = ${telefono || null},
        direccion = ${direccion || null},
        updated_at = now()
      WHERE id = ${asesoriaId}
      RETURNING id, nombre, cif, email_contacto, telefono, direccion
    `;

    if (!updated) {
      return res.status(404).json({ error: "Asesoría no encontrada" });
    }

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Error updateConfiguracion (asesoria):", err);
    return res.status(500).json({ error: "Error actualizando configuración" });
  }
}

/**
 * PUT /asesor/configuracion/modulos-mobile
 * Define the subset of modules visible in the asesor PWA mobile shell.
 * Pass `null` (or omit) to disable the override and use full `modulos`.
 */
export async function updateModulosMobile(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const { modulos_mobile } = req.body;

    if (modulos_mobile !== null && (typeof modulos_mobile !== "object" || Array.isArray(modulos_mobile))) {
      return res.status(400).json({ error: "modulos_mobile debe ser un objeto o null" });
    }

    let sanitized = null;
    if (modulos_mobile && typeof modulos_mobile === "object") {
      const ALLOWED = ["empleados", "fichajes", "calendario", "clientes", "facturacion", "fiscal", "pagos", "worklogs", "contable"];
      sanitized = {};
      for (const key of ALLOWED) {
        if (key in modulos_mobile) sanitized[key] = !!modulos_mobile[key];
      }
    }

    await sql`
      UPDATE asesorias_180
      SET modulos_mobile = ${sanitized === null ? null : sql.json(sanitized)},
          updated_at = now()
      WHERE id = ${asesoriaId}
    `;

    return res.json({ success: true, data: { modulos_mobile: sanitized } });
  } catch (err) {
    console.error("Error updateModulosMobile (asesoria):", err);
    return res.status(500).json({ error: "Error guardando módulos móvil" });
  }
}

/**
 * PUT /asesor/clientes/:empresa_id/tipo-contribuyente
 * Allows asesor to set the tipo_contribuyente of a linked client
 */
export async function updateClienteTipoContribuyente(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const empresaId = req.params.empresa_id;
    const { tipo_contribuyente } = req.body;

    if (!["autonomo", "sociedad"].includes(tipo_contribuyente)) {
      return res.status(400).json({ error: "Tipo invalido. Usa 'autonomo' o 'sociedad'." });
    }

    // Validate asesor has active link
    const vinculo = await sql`
      SELECT id FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoriaId}
        AND empresa_id = ${empresaId}
        AND estado = 'activo'
      LIMIT 1
    `;
    if (vinculo.length === 0) return res.status(403).json({ error: "Sin acceso" });

    await sql`
      UPDATE empresa_180
      SET tipo_contribuyente = ${tipo_contribuyente}
      WHERE id = ${empresaId}
    `;

    return res.json({ success: true, tipo_contribuyente });
  } catch (err) {
    console.error("Error updateClienteTipoContribuyente:", err);
    return res.status(500).json({ error: "Error actualizando tipo de contribuyente" });
  }
}

/**
 * PUT /asesor/clientes/:empresa_id/permisos
 * Asesor updates the delegated permissions matrix for a specific client.
 * Body: { permisos: { fiscal:{read,write}, gastos:{...}, nominas:{...}, facturas:{...}, contabilidad:{...}, documentos:{read,upload} } }
 *
 * Semantically, write:true on an area means "the asesoría handles this area on behalf of the empresa",
 * which the empresa-side UI reads to lock/hide the corresponding module toggles.
 */
export async function updateClientePermisos(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const empresaId = req.params.empresa_id;
    const { permisos } = req.body;

    if (!permisos || typeof permisos !== "object" || Array.isArray(permisos)) {
      return res.status(400).json({ error: "Permisos requeridos (objeto JSON)" });
    }

    const ALLOWED_KEYS = ["fiscal", "gastos", "nominas", "facturas", "contabilidad", "documentos", "empleados", "configuracion", "clientes"];
    const sanitized = {};
    for (const [key, value] of Object.entries(permisos)) {
      if (!ALLOWED_KEYS.includes(key)) continue;
      if (!value || typeof value !== "object") continue;
      const entry = {};
      if (typeof value.read === "boolean") entry.read = value.read;
      if (typeof value.write === "boolean") entry.write = value.write;
      if (typeof value.upload === "boolean") entry.upload = value.upload;
      sanitized[key] = entry;
    }

    const [updated] = await sql`
      UPDATE asesoria_clientes_180
      SET permisos = ${sql.json(sanitized)}
      WHERE asesoria_id = ${asesoriaId}
        AND empresa_id = ${empresaId}
        AND estado = 'activo'
      RETURNING id, permisos
    `;

    if (!updated) {
      return res.status(404).json({ error: "Sin vínculo activo con esa empresa" });
    }

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Error updateClientePermisos:", err);
    return res.status(500).json({ error: "Error actualizando permisos del cliente" });
  }
}
