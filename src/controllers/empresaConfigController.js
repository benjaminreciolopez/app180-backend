import { sql } from "../db.js";

export const DEFAULT_TIPOS_BLOQUE = [
  { key: "trabajo", label: "Trabajo", color: "#22c55e", es_trabajo: true, sistema: true },
  { key: "descanso", label: "Descanso", color: "#f59e0b", es_trabajo: false, sistema: true },
  { key: "pausa", label: "Pausa", color: "#a855f7", es_trabajo: false, sistema: false },
  { key: "comida", label: "Comida", color: "#ef4444", es_trabajo: false, sistema: false },
  { key: "otro", label: "Otro", color: "#6b7280", es_trabajo: false, sistema: false },
];

const DEFAULT_MODULOS = {
  clientes: true,
  fichajes: true,
  calendario: true,
  calendario_import: true,
  worklogs: true,
  empleados: true,
  facturacion: false,
  pagos: false,
  fiscal: false,
  contable: false,
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
      SELECT c.modulos, c.modulos_mobile, c.ai_tokens, e.user_id as creator_id,
             c.pin_lock_enabled, c.pin_code, c.pin_timeout_minutes,
             c.screensaver_enabled, c.screensaver_style, c.tipos_bloque,
             e.tipo_contribuyente
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
        SELECT c.modulos, c.modulos_mobile
        FROM empresa_config_180 c
        WHERE c.empresa_id = ${empresaId}
        LIMIT 1
      `;
    }

    // Leer backup_local_path desde configuracionsistema_180
    const [sysConfig] = await sql`
      SELECT backup_local_path
      FROM configuracionsistema_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    const stored = rows[0]?.modulos || {};
    const mobile = rows[0]?.modulos_mobile || null;

    return res.json({
      ...DEFAULT_MODULOS,
      ...stored,
      modulos_mobile: mobile,
      ai_tokens: rows[0]?.ai_tokens || 0,
      es_creador: rows[0]?.creator_id === req.user.id,
      backup_local_path: sysConfig?.backup_local_path || null,
      pin_lock_enabled: rows[0]?.pin_lock_enabled || false,
      pin_code: rows[0]?.pin_code || null,
      pin_timeout_minutes: rows[0]?.pin_timeout_minutes || 5,
      screensaver_enabled: rows[0]?.screensaver_enabled || false,
      screensaver_style: rows[0]?.screensaver_style || 'clock',
      tipos_bloque: rows[0]?.tipos_bloque || DEFAULT_TIPOS_BLOQUE,
      tipo_contribuyente: rows[0]?.tipo_contribuyente || null,
    });
  } catch (err) {
    console.error("Error getEmpresaConfig:", err);
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
    const backupLocalPath = req.body.backup_local_path ?? null;
    const pinConfig = req.body.pin_config; // optional PIN settings

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
      fiscal: !!input.fiscal,
      contable: !!input.contable,
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
        fiscal: !!inputMobile.fiscal,
        contable: !!inputMobile.contable,
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

    // Guardar backup_local_path en configuracionsistema_180 (independiente del módulo facturación)
    if (backupLocalPath !== null) {
      await sql`
        INSERT INTO configuracionsistema_180 (empresa_id, backup_local_path)
        VALUES (${empresaId}, ${backupLocalPath})
        ON CONFLICT (empresa_id)
        DO UPDATE SET
          backup_local_path = EXCLUDED.backup_local_path,
          actualizado_en = now(),
          updated_at = now()
      `;
    }

    // Guardar PIN config si viene
    if (pinConfig && typeof pinConfig === 'object') {
      const timeout = Math.max(1, Math.min(60, parseInt(pinConfig.pin_timeout_minutes) || 5));
      const style = ['clock', 'logo', 'minimal'].includes(pinConfig.screensaver_style) ? pinConfig.screensaver_style : 'clock';
      await sql`
        UPDATE empresa_config_180 SET
          pin_lock_enabled = ${!!pinConfig.pin_lock_enabled},
          pin_code = ${pinConfig.pin_code || null},
          pin_timeout_minutes = ${timeout},
          screensaver_enabled = ${!!pinConfig.screensaver_enabled},
          screensaver_style = ${style}
        WHERE empresa_id = ${empresaId}
      `;
    }

    return res.json({
      success: true,
      modulos: safeModulos,
      modulos_mobile: safeMobile
    });
  } catch (err) {
    console.error("Error updateEmpresaConfig:", err);
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


    return res.json({ widgets, widgets_mobile });
  } catch (err) {
    console.error("Error getDashboardWidgets:", err);
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

    return res.json({ success: true });
  } catch (err) {
    console.error("Error updateDashboardWidgets:", err);
    res.status(500).json({ error: "Error guardando widgets" });
  }
}

