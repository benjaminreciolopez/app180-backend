// backend/src/controllers/parteConfiguracionesController.js
import { sql } from "../db.js";
import { getEmpresaIdAdminOrThrow } from "../services/authService.js";
import { handleErr } from "../utils/errorHandler.js";

const TIPOS_CAMPO_VALIDOS = ["texto", "numero", "select", "checkbox", "hora", "fecha"];

function validateCampos(campos) {
  if (!Array.isArray(campos)) {
    const err = new Error("campos debe ser un array");
    err.status = 400;
    throw err;
  }

  const keys = new Set();
  for (let i = 0; i < campos.length; i++) {
    const c = campos[i];
    if (!c.key || !c.label || !c.tipo) {
      const err = new Error(`Campo ${i + 1}: key, label y tipo son obligatorios`);
      err.status = 400;
      throw err;
    }
    if (!TIPOS_CAMPO_VALIDOS.includes(c.tipo)) {
      const err = new Error(`Campo ${i + 1}: tipo "${c.tipo}" no válido. Permitidos: ${TIPOS_CAMPO_VALIDOS.join(", ")}`);
      err.status = 400;
      throw err;
    }
    if (c.tipo === "select" && (!Array.isArray(c.opciones) || c.opciones.length === 0)) {
      const err = new Error(`Campo ${i + 1}: tipo "select" requiere opciones`);
      err.status = 400;
      throw err;
    }
    if (keys.has(c.key)) {
      const err = new Error(`Campo ${i + 1}: key "${c.key}" duplicada`);
      err.status = 400;
      throw err;
    }
    keys.add(c.key);
  }
}

/**
 * GET /admin/parte-configuraciones
 */
export const listarParteConfigs = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);

    const rows = await sql`
      SELECT
        pc.id,
        pc.nombre,
        pc.campos,
        pc.activo,
        pc.por_defecto,
        pc.created_at,
        pc.updated_at,
        (SELECT COUNT(*)::int FROM employees_180 e WHERE e.parte_config_id = pc.id) AS empleados_count
      FROM parte_configuraciones_180 pc
      WHERE pc.empresa_id = ${empresaId}
      ORDER BY pc.por_defecto DESC, pc.nombre ASC
    `;

    res.json(rows);
  } catch (err) {
    handleErr(res, err, "listarParteConfigs");
  }
};

/**
 * GET /admin/parte-configuraciones/:id
 */
export const getParteConfig = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { id } = req.params;

    const rows = await sql`
      SELECT pc.*,
        (SELECT COUNT(*)::int FROM employees_180 e WHERE e.parte_config_id = pc.id) AS empleados_count
      FROM parte_configuraciones_180 pc
      WHERE pc.id = ${id} AND pc.empresa_id = ${empresaId}
      LIMIT 1
    `;

    if (!rows.length) return res.status(404).json({ error: "Configuración no encontrada" });

    // Empleados asignados
    const empleados = await sql`
      SELECT id, nombre FROM employees_180
      WHERE parte_config_id = ${id} AND empresa_id = ${empresaId}
      ORDER BY nombre
    `;

    res.json({ ...rows[0], empleados });
  } catch (err) {
    handleErr(res, err, "getParteConfig");
  }
};

/**
 * POST /admin/parte-configuraciones
 */
export const crearParteConfig = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { nombre, campos, por_defecto } = req.body || {};

    if (!nombre?.trim()) return res.status(400).json({ error: "nombre obligatorio" });

    validateCampos(campos || []);

    const out = await sql.begin(async (tx) => {
      // Si va a ser default, quitar default anterior
      if (por_defecto) {
        await tx`
          UPDATE parte_configuraciones_180
          SET por_defecto = false
          WHERE empresa_id = ${empresaId} AND por_defecto = true
        `;
      }

      const r = await tx`
        INSERT INTO parte_configuraciones_180 (empresa_id, nombre, campos, por_defecto)
        VALUES (${empresaId}, ${nombre.trim()}, ${JSON.stringify(campos || [])}::jsonb, ${por_defecto || false})
        RETURNING *
      `;

      return r[0];
    });

    res.json(out);
  } catch (err) {
    handleErr(res, err, "crearParteConfig");
  }
};

/**
 * PUT /admin/parte-configuraciones/:id
 */
