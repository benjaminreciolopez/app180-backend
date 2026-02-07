import { sql } from "../db.js";

const DEFAULT_MODULOS = {
  clientes: true,
  fichajes: true,
  calendario: true,
  calendario_import: true,
  worklogs: true,
  empleados: true,
  facturacion: false,
  pagos: false,  // Cobros y Pagos independiente de Facturación
};

/**
 * GET /admin/configuracion
 */
export async function getEmpresaConfig(req, res) {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const empresaId = req.user.empresa_id;

    if (!empresaId) {
      return res.status(403).json({ error: "Empresa no asociada" });
    }

    let rows = await sql`
      SELECT modulos, modulos_mobile
      FROM empresa_config_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    // Autocrear si no existe
    if (rows.length === 0) {
      await sql`
        INSERT INTO empresa_config_180 (empresa_id, modulos, modulos_mobile)
        VALUES (${empresaId}, ${DEFAULT_MODULOS}::jsonb, NULL)
        ON CONFLICT (empresa_id) DO NOTHING
      `;

      rows = await sql`
        SELECT modulos, modulos_mobile
        FROM empresa_config_180
        WHERE empresa_id = ${empresaId}
        LIMIT 1
      `;
    }

    const stored = rows[0]?.modulos || {};
    const mobile = rows[0]?.modulos_mobile || null;

    return res.json({
      ...DEFAULT_MODULOS,
      ...stored,
      modulos_mobile: mobile
    });
  } catch (err) {
    console.error("❌ getEmpresaConfig:", err);
    res.status(500).json({ error: "Error obteniendo configuración" });
  }
}

/**
 * PUT /admin/configuracion
 */
export async function updateEmpresaConfig(req, res) {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const empresaId = req.user.empresa_id;

    if (!empresaId) {
      return res.status(403).json({ error: "Empresa no asociada" });
    }

    const input = req.body.modulos;
    const inputMobile = req.body.modulos_mobile; // puede ser null o objeto

    if (!input || typeof input !== "object") {
      return res.status(400).json({ error: "Formato inválido" });
    }

    const safeModulos = {
      clientes: !!input.clientes,
      fichajes: !!input.fichajes,
      calendario: !!input.calendario,
      calendario_import: !!input.calendario_import,
      worklogs: !!input.worklogs,
      empleados: !!input.empleados,
      facturacion: !!input.facturacion,
      pagos: !!input.pagos,
    };

    // Validar safeMobile solo si viene definido
    let safeMobile = null;
    if (inputMobile && typeof inputMobile === 'object') {
      safeMobile = {
        clientes: !!inputMobile.clientes,
        fichajes: !!inputMobile.fichajes,
        calendario: !!inputMobile.calendario,
        calendario_import: !!inputMobile.calendario_import,
        worklogs: !!inputMobile.worklogs,
        empleados: !!inputMobile.empleados,
        facturacion: !!inputMobile.facturacion,
        pagos: !!inputMobile.pagos,
      };
    }

    await sql`
      INSERT INTO empresa_config_180 (empresa_id, modulos, modulos_mobile)
      VALUES (${empresaId}, ${safeModulos}::jsonb, ${safeMobile}::jsonb)
      ON CONFLICT (empresa_id)
      DO UPDATE SET 
        modulos = EXCLUDED.modulos,
        modulos_mobile = EXCLUDED.modulos_mobile
    `;

    return res.json({
      success: true,
      modulos: safeModulos,
      modulos_mobile: safeMobile
    });
  } catch (err) {
    console.error("❌ updateEmpresaConfig:", err);
    res.status(500).json({ error: "Error guardando configuración" });
  }
}

/**
 * GET /admin/configuracion/widgets
 */
export async function getDashboardWidgets(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    if (!empresaId) return res.status(403).json({ error: "No empresa" });

    const rows = await sql`
      SELECT dashboard_widgets
      FROM empresa_config_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    const widgets = rows[0]?.dashboard_widgets || [];
    console.log(`📊 [getDashboardWidgets] Empresa: ${empresaId}, Widgets: ${JSON.stringify(widgets)}, Row exists: ${!!rows[0]}`);

    return res.json({ widgets });
  } catch (err) {
    console.error("❌ getDashboardWidgets:", err);
    res.status(500).json({ error: "Error obteniendo widgets" });
  }
}

/**
 * PUT /admin/configuracion/widgets
 */
export async function updateDashboardWidgets(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    if (!empresaId) return res.status(403).json({ error: "No empresa" });

    const { widgets } = req.body;
    if (!Array.isArray(widgets)) {
      return res.status(400).json({ error: "Formato inválido" });
    }

    // UPSERT: Insertar si no existe, actualizar si existe
    await sql`
      INSERT INTO empresa_config_180 (empresa_id, dashboard_widgets)
      VALUES (${empresaId}, ${JSON.stringify(widgets)}::jsonb)
      ON CONFLICT (empresa_id)
      DO UPDATE SET
        dashboard_widgets = EXCLUDED.dashboard_widgets,
        updated_at = NOW()
    `;

    console.log(`✅ Widgets guardados para empresa: ${empresaId}, Total: ${widgets.length}`);
    return res.json({ success: true, widgets });
  } catch (err) {
    console.error("❌ updateDashboardWidgets:", err);
    res.status(500).json({ error: "Error guardando widgets" });
  }
}
