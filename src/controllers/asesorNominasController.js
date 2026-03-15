// backend/src/controllers/asesorNominasController.js
// Gestión de nóminas cross-client para el asesor

import { sql } from "../db.js";
import {
  calcularNomina,
  recopilarIncidencias,
  generarNominasParaEmpresa,
} from "../services/nominaCalculationService.js";

/**
 * Helper: obtiene todos los empresa_ids a los que el asesor tiene acceso
 * (clientes activos + empresa propia de la asesoría)
 */
async function getAsesorEmpresaIds(asesoriaId, asesoriaEmpresaId) {
  const clientes = await sql`
    SELECT empresa_id FROM asesoria_clientes_180
    WHERE asesoria_id = ${asesoriaId} AND estado = 'activo'
  `;
  const ids = clientes.map((c) => c.empresa_id);
  if (asesoriaEmpresaId && !ids.includes(asesoriaEmpresaId)) {
    ids.push(asesoriaEmpresaId);
  }
  return ids;
}

/**
 * Helper: valida que el asesor tiene acceso a una empresa específica
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
 * GET /asesor/nominas
 * Lista nóminas cross-client con filtros
 */
export async function getAsesorNominas(req, res) {
  try {
    const { empresa_id, empleado_id, anio, mes, estado } = req.query;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    if (!anio) return res.status(400).json({ error: "Año requerido" });

    let empresaIds;
    if (empresa_id) {
      const hasAccess = await validateAccess(asesoriaId, empresa_id, asesoriaEmpresaId);
      if (!hasAccess) return res.status(403).json({ error: "Sin acceso a esta empresa" });
      empresaIds = [empresa_id];
    } else {
      empresaIds = await getAsesorEmpresaIds(asesoriaId, asesoriaEmpresaId);
    }

    if (empresaIds.length === 0) return res.json({ success: true, data: [] });

    const yearNum = parseInt(anio, 10);
    const monthNum = mes ? parseInt(mes, 10) : null;

    let nominas;
    if (monthNum && empleado_id && estado) {
      nominas = await sql`
        SELECT n.*, emp.nombre AS nombre_empresa,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM nominas_180 n
        LEFT JOIN employees_180 e ON n.empleado_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        LEFT JOIN empresa_180 emp ON n.empresa_id = emp.id
        WHERE n.empresa_id = ANY(${empresaIds})
          AND n.anio = ${yearNum}
          AND n.mes = ${monthNum}
          AND n.empleado_id = ${empleado_id}
          AND n.estado = ${estado}
          AND n.deleted_at IS NULL
        ORDER BY emp.nombre, n.mes DESC, COALESCE(u.nombre, e.nombre)
      `;
    } else if (monthNum && empleado_id) {
      nominas = await sql`
        SELECT n.*, emp.nombre AS nombre_empresa,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM nominas_180 n
        LEFT JOIN employees_180 e ON n.empleado_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        LEFT JOIN empresa_180 emp ON n.empresa_id = emp.id
        WHERE n.empresa_id = ANY(${empresaIds})
          AND n.anio = ${yearNum}
          AND n.mes = ${monthNum}
          AND n.empleado_id = ${empleado_id}
          AND n.deleted_at IS NULL
        ORDER BY emp.nombre, n.mes DESC, COALESCE(u.nombre, e.nombre)
      `;
    } else if (monthNum && estado) {
      nominas = await sql`
        SELECT n.*, emp.nombre AS nombre_empresa,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM nominas_180 n
        LEFT JOIN employees_180 e ON n.empleado_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        LEFT JOIN empresa_180 emp ON n.empresa_id = emp.id
        WHERE n.empresa_id = ANY(${empresaIds})
          AND n.anio = ${yearNum}
          AND n.mes = ${monthNum}
          AND n.estado = ${estado}
          AND n.deleted_at IS NULL
        ORDER BY emp.nombre, n.mes DESC, COALESCE(u.nombre, e.nombre)
      `;
    } else if (monthNum) {
      nominas = await sql`
        SELECT n.*, emp.nombre AS nombre_empresa,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM nominas_180 n
        LEFT JOIN employees_180 e ON n.empleado_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        LEFT JOIN empresa_180 emp ON n.empresa_id = emp.id
        WHERE n.empresa_id = ANY(${empresaIds})
          AND n.anio = ${yearNum}
          AND n.mes = ${monthNum}
          AND n.deleted_at IS NULL
        ORDER BY emp.nombre, n.mes DESC, COALESCE(u.nombre, e.nombre)
      `;
    } else if (empleado_id) {
      nominas = await sql`
        SELECT n.*, emp.nombre AS nombre_empresa,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM nominas_180 n
        LEFT JOIN employees_180 e ON n.empleado_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        LEFT JOIN empresa_180 emp ON n.empresa_id = emp.id
        WHERE n.empresa_id = ANY(${empresaIds})
          AND n.anio = ${yearNum}
          AND n.empleado_id = ${empleado_id}
          AND n.deleted_at IS NULL
        ORDER BY emp.nombre, n.mes DESC, COALESCE(u.nombre, e.nombre)
      `;
    } else if (estado) {
      nominas = await sql`
        SELECT n.*, emp.nombre AS nombre_empresa,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM nominas_180 n
        LEFT JOIN employees_180 e ON n.empleado_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        LEFT JOIN empresa_180 emp ON n.empresa_id = emp.id
        WHERE n.empresa_id = ANY(${empresaIds})
          AND n.anio = ${yearNum}
          AND n.estado = ${estado}
          AND n.deleted_at IS NULL
        ORDER BY emp.nombre, n.mes DESC, COALESCE(u.nombre, e.nombre)
      `;
    } else {
      nominas = await sql`
        SELECT n.*, emp.nombre AS nombre_empresa,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM nominas_180 n
        LEFT JOIN employees_180 e ON n.empleado_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        LEFT JOIN empresa_180 emp ON n.empresa_id = emp.id
        WHERE n.empresa_id = ANY(${empresaIds})
          AND n.anio = ${yearNum}
          AND n.deleted_at IS NULL
        ORDER BY emp.nombre, n.mes DESC, COALESCE(u.nombre, e.nombre)
      `;
    }

    res.json({ success: true, data: nominas });
  } catch (error) {
    console.error("Error getAsesorNominas:", error);
    res.status(500).json({ error: "Error al obtener nóminas" });
  }
}

