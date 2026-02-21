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
      SELECT modulos, modulos_mobile, ai_tokens, user_id as creator_id
      FROM empresa_config_180 c
      JOIN empresa_180 e ON c.empresa_id = e.id
      WHERE c.empresa_id = ${empresaId}
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
      modulos_mobile: mobile,
      ai_tokens: rows[0]?.ai_tokens || 0,
      es_creador: rows[0]?.creator_id === req.user.id
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
        modulos_mobile = EXCLUDED.modulos_mobile,
        updated_at = now()
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
      SELECT dashboard_widgets, dashboard_widgets_mobile
      FROM empresa_config_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    let widgets = rows[0]?.dashboard_widgets || [];
    let widgets_mobile = rows[0]?.dashboard_widgets_mobile || [];

    // Fix: Si se guardó como string JSON dentro de JSONB (doble codificación), parsear.
    const parseWidgets = (w) => {
      if (typeof w === 'string') {
        try {
          return JSON.parse(w);
        } catch (e) {
          console.error("Error parsing widgets JSON", e);
          return [];
        }
      }
      return Array.isArray(w) ? w : [];
    };

    widgets = parseWidgets(widgets);
    widgets_mobile = parseWidgets(widgets_mobile);

    console.log(`📊 [getDashboardWidgets] Empresa: ${empresaId}, Desktop: ${widgets.length}, Mobile: ${widgets_mobile.length}`);

    return res.json({ widgets, widgets_mobile });
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

    const { widgets, widgets_mobile } = req.body;

    // Si viene cualquiera de los dos, actualizamos. 
    // Si uno no viene, mantenemos el actual para evitar borrados accidentales si una vista no envía todo.
    if (widgets && !Array.isArray(widgets)) return res.status(400).json({ error: "Formato widgets escritorio inválido" });
    if (widgets_mobile && !Array.isArray(widgets_mobile)) return res.status(400).json({ error: "Formato widgets móvil inválido" });

    if (widgets && widgets_mobile) {
      await sql`
        INSERT INTO empresa_config_180 (empresa_id, dashboard_widgets, dashboard_widgets_mobile)
        VALUES (${empresaId}, ${widgets}::jsonb, ${widgets_mobile}::jsonb)
        ON CONFLICT (empresa_id)
        DO UPDATE SET
          dashboard_widgets = EXCLUDED.dashboard_widgets,
          dashboard_widgets_mobile = EXCLUDED.dashboard_widgets_mobile,
          updated_at = NOW()
      `;
    } else if (widgets) {
      await sql`
        UPDATE empresa_config_180 SET
          dashboard_widgets = ${widgets}::jsonb,
          updated_at = NOW()
        WHERE empresa_id = ${empresaId}
      `;
    } else if (widgets_mobile) {
      await sql`
        UPDATE empresa_config_180 SET
          dashboard_widgets_mobile = ${widgets_mobile}::jsonb,
          updated_at = NOW()
        WHERE empresa_id = ${empresaId}
      `;
    }

    console.log(`✅ Widgets guardados para empresa: ${empresaId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error("❌ updateDashboardWidgets:", err);
    res.status(500).json({ error: "Error guardando widgets" });
  }
}