export const actualizarParteConfig = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { id } = req.params;
    const { nombre, campos, activo, por_defecto } = req.body || {};

    if (campos !== undefined) validateCampos(campos);

    const out = await sql.begin(async (tx) => {
      const [existing] = await tx`
        SELECT id FROM parte_configuraciones_180
        WHERE id = ${id} AND empresa_id = ${empresaId}
      `;
      if (!existing) {
        const err = new Error("Configuración no encontrada");
        err.status = 404;
        throw err;
      }

      // Si va a ser default, quitar default anterior
      if (por_defecto === true) {
        await tx`
          UPDATE parte_configuraciones_180
          SET por_defecto = false
          WHERE empresa_id = ${empresaId} AND por_defecto = true AND id != ${id}
        `;
      }

      const r = await tx`
        UPDATE parte_configuraciones_180
        SET
          nombre = COALESCE(${nombre?.trim() ?? null}, nombre),
          campos = COALESCE(${campos ? JSON.stringify(campos) : null}::jsonb, campos),
          activo = COALESCE(${activo ?? null}, activo),
          por_defecto = COALESCE(${por_defecto ?? null}, por_defecto),
          updated_at = now()
        WHERE id = ${id} AND empresa_id = ${empresaId}
        RETURNING *
      `;

      return r[0];
    });

    res.json(out);
  } catch (err) {
    handleErr(res, err, "actualizarParteConfig");
  }
};

/**
 * DELETE /admin/parte-configuraciones/:id
 */
export const borrarParteConfig = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { id } = req.params;

    const out = await sql.begin(async (tx) => {
      const [existing] = await tx`
        SELECT id, por_defecto FROM parte_configuraciones_180
        WHERE id = ${id} AND empresa_id = ${empresaId}
      `;
      if (!existing) {
        const err = new Error("Configuración no encontrada");
        err.status = 404;
        throw err;
      }
      if (existing.por_defecto) {
        const err = new Error("No se puede eliminar la configuración por defecto. Asigna otra como default primero.");
        err.status = 400;
        throw err;
      }

      // Desasignar empleados
      await tx`
        UPDATE employees_180
        SET parte_config_id = NULL
        WHERE parte_config_id = ${id} AND empresa_id = ${empresaId}
      `;

      await tx`
        DELETE FROM parte_configuraciones_180
        WHERE id = ${id} AND empresa_id = ${empresaId}
      `;

      return { ok: true };
    });

    res.json(out);
  } catch (err) {
    handleErr(res, err, "borrarParteConfig");
  }
};

/**
 * PUT /admin/parte-configuraciones/:id/asignar
 * Body: { empleado_ids: [uuid, ...] }
 */
export const asignarEmpleados = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { id } = req.params;
    const { empleado_ids } = req.body || {};

    if (!Array.isArray(empleado_ids)) {
      return res.status(400).json({ error: "empleado_ids debe ser array" });
    }

    await sql.begin(async (tx) => {
      // Verify config exists
      const [cfg] = await tx`
        SELECT id FROM parte_configuraciones_180
        WHERE id = ${id} AND empresa_id = ${empresaId}
      `;
      if (!cfg) {
        const err = new Error("Configuración no encontrada");
        err.status = 404;
        throw err;
      }

      // Remove old assignments for this config
      await tx`
        UPDATE employees_180
        SET parte_config_id = NULL
        WHERE parte_config_id = ${id} AND empresa_id = ${empresaId}
      `;

      // Assign new
      if (empleado_ids.length > 0) {
        await tx`
          UPDATE employees_180
          SET parte_config_id = ${id}
          WHERE id = ANY(${empleado_ids}::uuid[]) AND empresa_id = ${empresaId}
        `;
      }
    });

    res.json({ ok: true });
  } catch (err) {
    handleErr(res, err, "asignarEmpleados");
  }
};

/**
 * GET /empleado/mi-parte-config
 * Returns the parte config for the current employee
 */
export const miParteConfig = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get employee + their parte_config_id
    const [emp] = await sql`
      SELECT e.id, e.empresa_id, e.parte_config_id
      FROM employees_180 e
      WHERE e.user_id = ${userId}
      LIMIT 1
    `;

    if (!emp) return res.json({ campos: [] });

    // Try employee-specific config first
    if (emp.parte_config_id) {
      const [cfg] = await sql`
        SELECT id, nombre, campos FROM parte_configuraciones_180
        WHERE id = ${emp.parte_config_id} AND activo = true
        LIMIT 1
      `;
      if (cfg) return res.json(cfg);
    }

    // Fallback to empresa default
    const [defCfg] = await sql`
      SELECT id, nombre, campos FROM parte_configuraciones_180
      WHERE empresa_id = ${emp.empresa_id} AND por_defecto = true AND activo = true
      LIMIT 1
    `;

    if (defCfg) return res.json(defCfg);

    // No config at all
    res.json({ campos: [] });
  } catch (err) {
    handleErr(res, err, "miParteConfig");
  }
};
