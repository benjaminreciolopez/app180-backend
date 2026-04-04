// backend/src/controllers/asesorEmpleadosController.js
// Gestión cross-client de empleados para el asesor

import { sql } from "../db.js";
import bcrypt from "bcryptjs";

/**
 * Helper: obtiene TODOS los empresa_ids accesibles por la asesoría
 * (incluye la empresa propia de la asesoría + empresas de clientes activos)
 */
async function getAllEmpresaIds(asesoriaId) {
  // Get the asesoria's own empresa_id
  const [asesoria] = await sql`
    SELECT empresa_id FROM asesorias_180 WHERE id = ${asesoriaId}
  `;
  const ownEmpresaId = asesoria?.empresa_id;

  // Get client empresa_ids
  const clientes = await sql`
    SELECT empresa_id FROM asesoria_clientes_180
    WHERE asesoria_id = ${asesoriaId} AND estado = 'activo'
  `;

  const ids = clientes.map((c) => c.empresa_id);
  if (ownEmpresaId && !ids.includes(ownEmpresaId)) {
    ids.unshift(ownEmpresaId);
  }
  return ids;
}

/**
 * Helper: valida acceso del asesor a una empresa
 */
async function validateAccess(asesoriaId, empresaId, asesoriaEmpresaId) {
  if (empresaId === asesoriaEmpresaId) return true;
  const rows = await sql`
    SELECT 1 FROM asesoria_clientes_180
    WHERE asesoria_id = ${asesoriaId} AND empresa_id = ${empresaId} AND estado = 'activo'
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * GET /asesor/empleados/clientes
 * Lista clientes con conteo de empleados (para el selector)
 */
export async function getClientesConEmpleados(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const allIds = await getAllEmpresaIds(asesoriaId);

    if (allIds.length === 0) return res.json({ data: { clientes: [] } });

    // Get asesoria's own empresa_id to flag it
    const [asesoria] = await sql`
      SELECT empresa_id FROM asesorias_180 WHERE id = ${asesoriaId}
    `;
    const ownEmpresaId = asesoria?.empresa_id;

    const clientes = await sql`
      SELECT e.id AS empresa_id, e.nombre,
        (SELECT COUNT(*) FROM employees_180 emp WHERE emp.empresa_id = e.id) AS num_empleados
      FROM empresa_180 e WHERE e.id = ANY(${allIds})
      ORDER BY e.nombre
    `;

    // Flag the asesoria's own empresa
    const result = clientes.map((c) => ({
      ...c,
      es_propia: c.empresa_id === ownEmpresaId,
    }));

    res.json({ data: { clientes: result } });
  } catch (err) {
    console.error("Error getClientesConEmpleados:", err);
    res.status(500).json({ error: "Error al cargar clientes" });
  }
}

/**
 * GET /asesor/empleados
 * Lista empleados cross-client con filtros
 */
export async function getEmpleados(req, res) {
  try {
    const { empresa_id, activo } = req.query;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    let targetIds;
    if (empresa_id) {
      const hasAccess = await validateAccess(asesoriaId, empresa_id, asesoriaEmpresaId);
      if (!hasAccess) return res.status(403).json({ error: "Sin acceso a esta empresa" });
      targetIds = [empresa_id];
    } else {
      // Solo empleados de clientes, no de la empresa propia de la asesoría
      targetIds = await getAllEmpresaIds(asesoriaId);
    }

    if (targetIds.length === 0) return res.json({ data: [] });

    const empleados = await sql`
      SELECT
        e.id, e.nombre, e.activo, e.empresa_id,
        u.email,
        e.salario_base, e.tipo_contrato, e.grupo_cotizacion,
        e.categoria_profesional, e.puesto, e.fecha_ingreso,
        e.fecha_fin_contrato, e.numero_afiliacion_ss, e.dni_nif,
        e.iban, e.jornada_tipo, e.horas_semanales,
        e.porcentaje_irpf, e.convenio, e.email AS email_empleado,
        e.telefono, e.foto_url,
        emp.nombre AS nombre_empresa
      FROM employees_180 e
      JOIN users_180 u ON u.id = e.user_id
      JOIN empresa_180 emp ON emp.id = e.empresa_id
      WHERE e.empresa_id = ANY(${targetIds})
      ${activo === "true" ? sql`AND e.activo = true` : activo === "false" ? sql`AND e.activo = false` : sql``}
      ORDER BY emp.nombre, e.nombre
    `;

    res.json({ data: empleados });
  } catch (err) {
    console.error("Error getEmpleados:", err);
    res.status(500).json({ error: "Error al cargar empleados" });
  }
}

/**
 * GET /asesor/empleados/:id
 * Detalle completo de un empleado
 */
export async function getEmpleadoDetalle(req, res) {
  try {
    const { id } = req.params;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;
    const ids = await getAllEmpresaIds(asesoriaId);

    const [emp] = await sql`
      SELECT
        e.*,
        u.email AS user_email,
        emp.nombre AS nombre_empresa
      FROM employees_180 e
      JOIN users_180 u ON u.id = e.user_id
      JOIN empresa_180 emp ON emp.id = e.empresa_id
      WHERE e.id = ${id} AND e.empresa_id = ANY(${ids})
    `;

    if (!emp) return res.status(404).json({ error: "Empleado no encontrado" });

    res.json({ data: emp });
  } catch (err) {
    console.error("Error getEmpleadoDetalle:", err);
    res.status(500).json({ error: "Error al cargar empleado" });
  }
}

/**
 * PUT /asesor/empleados/:id
 * Actualizar TODOS los campos de un empleado
 */
export async function updateEmpleado(req, res) {
  try {
    const { id } = req.params;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;
    const ids = await getAllEmpresaIds(asesoriaId);

    // Verificar que el empleado pertenece a una empresa accesible
    const [existing] = await sql`
      SELECT e.id, e.user_id, e.empresa_id FROM employees_180 e
      WHERE e.id = ${id} AND e.empresa_id = ANY(${ids})
    `;
    if (!existing) return res.status(404).json({ error: "Empleado no encontrado" });

    const {
      nombre, email, telefono,
      salario_base, tipo_contrato, grupo_cotizacion,
      categoria_profesional, puesto, fecha_ingreso,
      fecha_fin_contrato, numero_afiliacion_ss, dni_nif,
      iban, jornada_tipo, horas_semanales,
      porcentaje_irpf, convenio, activo,
    } = req.body;

    // Actualizar employees_180
    const [updated] = await sql`
      UPDATE employees_180
      SET
        nombre = COALESCE(${nombre ?? null}, nombre),
        telefono = COALESCE(${telefono ?? null}, telefono),
        salario_base = COALESCE(${salario_base ?? null}, salario_base),
        tipo_contrato = COALESCE(${tipo_contrato ?? null}, tipo_contrato),
        grupo_cotizacion = COALESCE(${grupo_cotizacion ?? null}, grupo_cotizacion),
        categoria_profesional = COALESCE(${categoria_profesional ?? null}, categoria_profesional),
        puesto = COALESCE(${puesto ?? null}, puesto),
        fecha_ingreso = COALESCE(${fecha_ingreso ?? null}, fecha_ingreso),
        fecha_fin_contrato = ${fecha_fin_contrato ?? null},
        numero_afiliacion_ss = COALESCE(${numero_afiliacion_ss ?? null}, numero_afiliacion_ss),
        dni_nif = COALESCE(${dni_nif ?? null}, dni_nif),
        iban = COALESCE(${iban ?? null}, iban),
        jornada_tipo = COALESCE(${jornada_tipo ?? null}, jornada_tipo),
        horas_semanales = COALESCE(${horas_semanales ?? null}, horas_semanales),
        porcentaje_irpf = COALESCE(${porcentaje_irpf ?? null}, porcentaje_irpf),
        convenio = COALESCE(${convenio ?? null}, convenio),
        activo = COALESCE(${activo ?? null}, activo)
      WHERE id = ${id}
      RETURNING *
    `;

    // Actualizar email en users_180 si se proporciona
    if (email && existing.user_id) {
      await sql`
        UPDATE users_180 SET email = ${email} WHERE id = ${existing.user_id}
      `;
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Error updateEmpleado:", err);
    res.status(500).json({ error: "Error al actualizar empleado" });
  }
}

/**
 * POST /asesor/empleados
 * Crear empleado para una empresa del asesor
 */
export async function createEmpleado(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    const {
      empresa_id, nombre, email,
      telefono, salario_base, tipo_contrato,
      grupo_cotizacion, categoria_profesional, puesto,
      fecha_ingreso, fecha_fin_contrato, numero_afiliacion_ss,
      dni_nif, iban, jornada_tipo,
      horas_semanales, porcentaje_irpf, convenio,
    } = req.body;

    if (!empresa_id || !nombre || !email) {
      return res.status(400).json({ error: "empresa_id, nombre y email son obligatorios" });
    }

    // Validar acceso
    const hasAccess = await validateAccess(asesoriaId, empresa_id, asesoriaEmpresaId);
    if (!hasAccess) return res.status(403).json({ error: "Sin acceso a esta empresa" });

    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Formato de email inválido" });
    }

    // Verificar email no duplicado
    const [existingUser] = await sql`
      SELECT id FROM users_180 WHERE email = ${email}
    `;
    if (existingUser) {
      return res.status(400).json({ error: "Ya existe un usuario con ese email" });
    }

    // Crear usuario con password inicial
    const PASSWORD_INICIAL = "123456";
    const hashed = await bcrypt.hash(PASSWORD_INICIAL, 10);

    const [user] = await sql`
      INSERT INTO users_180 (email, password, nombre, role, password_forced, created_at)
      VALUES (${email}, ${hashed}, ${nombre}, 'empleado', true, now())
      RETURNING id
    `;

    // Crear empleado con TODOS los campos
    const [empleado] = await sql`
      INSERT INTO employees_180 (
        user_id, empresa_id, nombre, activo, tipo_trabajo,
        telefono, salario_base, tipo_contrato, grupo_cotizacion,
        categoria_profesional, puesto, fecha_ingreso, fecha_fin_contrato,
        numero_afiliacion_ss, dni_nif, iban, jornada_tipo,
        horas_semanales, porcentaje_irpf, convenio, created_at
      ) VALUES (
        ${user.id}, ${empresa_id}, ${nombre}, true, 'empleado',
        ${telefono || null}, ${salario_base || 0}, ${tipo_contrato || "indefinido"},
        ${grupo_cotizacion || 7}, ${categoria_profesional || null}, ${puesto || null},
        ${fecha_ingreso || null}, ${fecha_fin_contrato || null},
        ${numero_afiliacion_ss || null}, ${dni_nif || null}, ${iban || null},
        ${jornada_tipo || "completa"}, ${horas_semanales || 40},
        ${porcentaje_irpf || 0}, ${convenio || null}, now()
      )
      RETURNING *
    `;

    res.json({
      success: true,
      data: empleado,
      password_inicial: PASSWORD_INICIAL,
    });
  } catch (err) {
    console.error("Error createEmpleado:", err);
    res.status(500).json({ error: "Error al crear empleado" });
  }
}

/**
 * POST /asesor/empleados/:id/toggle-status
 * Activar/desactivar empleado
 */
export async function toggleEmpleadoStatus(req, res) {
  try {
    const { id } = req.params;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;
    const ids = await getAllEmpresaIds(asesoriaId);

    const [emp] = await sql`
      SELECT id, activo FROM employees_180 WHERE id = ${id} AND empresa_id = ANY(${ids})
    `;
    if (!emp) return res.status(404).json({ error: "Empleado no encontrado" });

    const [updated] = await sql`
      UPDATE employees_180 SET activo = ${!emp.activo} WHERE id = ${id}
      RETURNING id, nombre, activo
    `;

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Error toggleEmpleadoStatus:", err);
    res.status(500).json({ error: "Error al cambiar estado" });
  }
}