/**
 * GET /asesor/nominas/empleados
 * Lista empleados cross-client para selección de nóminas
 */
export async function getAsesorEmpleados(req, res) {
  try {
    const { empresa_id } = req.query;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    let empresaIds;
    if (empresa_id) {
      const hasAccess = await validateAccess(asesoriaId, empresa_id, asesoriaEmpresaId);
      if (!hasAccess) return res.status(403).json({ error: "Sin acceso a esta empresa" });
      empresaIds = [empresa_id];
    } else {
      empresaIds = await getAsesorEmpresaIds(asesoriaId, asesoriaEmpresaId);
    }

    if (empresaIds.length === 0) return res.json({ success: true, data: [] });

    const empleados = await sql`
      SELECT e.id, e.empresa_id, e.activo, e.salario_base, e.tipo_contrato,
             e.grupo_cotizacion, e.puesto, e.porcentaje_irpf, e.jornada_tipo,
             COALESCE(u.nombre, e.nombre) AS nombre,
             emp.nombre AS nombre_empresa
      FROM employees_180 e
      LEFT JOIN users_180 u ON e.user_id = u.id
      LEFT JOIN empresa_180 emp ON e.empresa_id = emp.id
      WHERE e.empresa_id = ANY(${empresaIds})
        AND e.activo = true
      ORDER BY emp.nombre, COALESCE(u.nombre, e.nombre)
    `;

    res.json({ success: true, data: empleados });
  } catch (error) {
    console.error("Error getAsesorEmpleados:", error);
    res.status(500).json({ error: "Error al obtener empleados" });
  }
}

