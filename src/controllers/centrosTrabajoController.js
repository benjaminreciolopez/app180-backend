// backend/src/controllers/centrosTrabajoController.js

import { sql } from "../db.js";

/* =========================
   Helpers
========================= */

async function getEmpresaId(userIdOrReq) {
  if (typeof userIdOrReq === 'object' && userIdOrReq.user) {
    if (userIdOrReq.user.empresa_id) return userIdOrReq.user.empresa_id;
    userIdOrReq = userIdOrReq.user.id;
  }
  const r = await sql`select id from empresa_180 where user_id=${userIdOrReq} limit 1`;
  if (!r[0]) {
    const e = new Error("Empresa no asociada");
    e.status = 403;
    throw e;
  }
  return r[0].id;
}

/* =========================
   CRUD Centros de Trabajo
========================= */

export async function listarCentros(req, res) {
  try {
    const empresaId = await getEmpresaId(req);

    const rows = await sql`
      SELECT ct.*,
        (SELECT count(*) FROM employees_180 e WHERE e.centro_trabajo_id = ct.id AND e.activo = true) AS num_empleados
      FROM centros_trabajo_180 ct
      WHERE ct.empresa_id = ${empresaId}
      ORDER BY ct.activo DESC, ct.nombre
    `;

    res.json(rows);
  } catch (err) {
    console.error("❌ Error listarCentros:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

export async function getCentroDetalle(req, res) {
  try {
    const empresaId = await getEmpresaId(req);

    const [centro] = await sql`
      SELECT * FROM centros_trabajo_180
      WHERE id = ${req.params.id} AND empresa_id = ${empresaId}
    `;

    if (!centro) return res.status(404).json({ error: "Centro no encontrado" });
    res.json(centro);
  } catch (err) {
    console.error("❌ Error getCentroDetalle:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

export async function crearCentro(req, res) {
  try {
    const empresaId = await getEmpresaId(req);

    const { nombre, direccion, lat, lng, radio_m, geo_policy, notas } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: "El nombre es obligatorio" });
    }

    if (lat != null && (Number(lat) < -90 || Number(lat) > 90)) {
      return res.status(400).json({ error: "Latitud inválida" });
    }
    if (lng != null && (Number(lng) < -180 || Number(lng) > 180)) {
      return res.status(400).json({ error: "Longitud inválida" });
    }
    if (radio_m != null && Number(radio_m) <= 0) {
      return res.status(400).json({ error: "Radio debe ser mayor que 0" });
    }

    const [centro] = await sql`
      INSERT INTO centros_trabajo_180 (
        empresa_id, nombre, direccion, lat, lng, radio_m, geo_policy, notas
      ) VALUES (
        ${empresaId},
        ${nombre.trim()},
        ${direccion || null},
        ${lat != null ? Number(lat) : null},
        ${lng != null ? Number(lng) : null},
        ${radio_m != null ? Number(radio_m) : 100},
        ${geo_policy || 'info'},
        ${notas || null}
      )
      RETURNING *
    `;

    res.status(201).json(centro);
  } catch (err) {
    console.error("❌ Error crearCentro:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

export async function actualizarCentro(req, res) {
  try {
    const empresaId = await getEmpresaId(req);

    const { id } = req.params;
    const { nombre, direccion, lat, lng, radio_m, geo_policy, notas, activo } = req.body;

    // Validaciones
    if (nombre != null && !nombre.trim()) {
      return res.status(400).json({ error: "El nombre no puede estar vacío" });
    }
    if (lat != null && (Number(lat) < -90 || Number(lat) > 90)) {
      return res.status(400).json({ error: "Latitud inválida" });
    }
    if (lng != null && (Number(lng) < -180 || Number(lng) > 180)) {
      return res.status(400).json({ error: "Longitud inválida" });
    }
    if (radio_m != null && Number(radio_m) <= 0) {
      return res.status(400).json({ error: "Radio debe ser mayor que 0" });
    }

    // Build dynamic update
    const fields = {};
    if (nombre !== undefined) fields.nombre = nombre.trim();
    if (direccion !== undefined) fields.direccion = direccion || null;
    if (lat !== undefined) fields.lat = lat != null ? Number(lat) : null;
    if (lng !== undefined) fields.lng = lng != null ? Number(lng) : null;
    if (radio_m !== undefined) fields.radio_m = radio_m != null ? Number(radio_m) : 100;
    if (geo_policy !== undefined) fields.geo_policy = geo_policy || 'info';
    if (notas !== undefined) fields.notas = notas || null;
    if (activo !== undefined) fields.activo = activo;
    fields.updated_at = new Date();

    if (Object.keys(fields).length === 1) {
      return res.status(400).json({ error: "No hay campos para actualizar" });
    }

    const [updated] = await sql`
      UPDATE centros_trabajo_180
      SET ${sql(fields)}
      WHERE id = ${id} AND empresa_id = ${empresaId}
      RETURNING *
    `;

    if (!updated) return res.status(404).json({ error: "Centro no encontrado" });
    res.json(updated);
  } catch (err) {
    console.error("❌ Error actualizarCentro:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

export async function desactivarCentro(req, res) {
  try {
    const empresaId = await getEmpresaId(req);

    const [updated] = await sql`
      UPDATE centros_trabajo_180
      SET activo = false, updated_at = now()
      WHERE id = ${req.params.id} AND empresa_id = ${empresaId}
      RETURNING *
    `;

    if (!updated) return res.status(404).json({ error: "Centro no encontrado" });
    res.json(updated);
  } catch (err) {
    console.error("❌ Error desactivarCentro:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

/* =========================
   Asignación Centro <-> Empleado
========================= */

export async function asignarCentroEmpleado(req, res) {
  try {
    const empresaId = await getEmpresaId(req);

    const { empleado_id, centro_trabajo_id } = req.body;

    if (!empleado_id || !centro_trabajo_id) {
      return res.status(400).json({ error: "empleado_id y centro_trabajo_id son obligatorios" });
    }

    await sql.begin(async (tx) => {
      // Validar empleado
      const [emp] = await tx`
        SELECT 1 FROM employees_180
        WHERE id = ${empleado_id} AND empresa_id = ${empresaId}
      `;
      if (!emp) throw Object.assign(new Error("Empleado inválido"), { status: 404 });

      // Validar centro
      const [ct] = await tx`
        SELECT 1 FROM centros_trabajo_180
        WHERE id = ${centro_trabajo_id} AND empresa_id = ${empresaId} AND activo = true
      `;
      if (!ct) throw Object.assign(new Error("Centro de trabajo inválido"), { status: 404 });

      // Exclusión mutua: cerrar asignaciones de cliente activas
      await tx`
        UPDATE empleado_clientes_180
        SET fecha_fin = current_date - 1, activo = false, updated_at = now()
        WHERE empleado_id = ${empleado_id}
          AND empresa_id = ${empresaId}
          AND (fecha_fin IS NULL OR fecha_fin >= current_date)
          AND activo = true
      `;

      // Asignar centro
      await tx`
        UPDATE employees_180
        SET centro_trabajo_id = ${centro_trabajo_id}
        WHERE id = ${empleado_id} AND empresa_id = ${empresaId}
      `;
    });

    res.json({ ok: true, message: "Centro de trabajo asignado" });
  } catch (err) {
    console.error("❌ Error asignarCentroEmpleado:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

export async function desasignarCentroEmpleado(req, res) {
  try {
    const empresaId = await getEmpresaId(req);

    const { empleado_id } = req.body;

    if (!empleado_id) {
      return res.status(400).json({ error: "empleado_id es obligatorio" });
    }

    await sql`
      UPDATE employees_180
      SET centro_trabajo_id = NULL
      WHERE id = ${empleado_id} AND empresa_id = ${empresaId}
    `;

    res.json({ ok: true, message: "Centro de trabajo desasignado" });
  } catch (err) {
    console.error("❌ Error desasignarCentroEmpleado:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

/* =========================
   Listar empleados de un centro
========================= */

export async function listarEmpleadosCentro(req, res) {
  try {
    const empresaId = await getEmpresaId(req);

    const { id } = req.params;

    const empleados = await sql`
      SELECT e.id, e.nombre, e.activo, u.email
      FROM employees_180 e
      JOIN users_180 u ON u.id = e.user_id
      WHERE e.centro_trabajo_id = ${id}
        AND e.empresa_id = ${empresaId}
      ORDER BY e.nombre
    `;

    res.json(empleados);
  } catch (err) {
    console.error("❌ Error listarEmpleadosCentro:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}