/**
 * GET /admin/configuracion/tipos-bloque
 */
export async function getTiposBloque(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    if (!empresaId) return res.status(403).json({ error: "No empresa" });

    const [row] = await sql`
      SELECT tipos_bloque FROM empresa_config_180 WHERE empresa_id = ${empresaId} LIMIT 1
    `;

    return res.json(row?.tipos_bloque || DEFAULT_TIPOS_BLOQUE);
  } catch (err) {
    console.error("Error getTiposBloque:", err);
    res.status(500).json({ error: "Error obteniendo tipos de bloque" });
  }
}

/**
 * PUT /admin/configuracion/tipos-bloque
 */
export async function updateTiposBloque(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    if (!empresaId) return res.status(403).json({ error: "No empresa" });

    const { tipos_bloque } = req.body;

    if (!Array.isArray(tipos_bloque)) {
      return res.status(400).json({ error: "tipos_bloque debe ser un array" });
    }

    // Validar estructura de cada tipo
    const keys = new Set();
    for (const t of tipos_bloque) {
      if (!t.key || typeof t.key !== "string") return res.status(400).json({ error: "Cada tipo necesita un 'key' string" });
      if (!t.label || typeof t.label !== "string") return res.status(400).json({ error: `Tipo '${t.key}': label obligatorio` });
      if (typeof t.es_trabajo !== "boolean") return res.status(400).json({ error: `Tipo '${t.key}': es_trabajo debe ser boolean` });
      if (keys.has(t.key)) return res.status(400).json({ error: `Key duplicada: '${t.key}'` });
      keys.add(t.key);
    }

    // Validar que los tipos sistema existen
    const tienesTrabajo = tipos_bloque.some(t => t.key === "trabajo" && t.sistema === true);
    const tienesDescanso = tipos_bloque.some(t => t.key === "descanso" && t.sistema === true);
    if (!tienesTrabajo || !tienesDescanso) {
      return res.status(400).json({ error: "Los tipos 'trabajo' y 'descanso' son obligatorios y no se pueden eliminar" });
    }

    // Validar que trabajo.es_trabajo=true y descanso.es_trabajo=false
    const trabajo = tipos_bloque.find(t => t.key === "trabajo");
    const descanso = tipos_bloque.find(t => t.key === "descanso");
    if (!trabajo.es_trabajo) return res.status(400).json({ error: "'trabajo' debe tener es_trabajo: true" });
    if (descanso.es_trabajo) return res.status(400).json({ error: "'descanso' debe tener es_trabajo: false" });

    // Sanitizar
    const safe = tipos_bloque.map(t => ({
      key: t.key.trim(),
      label: t.label.trim(),
      color: t.color || "#6b7280",
      es_trabajo: !!t.es_trabajo,
      sistema: !!t.sistema,
    }));

    await sql`
      UPDATE empresa_config_180
      SET tipos_bloque = ${JSON.stringify(safe)}::jsonb, updated_at = now()
      WHERE empresa_id = ${empresaId}
    `;

    return res.json({ success: true, tipos_bloque: safe });
  } catch (err) {
    console.error("Error updateTiposBloque:", err);
    res.status(500).json({ error: "Error guardando tipos de bloque" });
  }
}

/**
 * PUT /admin/empresa/tipo-contribuyente
 * Actualiza el tipo de contribuyente (autonomo/sociedad)
 */
export async function updateTipoContribuyente(req, res) {
  try {
    const userId = req.user.id;
    const { tipo_contribuyente } = req.body;

    if (!['autonomo', 'sociedad'].includes(tipo_contribuyente)) {
      return res.status(400).json({ error: "Tipo invalido. Usa 'autonomo' o 'sociedad'." });
    }

    const [empresa] = await sql`SELECT id FROM empresa_180 WHERE user_id=${userId} LIMIT 1`;
    if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });

    await sql`UPDATE empresa_180 SET tipo_contribuyente=${tipo_contribuyente} WHERE id=${empresa.id}`;

    res.json({ success: true, tipo_contribuyente });
  } catch (err) {
    console.error("Error updateTipoContribuyente:", err);
    res.status(500).json({ error: "Error actualizando tipo de contribuyente" });
  }
}