/**
 * POST /asesor/nominas/generar
 * Genera nóminas automáticas para un cliente/periodo
 */
export async function generarNominas(req, res) {
  try {
    const { empresa_id, anio, mes, empleado_ids } = req.body;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    if (!empresa_id || !anio || !mes) {
      return res.status(400).json({ error: "empresa_id, anio y mes son obligatorios" });
    }

    const hasAccess = await validateAccess(asesoriaId, empresa_id, asesoriaEmpresaId);
    if (!hasAccess) return res.status(403).json({ error: "Sin acceso a esta empresa" });

    const resultado = await generarNominasParaEmpresa(
      empresa_id,
      parseInt(anio, 10),
      parseInt(mes, 10),
      empleado_ids || null,
      req.user.id
    );

    res.json({ success: true, ...resultado });
  } catch (error) {
    console.error("Error generarNominas:", error);
    res.status(500).json({ error: "Error al generar nóminas" });
  }
}

/**
 * GET /asesor/nominas/:id
 * Obtener detalle de una nómina
 */
export async function getNominaDetalle(req, res) {
  try {
    const { id } = req.params;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    const [nomina] = await sql`
      SELECT n.*, emp.nombre AS nombre_empresa,
             COALESCE(u.nombre, e.nombre) AS nombre_empleado,
             e.salario_base, e.tipo_contrato, e.grupo_cotizacion,
             e.porcentaje_irpf, e.puesto, e.dni_nif, e.numero_afiliacion_ss
      FROM nominas_180 n
      LEFT JOIN employees_180 e ON n.empleado_id = e.id
      LEFT JOIN users_180 u ON e.user_id = u.id
      LEFT JOIN empresa_180 emp ON n.empresa_id = emp.id
      WHERE n.id = ${id} AND n.deleted_at IS NULL
    `;

    if (!nomina) return res.status(404).json({ error: "Nómina no encontrada" });

    const hasAccess = await validateAccess(asesoriaId, nomina.empresa_id, asesoriaEmpresaId);
    if (!hasAccess) return res.status(403).json({ error: "Sin acceso" });

    // Obtener incidencias del periodo
    const incidencias = await sql`
      SELECT * FROM nomina_incidencias_180
      WHERE empresa_id = ${nomina.empresa_id}
        AND empleado_id = ${nomina.empleado_id}
        AND anio = ${nomina.anio}
        AND mes = ${nomina.mes}
      ORDER BY created_at
    `;

    res.json({ success: true, data: { ...nomina, incidencias } });
  } catch (error) {
    console.error("Error getNominaDetalle:", error);
    res.status(500).json({ error: "Error al obtener detalle" });
  }
}

/**
 * PUT /asesor/nominas/:id
 * Editar/validar una nómina
 */
