import { sql } from "../db.js";

/**
 * GET /perfil
 * Obtiene el perfil de facturación de la empresa actual
 */
export const getProfile = async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    if (!empresaId) return res.status(400).json({ error: "No empresa_id" });

    const rows = await sql`
      SELECT *
      FROM perfil_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    return res.json(rows[0] || {});
  } catch (err) {
    console.error("❌ getProfile:", err);
    return res.status(500).json({ error: "Error cargando perfil" });
  }
};

/**
 * POST /perfil
 * Crea o actualiza el perfil de facturación
 */
export const updateProfile = async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    if (!empresaId) return res.status(400).json({ error: "No empresa_id" });

    const {
      nombre_fiscal,
      cif,
      direccion,
      poblacion,
      provincia,
      cp,
      pais,
      telefono,
      email,
      web,
    } = req.body;

    const rows = await sql`
      INSERT INTO perfil_180 (
        empresa_id,
        nombre_fiscal,
        cif,
        direccion,
        poblacion,
        provincia,
        cp,
        pais,
        telefono,
        email,
        web,
        updated_at
      )
      VALUES (
        ${empresaId},
        ${nombre_fiscal || null},
        ${cif || null},
        ${direccion || null},
        ${poblacion || null},
        ${provincia || null},
        ${cp || null},
        ${pais || 'España'},
        ${telefono || null},
        ${email || null},
        ${web || null},
        now()
      )
      ON CONFLICT (empresa_id) DO UPDATE SET
        nombre_fiscal = EXCLUDED.nombre_fiscal,
        cif = EXCLUDED.cif,
        direccion = EXCLUDED.direccion,
        poblacion = EXCLUDED.poblacion,
        provincia = EXCLUDED.provincia,
        cp = EXCLUDED.cp,
        pais = EXCLUDED.pais,
        telefono = EXCLUDED.telefono,
        email = EXCLUDED.email,
        web = EXCLUDED.web,
        updated_at = now()
      RETURNING *
    `;

    return res.json(rows[0]);
  } catch (err) {
    console.error("❌ updateProfile:", err);
    return res.status(500).json({ error: "Error guardando perfil" });
  }
};
