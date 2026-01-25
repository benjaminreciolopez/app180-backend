import { sql } from "../db.js";

/**
 * GET /admin/configuracion
 */
export async function getEmpresaConfig(req, res) {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const empresaId = req.user.empresa_id;

    const rows = await sql`
      SELECT modulos
      FROM empresa_config_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    if (!rows.length) {
      return res.json({});
    }

    return res.json(rows[0].modulos || {});
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
    const { modulos } = req.body;

    if (!modulos || typeof modulos !== "object") {
      return res.status(400).json({ error: "Formato inválido" });
    }

    await sql`
      UPDATE empresa_config_180
      SET modulos = ${modulos}::jsonb
      WHERE empresa_id = ${empresaId}
    `;

    return res.json({ success: true, modulos });
  } catch (err) {
    console.error("❌ updateEmpresaConfig:", err);
    res.status(500).json({ error: "Error guardando configuración" });
  }
}