export async function editarNomina(req, res) {
  try {
    const { id } = req.params;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    const [existing] = await sql`
      SELECT empresa_id, estado FROM nominas_180
      WHERE id = ${id} AND deleted_at IS NULL
    `;
    if (!existing) return res.status(404).json({ error: "Nómina no encontrada" });

    const hasAccess = await validateAccess(asesoriaId, existing.empresa_id, asesoriaEmpresaId);
    if (!hasAccess) return res.status(403).json({ error: "Sin acceso" });

    if (existing.estado === "aprobada") {
      return res.status(400).json({ error: "No se puede editar una nómina aprobada" });
    }

    const {
      bruto, seguridad_social_empresa, seguridad_social_empleado,
      irpf_retencion, liquido, base_cotizacion,
      tipo_contingencias_comunes, tipo_desempleo, tipo_formacion, tipo_fogasa,
      horas_extra, complementos, notas,
    } = req.body;

    const [updated] = await sql`
      UPDATE nominas_180 SET
        bruto = COALESCE(${bruto ?? null}, bruto),
        seguridad_social_empresa = COALESCE(${seguridad_social_empresa ?? null}, seguridad_social_empresa),
        seguridad_social_empleado = COALESCE(${seguridad_social_empleado ?? null}, seguridad_social_empleado),
        irpf_retencion = COALESCE(${irpf_retencion ?? null}, irpf_retencion),
        liquido = COALESCE(${liquido ?? null}, liquido),
        base_cotizacion = COALESCE(${base_cotizacion ?? null}, base_cotizacion),
        tipo_contingencias_comunes = COALESCE(${tipo_contingencias_comunes ?? null}, tipo_contingencias_comunes),
        tipo_desempleo = COALESCE(${tipo_desempleo ?? null}, tipo_desempleo),
        tipo_formacion = COALESCE(${tipo_formacion ?? null}, tipo_formacion),
        tipo_fogasa = COALESCE(${tipo_fogasa ?? null}, tipo_fogasa),
        horas_extra = COALESCE(${horas_extra ?? null}, horas_extra),
        complementos = COALESCE(${complementos ?? null}, complementos),
        notas = COALESCE(${notas ?? null}, notas),
        estado = 'revisada',
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error editarNomina:", error);
    res.status(500).json({ error: "Error al editar nómina" });
  }
}

/**
 * POST /asesor/nominas/:id/aprobar
 * Aprobar una nómina
 */
export async function aprobarNomina(req, res) {
  try {
    const { id } = req.params;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    const [existing] = await sql`
      SELECT empresa_id, estado FROM nominas_180
      WHERE id = ${id} AND deleted_at IS NULL
    `;
    if (!existing) return res.status(404).json({ error: "Nómina no encontrada" });

    const hasAccess = await validateAccess(asesoriaId, existing.empresa_id, asesoriaEmpresaId);
    if (!hasAccess) return res.status(403).json({ error: "Sin acceso" });

    const [updated] = await sql`
      UPDATE nominas_180 SET estado = 'aprobada', updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error aprobarNomina:", error);
    res.status(500).json({ error: "Error al aprobar nómina" });
  }
}

/**
 * GET /asesor/nominas/entregas
 * Entregas cross-client con filtros
 */
export async function getAsesorEntregas(req, res) {
  try {
    const { empresa_id, empleado_id, anio, mes } = req.query;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    let empresaIds;
    if (empresa_id) {
      const hasAccess = await validateAccess(asesoriaId, empresa_id, asesoriaEmpresaId);
      if (!hasAccess) return res.status(403).json({ error: "Sin acceso" });
      empresaIds = [empresa_id];
    } else {
      empresaIds = await getAsesorEmpresaIds(asesoriaId, asesoriaEmpresaId);
    }

    if (empresaIds.length === 0) return res.json({ success: true, data: [] });

    // Build base query with required filters
    let entregas;
    if (anio && mes && empleado_id) {
      entregas = await sql`
        SELECT ne.*, n.anio, n.mes, n.bruto, n.liquido, n.estado AS estado_nomina,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado,
               emp.nombre AS nombre_empresa
        FROM nomina_entregas_180 ne
        JOIN nominas_180 n ON ne.nomina_id = n.id
        LEFT JOIN employees_180 e ON ne.empleado_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        LEFT JOIN empresa_180 emp ON ne.empresa_id = emp.id
        WHERE ne.empresa_id = ANY(${empresaIds})
          AND n.anio = ${parseInt(anio, 10)}
          AND n.mes = ${parseInt(mes, 10)}
          AND ne.empleado_id = ${empleado_id}
        ORDER BY ne.fecha_envio DESC
      `;
    } else if (anio && mes) {
      entregas = await sql`
        SELECT ne.*, n.anio, n.mes, n.bruto, n.liquido, n.estado AS estado_nomina,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado,
               emp.nombre AS nombre_empresa
        FROM nomina_entregas_180 ne
        JOIN nominas_180 n ON ne.nomina_id = n.id
        LEFT JOIN employees_180 e ON ne.empleado_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        LEFT JOIN empresa_180 emp ON ne.empresa_id = emp.id
        WHERE ne.empresa_id = ANY(${empresaIds})
          AND n.anio = ${parseInt(anio, 10)}
          AND n.mes = ${parseInt(mes, 10)}
        ORDER BY ne.fecha_envio DESC
      `;
    } else if (anio) {
      entregas = await sql`
        SELECT ne.*, n.anio, n.mes, n.bruto, n.liquido, n.estado AS estado_nomina,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado,
               emp.nombre AS nombre_empresa
        FROM nomina_entregas_180 ne
        JOIN nominas_180 n ON ne.nomina_id = n.id
        LEFT JOIN employees_180 e ON ne.empleado_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        LEFT JOIN empresa_180 emp ON ne.empresa_id = emp.id
        WHERE ne.empresa_id = ANY(${empresaIds})
          AND n.anio = ${parseInt(anio, 10)}
        ORDER BY ne.fecha_envio DESC
      `;
    } else {
      entregas = await sql`
        SELECT ne.*, n.anio, n.mes, n.bruto, n.liquido, n.estado AS estado_nomina,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado,
               emp.nombre AS nombre_empresa
        FROM nomina_entregas_180 ne
        JOIN nominas_180 n ON ne.nomina_id = n.id
        LEFT JOIN employees_180 e ON ne.empleado_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        LEFT JOIN empresa_180 emp ON ne.empresa_id = emp.id
        WHERE ne.empresa_id = ANY(${empresaIds})
        ORDER BY ne.fecha_envio DESC
        LIMIT 100
      `;
    }

    res.json({ success: true, data: entregas });
  } catch (error) {
    console.error("Error getAsesorEntregas:", error);
    res.status(500).json({ error: "Error al obtener entregas" });
  }
}

