import { sql } from "../db.js";

const DEFAULT_MODULOS = {
  clientes: true,
  fichajes: true,
  calendario: true,
  calendario_import: true,
  worklogs: true,
  ausencias: true,
  empleados: true,
  facturacion: false,
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
      SELECT modulos
      FROM empresa_config_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    // Autocrear si no existe
    if (rows.length === 0) {
      await sql`
        INSERT INTO empresa_config_180 (empresa_id, modulos)
        VALUES (${empresaId}, ${DEFAULT_MODULOS}::jsonb)
        ON CONFLICT (empresa_id) DO NOTHING
      `;

      rows = await sql`
        SELECT modulos
        FROM empresa_config_180
        WHERE empresa_id = ${empresaId}
        LIMIT 1
      `;
    }

    const stored = rows[0]?.modulos || {};

    return res.json({
      ...DEFAULT_MODULOS,
      ...stored,
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

    if (!input || typeof input !== "object") {
      return res.status(400).json({ error: "Formato inválido" });
    }

    const safeModulos = {
      clientes: !!input.clientes,
      fichajes: !!input.fichajes,
      calendario: !!input.calendario,
      calendario_import: !!input.calendario_import,
      worklogs: !!input.worklogs,
      ausencias: !!input.ausencias,
      empleados: !!input.empleados,
      facturacion: !!input.facturacion,
    };

    await sql`
      INSERT INTO empresa_config_180 (empresa_id, modulos)
      VALUES (${empresaId}, ${safeModulos}::jsonb)
      ON CONFLICT (empresa_id)
      DO UPDATE SET modulos = EXCLUDED.modulos
    `;

    return res.json({
      success: true,
      modulos: safeModulos,
    });
  } catch (err) {
    console.error("❌ updateEmpresaConfig:", err);
    res.status(500).json({ error: "Error guardando configuración" });
  }
}