/**
 * GET /asesor/nominas/incidencias
 */
export async function getIncidencias(req, res) {
  try {
    const { empresa_id, empleado_id, anio, mes } = req.query;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    if (!empresa_id || !anio || !mes) {
      return res.status(400).json({ error: "empresa_id, anio y mes son obligatorios" });
    }

    const hasAccess = await validateAccess(asesoriaId, empresa_id, asesoriaEmpresaId);
    if (!hasAccess) return res.status(403).json({ error: "Sin acceso" });

    let incidencias;
    if (empleado_id) {
      incidencias = await sql`
        SELECT i.*, COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM nomina_incidencias_180 i
        LEFT JOIN employees_180 e ON i.empleado_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        WHERE i.empresa_id = ${empresa_id}
          AND i.empleado_id = ${empleado_id}
          AND i.anio = ${parseInt(anio, 10)}
          AND i.mes = ${parseInt(mes, 10)}
        ORDER BY i.created_at
      `;
    } else {
      incidencias = await sql`
        SELECT i.*, COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM nomina_incidencias_180 i
        LEFT JOIN employees_180 e ON i.empleado_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        WHERE i.empresa_id = ${empresa_id}
          AND i.anio = ${parseInt(anio, 10)}
          AND i.mes = ${parseInt(mes, 10)}
        ORDER BY i.created_at
      `;
    }

    res.json({ success: true, data: incidencias });
  } catch (error) {
    console.error("Error getIncidencias:", error);
    res.status(500).json({ error: "Error al obtener incidencias" });
  }
}

/**
 * POST /asesor/nominas/incidencias
 */
export async function createIncidencia(req, res) {
  try {
    const { empresa_id, empleado_id, anio, mes, tipo, concepto, importe, horas, dias } = req.body;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    if (!empresa_id || !empleado_id || !anio || !mes || !tipo || !concepto) {
      return res.status(400).json({ error: "Datos obligatorios faltantes" });
    }

    const hasAccess = await validateAccess(asesoriaId, empresa_id, asesoriaEmpresaId);
    if (!hasAccess) return res.status(403).json({ error: "Sin acceso" });

    const [incidencia] = await sql`
      INSERT INTO nomina_incidencias_180 (
        empresa_id, empleado_id, anio, mes, tipo, concepto,
        importe, horas, dias, automatica, created_by
      ) VALUES (
        ${empresa_id}, ${empleado_id}, ${parseInt(anio, 10)}, ${parseInt(mes, 10)},
        ${tipo}, ${concepto},
        ${parseFloat(importe) || 0}, ${parseFloat(horas) || 0}, ${parseInt(dias) || 0},
        false, ${req.user.id}
      )
      RETURNING *
    `;

    res.json({ success: true, data: incidencia });
  } catch (error) {
    console.error("Error createIncidencia:", error);
    res.status(500).json({ error: "Error al crear incidencia" });
  }
}

/**
 * PUT /asesor/nominas/incidencias/:id
 */
export async function updateIncidencia(req, res) {
  try {
    const { id } = req.params;
    const { tipo, concepto, importe, horas, dias, estado } = req.body;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    const [existing] = await sql`SELECT empresa_id FROM nomina_incidencias_180 WHERE id = ${id}`;
    if (!existing) return res.status(404).json({ error: "Incidencia no encontrada" });

    const hasAccess = await validateAccess(asesoriaId, existing.empresa_id, asesoriaEmpresaId);
    if (!hasAccess) return res.status(403).json({ error: "Sin acceso" });

    const [updated] = await sql`
      UPDATE nomina_incidencias_180 SET
        tipo = COALESCE(${tipo ?? null}, tipo),
        concepto = COALESCE(${concepto ?? null}, concepto),
        importe = COALESCE(${importe !== undefined ? parseFloat(importe) : null}, importe),
        horas = COALESCE(${horas !== undefined ? parseFloat(horas) : null}, horas),
        dias = COALESCE(${dias !== undefined ? parseInt(dias) : null}, dias),
        estado = COALESCE(${estado ?? null}, estado),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updateIncidencia:", error);
    res.status(500).json({ error: "Error al actualizar incidencia" });
  }
}

/**
 * DELETE /asesor/nominas/incidencias/:id
 */
export async function deleteIncidencia(req, res) {
  try {
    const { id } = req.params;
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    const [existing] = await sql`SELECT empresa_id FROM nomina_incidencias_180 WHERE id = ${id}`;
    if (!existing) return res.status(404).json({ error: "Incidencia no encontrada" });

    const hasAccess = await validateAccess(asesoriaId, existing.empresa_id, asesoriaEmpresaId);
    if (!hasAccess) return res.status(403).json({ error: "Sin acceso" });

    await sql`DELETE FROM nomina_incidencias_180 WHERE id = ${id}`;
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleteIncidencia:", error);
    res.status(500).json({ error: "Error al eliminar incidencia" });
  }
}

/**
 * GET /asesor/nominas/clientes
 * Lista clientes con su empresa propia para selector de nóminas
 */
export async function getClientesParaNominas(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    const clientes = await sql`
      SELECT ac.empresa_id, e.nombre,
             (SELECT COUNT(*)::int FROM employees_180 emp WHERE emp.empresa_id = ac.empresa_id AND emp.activo = true) AS num_empleados
      FROM asesoria_clientes_180 ac
      JOIN empresa_180 e ON e.id = ac.empresa_id
      WHERE ac.asesoria_id = ${asesoriaId} AND ac.estado = 'activo'
      ORDER BY e.nombre
    `;

    // Añadir empresa propia
    let propiaInfo = null;
    if (asesoriaEmpresaId) {
      const [propia] = await sql`
        SELECT id AS empresa_id, nombre FROM empresa_180 WHERE id = ${asesoriaEmpresaId}
      `;
      if (propia) {
        const [countPropia] = await sql`
          SELECT COUNT(*)::int AS num_empleados FROM employees_180 WHERE empresa_id = ${asesoriaEmpresaId} AND activo = true
        `;
        propiaInfo = { ...propia, num_empleados: countPropia.num_empleados, es_propia: true };
      }
    }

    res.json({
      success: true,
      data: {
        propia: propiaInfo,
        clientes,
      },
    });
  } catch (error) {
    console.error("Error getClientesParaNominas:", error);
    res.status(500).json({ error: "Error al obtener clientes" });
  }
}
