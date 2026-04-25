// backend/src/controllers/contabilidadController.js
import { sql } from "../db.js";
import * as contabilidadService from "../services/contabilidadService.js";
import ExcelJS from "exceljs";
import archiver from "archiver";

// =============================================
// PGC - PLAN DE CUENTAS
// =============================================

export async function getCuentas(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { grupo, tipo, activa, search } = req.query;

    let cuentas;
    if (search) {
      cuentas = await sql`
        SELECT * FROM pgc_cuentas_180
        WHERE empresa_id = ${empresaId}
          AND (codigo ILIKE ${"%" + search + "%"} OR nombre ILIKE ${"%" + search + "%"})
          ${grupo ? sql`AND grupo = ${parseInt(grupo)}` : sql``}
          ${tipo ? sql`AND tipo = ${tipo}` : sql``}
          ${activa !== undefined ? sql`AND activa = ${activa === "true"}` : sql``}
        ORDER BY codigo
      `;
      // Si no hay resultados en PGC, buscar en asientos reales
      if (cuentas.length === 0) {
        cuentas = await sql`
          SELECT DISTINCT ON (l.cuenta_codigo)
            l.cuenta_codigo as codigo,
            COALESCE(l.cuenta_nombre, l.cuenta_codigo) as nombre,
            CASE
              WHEN LEFT(l.cuenta_codigo, 1) IN ('1','2','5') THEN 'balance'
              WHEN LEFT(l.cuenta_codigo, 1) IN ('6','7') THEN 'resultado'
              ELSE 'otro'
            END as tipo,
            CAST(LEFT(l.cuenta_codigo, 1) AS integer) as grupo
          FROM asiento_lineas_180 l
          JOIN asientos_180 a ON a.id = l.asiento_id AND a.estado != 'anulado'
          WHERE l.empresa_id = ${empresaId}
            AND (l.cuenta_codigo ILIKE ${"%" + search + "%"} OR l.cuenta_nombre ILIKE ${"%" + search + "%"})
          ORDER BY l.cuenta_codigo, l.created_at DESC
        `;
      }
    } else {
      cuentas = await sql`
        SELECT * FROM pgc_cuentas_180
        WHERE empresa_id = ${empresaId}
          ${grupo ? sql`AND grupo = ${parseInt(grupo)}` : sql``}
          ${tipo ? sql`AND tipo = ${tipo}` : sql``}
          ${activa !== undefined ? sql`AND activa = ${activa === "true"}` : sql``}
        ORDER BY codigo
      `;
      // Si PGC está vacío, extraer cuentas con movimientos reales
      if (cuentas.length === 0) {
        cuentas = await sql`
          SELECT DISTINCT ON (l.cuenta_codigo)
            l.cuenta_codigo as codigo,
            COALESCE(l.cuenta_nombre, l.cuenta_codigo) as nombre,
            CASE
              WHEN LEFT(l.cuenta_codigo, 1) IN ('1','2','5') THEN 'balance'
              WHEN LEFT(l.cuenta_codigo, 1) IN ('6','7') THEN 'resultado'
              ELSE 'otro'
            END as tipo,
            CAST(LEFT(l.cuenta_codigo, 1) AS integer) as grupo
          FROM asiento_lineas_180 l
          JOIN asientos_180 a ON a.id = l.asiento_id AND a.estado != 'anulado'
          WHERE l.empresa_id = ${empresaId}
          ORDER BY l.cuenta_codigo, l.created_at DESC
        `;
      }
    }

    res.json(cuentas);
  } catch (err) {
    console.error("Error getCuentas:", err);
    res.status(500).json({ error: "Error obteniendo cuentas" });
  }
}

export async function crearCuenta(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { codigo, nombre, tipo, grupo, subgrupo, nivel, padre_codigo } = req.body;

    if (!codigo || !nombre || !tipo || !grupo) {
      return res.status(400).json({ error: "codigo, nombre, tipo y grupo son requeridos" });
    }

    // Verificar que no exista
    const existing = await sql`
      SELECT id FROM pgc_cuentas_180
      WHERE empresa_id = ${empresaId} AND codigo = ${codigo}
    `;
    if (existing.length > 0) {
      return res.status(409).json({ error: `La cuenta ${codigo} ya existe` });
    }

    const [cuenta] = await sql`
      INSERT INTO pgc_cuentas_180 (empresa_id, codigo, nombre, tipo, grupo, subgrupo, nivel, padre_codigo, es_estandar)
      VALUES (${empresaId}, ${codigo}, ${nombre}, ${tipo}, ${grupo}, ${subgrupo || null}, ${nivel || 3}, ${padre_codigo || null}, false)
      RETURNING *
    `;

    res.status(201).json(cuenta);
  } catch (err) {
    console.error("Error crearCuenta:", err);
    res.status(500).json({ error: "Error creando cuenta" });
  }
}

export async function actualizarCuenta(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { id } = req.params;
    const { nombre, activa } = req.body;

    const [cuenta] = await sql`
      UPDATE pgc_cuentas_180
      SET nombre = COALESCE(${nombre || null}, nombre),
          activa = COALESCE(${activa !== undefined ? activa : null}, activa),
          updated_at = now()
      WHERE id = ${id} AND empresa_id = ${empresaId}
      RETURNING *
    `;

    if (!cuenta) return res.status(404).json({ error: "Cuenta no encontrada" });

    // Propagate name change to asiento_lineas for tercero accounts (4300xx, 4000xx)
    if (nombre && /^(4300|4000)\d+/.test(cuenta.codigo)) {
      await sql`
        UPDATE asiento_lineas_180
        SET cuenta_nombre = ${nombre}
        WHERE empresa_id = ${empresaId} AND cuenta_codigo = ${cuenta.codigo}
      `;
    }

    res.json(cuenta);
  } catch (err) {
    console.error("Error actualizarCuenta:", err);
    res.status(500).json({ error: "Error actualizando cuenta" });
  }
}

export async function fusionarCuentas(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { source_codigo, target_codigo } = req.body;

    if (!source_codigo || !target_codigo) {
      return res.status(400).json({ error: "source_codigo y target_codigo son requeridos" });
    }
    if (source_codigo === target_codigo) {
      return res.status(400).json({ error: "Las cuentas origen y destino no pueden ser la misma" });
    }

    // Validate both accounts exist
    const [source] = await sql`
      SELECT * FROM pgc_cuentas_180
      WHERE empresa_id = ${empresaId} AND codigo = ${source_codigo}
    `;
    const [target] = await sql`
      SELECT * FROM pgc_cuentas_180
      WHERE empresa_id = ${empresaId} AND codigo = ${target_codigo}
    `;

    if (!source) return res.status(404).json({ error: `Cuenta origen ${source_codigo} no encontrada` });
    if (!target) return res.status(404).json({ error: `Cuenta destino ${target_codigo} no encontrada` });

    // Validate same prefix (both clients 4300xx or both suppliers 4000xx)
    const sourcePrefix = source_codigo.substring(0, 4);
    const targetPrefix = target_codigo.substring(0, 4);
    if (sourcePrefix !== targetPrefix) {
      return res.status(400).json({ error: "Solo se pueden fusionar cuentas del mismo tipo (ambas clientes o ambas proveedores)" });
    }

    let lineasActualizadas = 0;

    await sql.begin(async (tx) => {
      // 1. Update all asiento_lineas from source to target
      const updated = await tx`
        UPDATE asiento_lineas_180
        SET cuenta_codigo = ${target_codigo},
            cuenta_nombre = ${target.nombre}
        WHERE empresa_id = ${empresaId} AND cuenta_codigo = ${source_codigo}
      `;
      lineasActualizadas = updated.count;

      // 2. Copy source tercero_ref as alias in target
      if (source.tercero_ref) {
        const currentAliases = target.tercero_aliases || [];
        if (!currentAliases.includes(source.tercero_ref)) {
          await tx`
            UPDATE pgc_cuentas_180
            SET tercero_aliases = COALESCE(tercero_aliases, '[]'::jsonb) || ${JSON.stringify([source.tercero_ref])}::jsonb,
                updated_at = now()
            WHERE empresa_id = ${empresaId} AND codigo = ${target_codigo}
          `;
        }
      }

      // Also copy source nombre as alias if different from target
      const sourceNombreNorm = (source.nombre || "").trim().toUpperCase();
      const targetRef = (target.tercero_ref || "").trim().toUpperCase();
      if (sourceNombreNorm && sourceNombreNorm !== targetRef) {
        const currentAliases = target.tercero_aliases || [];
        if (!currentAliases.includes(sourceNombreNorm)) {
          await tx`
            UPDATE pgc_cuentas_180
            SET tercero_aliases = COALESCE(tercero_aliases, '[]'::jsonb) || ${JSON.stringify([sourceNombreNorm])}::jsonb,
                updated_at = now()
            WHERE empresa_id = ${empresaId} AND codigo = ${target_codigo}
          `;
        }
      }

      // 3. Deactivate source account (don't delete for traceability)
      await tx`
        UPDATE pgc_cuentas_180
        SET activa = false, updated_at = now()
        WHERE empresa_id = ${empresaId} AND codigo = ${source_codigo}
      `;
    });

    res.json({
      message: "Cuentas fusionadas correctamente",
      lineas_actualizadas: lineasActualizadas,
      source_codigo,
      target_codigo,
    });
  } catch (err) {
    console.error("Error fusionarCuentas:", err);
    res.status(500).json({ error: "Error fusionando cuentas" });
  }
}

export async function inicializarPGC(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const result = await contabilidadService.inicializarPGC(empresaId);
    res.json(result);
  } catch (err) {
    console.error("Error inicializarPGC:", err);
    res.status(500).json({ error: "Error inicializando PGC" });
  }
}

// =============================================
// ASIENTOS CONTABLES
// =============================================

export async function getAsientos(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { ejercicio, fecha_desde, fecha_hasta, tipo, estado, buscar, page = 1, limit = 50, sort_field, sort_dir } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build ORDER BY clause - validate sort field to prevent injection
    const SORT_MAP = {
      numero_asc: sql`a.numero ASC`,
      numero_desc: sql`a.numero DESC`,
      fecha_asc: sql`a.fecha ASC, a.numero ASC`,
      fecha_desc: sql`a.fecha DESC, a.numero DESC`,
      concepto_asc: sql`a.concepto ASC`,
      concepto_desc: sql`a.concepto DESC`,
      tipo_asc: sql`a.tipo ASC`,
      tipo_desc: sql`a.tipo DESC`,
      estado_asc: sql`a.estado ASC`,
      estado_desc: sql`a.estado DESC`,
      total_debe_asc: sql`total_debe ASC NULLS FIRST`,
      total_debe_desc: sql`total_debe DESC NULLS LAST`,
      total_haber_asc: sql`total_haber ASC NULLS FIRST`,
      total_haber_desc: sql`total_haber DESC NULLS LAST`,
    };
    const sortKey = sort_field && sort_dir ? `${sort_field}_${sort_dir}` : null;
    const orderClause = SORT_MAP[sortKey] || sql`a.fecha DESC, a.numero DESC`;

    const asientos = await sql`
      SELECT a.*,
        u.nombre AS creado_por_nombre,
        (SELECT SUM(l.debe) FROM asiento_lineas_180 l WHERE l.asiento_id = a.id) AS total_debe,
        (SELECT SUM(l.haber) FROM asiento_lineas_180 l WHERE l.asiento_id = a.id) AS total_haber,
        (SELECT count(*)::int FROM asiento_lineas_180 l WHERE l.asiento_id = a.id) AS num_lineas
      FROM asientos_180 a
      LEFT JOIN users_180 u ON u.id = a.creado_por
      WHERE a.empresa_id = ${empresaId}
        ${ejercicio ? sql`AND a.ejercicio = ${parseInt(ejercicio)}` : sql``}
        ${fecha_desde ? sql`AND a.fecha >= ${fecha_desde}` : sql``}
        ${fecha_hasta ? sql`AND a.fecha <= ${fecha_hasta}` : sql``}
        ${tipo ? sql`AND a.tipo = ${tipo}` : sql``}
        ${estado ? sql`AND a.estado = ${estado}` : sql``}
        ${buscar ? sql`AND (
          a.concepto ILIKE ${'%' + buscar + '%'}
          OR a.numero::text = ${buscar}
          OR EXISTS (
            SELECT 1 FROM asiento_lineas_180 l
            WHERE l.asiento_id = a.id AND (l.cuenta_codigo ILIKE ${'%' + buscar + '%'} OR l.cuenta_nombre ILIKE ${'%' + buscar + '%'})
          )
        )` : sql``}
      ORDER BY ${orderClause}
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `;

    const [{ total }] = await sql`
      SELECT count(*)::int AS total FROM asientos_180 a
      WHERE a.empresa_id = ${empresaId}
        ${ejercicio ? sql`AND a.ejercicio = ${parseInt(ejercicio)}` : sql``}
        ${fecha_desde ? sql`AND a.fecha >= ${fecha_desde}` : sql``}
        ${fecha_hasta ? sql`AND a.fecha <= ${fecha_hasta}` : sql``}
        ${tipo ? sql`AND a.tipo = ${tipo}` : sql``}
        ${estado ? sql`AND a.estado = ${estado}` : sql``}
        ${buscar ? sql`AND (
          a.concepto ILIKE ${'%' + buscar + '%'}
          OR a.numero::text = ${buscar}
          OR EXISTS (
            SELECT 1 FROM asiento_lineas_180 l
            WHERE l.asiento_id = a.id AND (l.cuenta_codigo ILIKE ${'%' + buscar + '%'} OR l.cuenta_nombre ILIKE ${'%' + buscar + '%'})
          )
        )` : sql``}
    `;

    res.json({ asientos, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error("Error getAsientos:", err);
    res.status(500).json({ error: "Error obteniendo asientos" });
  }
}

export async function getAsientoById(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { id } = req.params;

    const [asiento] = await sql`
      SELECT a.*, u.nombre AS creado_por_nombre
      FROM asientos_180 a
      LEFT JOIN users_180 u ON u.id = a.creado_por
      WHERE a.id = ${id} AND a.empresa_id = ${empresaId}
    `;

    if (!asiento) return res.status(404).json({ error: "Asiento no encontrado" });

    const lineas = await sql`
      SELECT * FROM asiento_lineas_180
      WHERE asiento_id = ${id}
      ORDER BY orden
    `;

    res.json({ ...asiento, lineas });
  } catch (err) {
    console.error("Error getAsientoById:", err);
    res.status(500).json({ error: "Error obteniendo asiento" });
  }
}

export async function crearAsiento(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { fecha, concepto, tipo, referencia_tipo, referencia_id, notas, lineas } = req.body;

    if (!fecha || !concepto || !lineas) {
      return res.status(400).json({ error: "fecha, concepto y lineas son requeridos" });
    }

    const asiento = await contabilidadService.crearAsiento({
      empresaId,
      fecha,
      concepto,
      tipo,
      referencia_tipo,
      referencia_id,
      notas,
      creado_por: req.user.id,
      lineas,
    });

    res.status(201).json(asiento);
  } catch (err) {
    console.error("Error crearAsiento:", err);
    res.status(err.status || 500).json({ error: err.message || "Error creando asiento" });
  }
}

export async function editarAsiento(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { id } = req.params;
    const { concepto, notas, lineas } = req.body;

    // Se pueden editar borradores y validados (no anulados)
    const [existing] = await sql`
      SELECT estado FROM asientos_180
      WHERE id = ${id} AND empresa_id = ${empresaId}
    `;

    if (!existing) return res.status(404).json({ error: "Asiento no encontrado" });
    if (existing.estado === "anulado") {
      return res.status(400).json({ error: "No se pueden editar asientos anulados" });
    }

    if (lineas && lineas.length >= 2) {
      // Validar partida doble
      const totalDebe = lineas.reduce((sum, l) => sum + parseFloat(l.debe || 0), 0);
      const totalHaber = lineas.reduce((sum, l) => sum + parseFloat(l.haber || 0), 0);

      if (Math.abs(totalDebe - totalHaber) > 0.01) {
        return res.status(400).json({
          error: `El asiento no cuadra: Debe=${totalDebe.toFixed(2)}, Haber=${totalHaber.toFixed(2)}`,
        });
      }

      await sql.begin(async (tx) => {
        // Actualizar cabecera
        await tx`
          UPDATE asientos_180
          SET concepto = COALESCE(${concepto || null}, concepto),
              notas = COALESCE(${notas !== undefined ? notas : null}, notas),
              updated_at = now()
          WHERE id = ${id} AND empresa_id = ${empresaId}
        `;

        // Reemplazar líneas
        await tx`DELETE FROM asiento_lineas_180 WHERE asiento_id = ${id}`;

        const lineasData = lineas.map((l, idx) => ({
          asiento_id: id,
          empresa_id: empresaId,
          cuenta_codigo: l.cuenta_codigo,
          cuenta_nombre: l.cuenta_nombre || l.cuenta_codigo,
          debe: parseFloat(l.debe || 0),
          haber: parseFloat(l.haber || 0),
          concepto: l.concepto || concepto,
          orden: idx + 1,
        }));

        await tx`INSERT INTO asiento_lineas_180 ${tx(lineasData)}`;
      });
    } else {
      await sql`
        UPDATE asientos_180
        SET concepto = COALESCE(${concepto || null}, concepto),
            notas = COALESCE(${notas !== undefined ? notas : null}, notas),
            updated_at = now()
        WHERE id = ${id} AND empresa_id = ${empresaId}
      `;
    }

    // Devolver asiento actualizado
    const [asiento] = await sql`SELECT * FROM asientos_180 WHERE id = ${id}`;
    const lineasResult = await sql`SELECT * FROM asiento_lineas_180 WHERE asiento_id = ${id} ORDER BY orden`;

    res.json({ ...asiento, lineas: lineasResult });
  } catch (err) {
    console.error("Error editarAsiento:", err);
    res.status(500).json({ error: "Error editando asiento" });
  }
}

export async function validarAsiento(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { id } = req.params;

    const [asiento] = await sql`
      UPDATE asientos_180
      SET estado = 'validado', validado_por = ${req.user.id}, validado_at = now(), updated_at = now()
      WHERE id = ${id} AND empresa_id = ${empresaId} AND estado = 'borrador'
      RETURNING *
    `;

    if (!asiento) return res.status(404).json({ error: "Asiento no encontrado o no está en borrador" });
    res.json(asiento);
  } catch (err) {
    console.error("Error validarAsiento:", err);
    res.status(500).json({ error: "Error validando asiento" });
  }
}

export async function validarAsientosMultiple(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Debe enviar un array de IDs" });
    }

    if (ids.length > 500) {
      return res.status(400).json({ error: "Máximo 500 asientos por operación" });
    }

    const validados = await sql`
      UPDATE asientos_180
      SET estado = 'validado', validado_por = ${req.user.id}, validado_at = now(), updated_at = now()
      WHERE id = ANY(${ids}) AND empresa_id = ${empresaId} AND estado = 'borrador'
      RETURNING id
    `;

    res.json({
      validados: validados.length,
      total_enviados: ids.length,
      ids_validados: validados.map(a => a.id),
    });
  } catch (err) {
    console.error("Error validarAsientosMultiple:", err);
    res.status(500).json({ error: "Error validando asientos" });
  }
}

export async function anularAsiento(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { id } = req.params;

    const [asiento] = await sql`
      UPDATE asientos_180
      SET estado = 'anulado', updated_at = now()
      WHERE id = ${id} AND empresa_id = ${empresaId} AND estado != 'anulado'
      RETURNING *
    `;

    if (!asiento) return res.status(404).json({ error: "Asiento no encontrado o ya anulado" });
    res.json(asiento);
  } catch (err) {
    console.error("Error anularAsiento:", err);
    res.status(500).json({ error: "Error anulando asiento" });
  }
}

export async function eliminarAsiento(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { id } = req.params;

    const [exists] = await sql`SELECT id FROM asientos_180 WHERE id = ${id} AND empresa_id = ${empresaId}`;
    if (!exists) return res.status(404).json({ error: "Asiento no encontrado" });

    await sql`DELETE FROM asiento_lineas_180 WHERE asiento_id = ${id}`;
    await sql`DELETE FROM asientos_180 WHERE id = ${id} AND empresa_id = ${empresaId}`;

    res.json({ ok: true });
  } catch (err) {
    console.error("Error eliminarAsiento:", err);
    res.status(500).json({ error: "Error eliminando asiento" });
  }
}

export async function eliminarAsientosMultiple(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids requeridos" });

    for (const id of ids) {
      await sql`DELETE FROM asiento_lineas_180 WHERE asiento_id = ${id}`;
      await sql`DELETE FROM asientos_180 WHERE id = ${id} AND empresa_id = ${empresaId}`;
    }

    res.json({ ok: true, eliminados: ids.length });
  } catch (err) {
    console.error("Error eliminarAsientosMultiple:", err);
    res.status(500).json({ error: "Error eliminando asientos" });
  }
}

// =============================================
// LIBRO MAYOR
// =============================================

export async function getLibroMayor(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { cuenta_codigo } = req.params;
    const { fecha_desde, fecha_hasta } = req.query;

    const desde = fecha_desde || `${new Date().getFullYear()}-01-01`;
    const hasta = fecha_hasta || new Date().toISOString().split("T")[0];

    const result = await contabilidadService.libroMayor(empresaId, cuenta_codigo, desde, hasta);
    res.json(result);
  } catch (err) {
    console.error("Error getLibroMayor:", err);
    res.status(500).json({ error: "Error obteniendo libro mayor" });
  }
}

// =============================================
// BALANCE Y PyG
// =============================================

export async function getBalance(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { fecha } = req.query;
    const fechaHasta = fecha || new Date().toISOString().split("T")[0];

    const balance = await contabilidadService.calcularBalance(empresaId, fechaHasta);
    res.json(balance);
  } catch (err) {
    console.error("Error getBalance:", err);
    res.status(500).json({ error: "Error calculando balance" });
  }
}

export async function getPyG(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { fecha_desde, fecha_hasta } = req.query;

    const anio = new Date().getFullYear();
    const desde = fecha_desde || `${anio}-01-01`;
    const hasta = fecha_hasta || new Date().toISOString().split("T")[0];

    const pyg = await contabilidadService.calcularPyG(empresaId, desde, hasta);
    res.json(pyg);
  } catch (err) {
    console.error("Error getPyG:", err);
    res.status(500).json({ error: "Error calculando PyG" });
  }
}

// =============================================
// EJERCICIOS
// =============================================

export async function getEjercicios(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const ejercicios = await sql`
      SELECT * FROM ejercicios_contables_180
      WHERE empresa_id = ${empresaId}
      ORDER BY anio DESC
    `;
    res.json(ejercicios);
  } catch (err) {
    console.error("Error getEjercicios:", err);
    res.status(500).json({ error: "Error obteniendo ejercicios" });
  }
}

export async function cerrarEjercicio(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { anio } = req.params;

    const result = await contabilidadService.cerrarEjercicio(empresaId, parseInt(anio), req.user.id);
    res.json(result);
  } catch (err) {
    console.error("Error cerrarEjercicio:", err);
    res.status(err.status || 500).json({ error: err.message || "Error cerrando ejercicio" });
  }
}

// =============================================
// AUTO-GENERACIÓN
// =============================================

export async function generarAsientosPeriodo(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { fecha_desde, fecha_hasta } = req.body;

    if (!fecha_desde || !fecha_hasta) {
      return res.status(400).json({ error: "fecha_desde y fecha_hasta son requeridos" });
    }

    const result = await contabilidadService.generarAsientosPeriodo(
      empresaId,
      fecha_desde,
      fecha_hasta,
      req.user.id
    );

    res.json(result);
  } catch (err) {
    console.error("Error generarAsientosPeriodo:", err);
    res.status(500).json({ error: "Error generando asientos" });
  }
}

// =============================================
// EXPORTAR ASIENTOS (Excel / CSV)
// =============================================

export async function exportarAsientos(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { ejercicio, fecha_desde, fecha_hasta, tipo, estado, buscar, formato = "excel" } = req.query;

    // Fetch all asientos matching filters (no pagination)
    const asientos = await sql`
      SELECT a.numero, a.fecha, a.concepto, a.tipo, a.estado, a.notas
      FROM asientos_180 a
      WHERE a.empresa_id = ${empresaId}
        ${ejercicio ? sql`AND a.ejercicio = ${parseInt(ejercicio)}` : sql``}
        ${fecha_desde ? sql`AND a.fecha >= ${fecha_desde}` : sql``}
        ${fecha_hasta ? sql`AND a.fecha <= ${fecha_hasta}` : sql``}
        ${tipo ? sql`AND a.tipo = ${tipo}` : sql``}
        ${estado ? sql`AND a.estado = ${estado}` : sql``}
        ${buscar ? sql`AND (
          a.concepto ILIKE ${'%' + buscar + '%'}
          OR a.numero::text = ${buscar}
        )` : sql``}
      ORDER BY a.fecha ASC, a.numero ASC
    `;

    // Fetch all lineas for these asientos
    const asientoIds = asientos.map(a => a.numero);
    const lineas = asientoIds.length > 0 ? await sql`
      SELECT l.cuenta_codigo, l.cuenta_nombre, l.debe, l.haber, l.concepto AS linea_concepto, l.orden,
             a.numero AS asiento_numero, a.fecha AS asiento_fecha
      FROM asiento_lineas_180 l
      INNER JOIN asientos_180 a ON a.id = l.asiento_id
      WHERE a.empresa_id = ${empresaId}
        ${ejercicio ? sql`AND a.ejercicio = ${parseInt(ejercicio)}` : sql``}
        ${fecha_desde ? sql`AND a.fecha >= ${fecha_desde}` : sql``}
        ${fecha_hasta ? sql`AND a.fecha <= ${fecha_hasta}` : sql``}
        ${tipo ? sql`AND a.tipo = ${tipo}` : sql``}
        ${estado ? sql`AND a.estado = ${estado}` : sql``}
      ORDER BY a.fecha ASC, a.numero ASC, l.orden ASC
    ` : [];

    if (formato === "csv") {
      // Format: Diario contable CSV (compatible with ContaSOL, A3, Sage, Holded)
      const BOM = "\uFEFF";
      const header = "Asiento;Fecha;Cuenta;Nombre Cuenta;Debe;Haber;Concepto";
      const rows = lineas.map(l => {
        const fecha = new Date(l.asiento_fecha).toLocaleDateString("es-ES");
        return `${l.asiento_numero};${fecha};${l.cuenta_codigo};${l.cuenta_nombre};${Number(l.debe).toFixed(2)};${Number(l.haber).toFixed(2)};${(l.linea_concepto || "").replace(/;/g, ",")}`;
      });
      const csv = BOM + [header, ...rows].join("\r\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=diario_contable_${ejercicio || "all"}.csv`);
      return res.send(Buffer.from(csv, "utf-8"));
    }

    if (formato === "a3") {
      // a3CON / a3ECO Movimientos: fichero ASCII de ancho fijo (95 bytes/registro,
      // 1 registro por movimiento). Formato público:
      //   001-008  Asiento (8 numérico, padding ceros)
      //   009-016  Fecha (DDMMAAAA)
      //   017-028  Cuenta (12 alfanumérico, padding espacios derecha)
      //   029-042  Importe (14 numérico, 2 decimales implícitos, padding ceros izq)
      //   043-043  Cargo/Abono ('D'/'H')
      //   044-073  Concepto (30 alfanumérico, padding espacios derecha)
      //   074-085  Documento (12 alfanumérico) — número de factura/justificante
      //   086-093  Tipo (8 alfanumérico) — tipo de asiento
      //   094-095  Departamento (2 alfanumérico) — vacío por defecto
      const padR = (s, n) => String(s ?? '').slice(0, n).padEnd(n, ' ');
      const padL = (s, n, ch = '0') => String(s ?? '').slice(0, n).padStart(n, ch);
      const ddmmaaaa = (d) => {
        const dt = new Date(d);
        const dd = String(dt.getDate()).padStart(2, '0');
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const yy = String(dt.getFullYear());
        return `${dd}${mm}${yy}`;
      };
      const stripAccents = (s) => String(s ?? '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7E]/g, ' ');

      const tipoByAsiento = {};
      for (const a of asientos) tipoByAsiento[a.numero] = a.tipo || '';

      const records = lineas.map(l => {
        const debe = Math.round(Number(l.debe || 0) * 100);
        const haber = Math.round(Number(l.haber || 0) * 100);
        const importe = debe > 0 ? debe : haber;
        const sentido = debe > 0 ? 'D' : 'H';
        const concepto = stripAccents(l.linea_concepto || '').toUpperCase();
        return [
          padL(l.asiento_numero, 8),
          ddmmaaaa(l.asiento_fecha),
          padR(l.cuenta_codigo, 12),
          padL(importe, 14),
          sentido,
          padR(concepto, 30),
          padR('', 12),                                   // Documento (no disponible aún)
          padR(stripAccents(tipoByAsiento[l.asiento_numero] || '').toUpperCase(), 8),
          padR('', 2),                                    // Departamento
        ].join('');
      });
      // a3 espera CRLF y codificación CP1252; usamos ASCII (sin acentos) que es subconjunto.
      const out = records.join('\r\n') + '\r\n';
      res.setHeader('Content-Type', 'text/plain; charset=ascii');
      res.setHeader('Content-Disposition', `attachment; filename=movimientos_a3_${ejercicio || 'all'}.dat`);
      return res.send(Buffer.from(out, 'binary'));
    }

    // Excel format (default) - two sheets: Diario + Libro Mayor resumen
    const wb = new ExcelJS.Workbook();
    wb.creator = "CONTENDO";
    wb.created = new Date();

    // Sheet 1: Libro Diario (lineas expandidas)
    const wsDiario = wb.addWorksheet("Libro Diario");
    wsDiario.columns = [
      { header: "Asiento", key: "asiento", width: 10 },
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Cuenta", key: "cuenta", width: 12 },
      { header: "Nombre Cuenta", key: "nombre", width: 35 },
      { header: "Debe", key: "debe", width: 14 },
      { header: "Haber", key: "haber", width: 14 },
      { header: "Concepto", key: "concepto", width: 40 },
      { header: "Tipo", key: "tipo", width: 15 },
      { header: "Estado", key: "estado", width: 12 },
    ];

    // Style header
    wsDiario.getRow(1).font = { bold: true };
    wsDiario.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };

    // Map asiento info
    const asientoMap = new Map();
    for (const a of asientos) {
      asientoMap.set(a.numero, a);
    }

    for (const l of lineas) {
      const a = asientoMap.get(l.asiento_numero);
      wsDiario.addRow({
        asiento: l.asiento_numero,
        fecha: new Date(l.asiento_fecha),
        cuenta: l.cuenta_codigo,
        nombre: l.cuenta_nombre,
        debe: Number(l.debe),
        haber: Number(l.haber),
        concepto: l.linea_concepto || a?.concepto || "",
        tipo: a?.tipo || "",
        estado: a?.estado || "",
      });
    }

    // Format number columns
    wsDiario.getColumn("debe").numFmt = '#,##0.00';
    wsDiario.getColumn("haber").numFmt = '#,##0.00';
    wsDiario.getColumn("fecha").numFmt = 'dd/mm/yyyy';

    // Sheet 2: Resumen de Asientos
    const wsResumen = wb.addWorksheet("Resumen Asientos");
    wsResumen.columns = [
      { header: "Num", key: "numero", width: 10 },
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Concepto", key: "concepto", width: 45 },
      { header: "Tipo", key: "tipo", width: 15 },
      { header: "Estado", key: "estado", width: 12 },
      { header: "Total Debe", key: "debe", width: 14 },
      { header: "Total Haber", key: "haber", width: 14 },
    ];

    wsResumen.getRow(1).font = { bold: true };
    wsResumen.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };

    // Calculate totals per asiento from lineas
    const totales = new Map();
    for (const l of lineas) {
      const key = l.asiento_numero;
      if (!totales.has(key)) totales.set(key, { debe: 0, haber: 0 });
      totales.get(key).debe += Number(l.debe);
      totales.get(key).haber += Number(l.haber);
    }

    for (const a of asientos) {
      const t = totales.get(a.numero) || { debe: 0, haber: 0 };
      wsResumen.addRow({
        numero: a.numero,
        fecha: new Date(a.fecha),
        concepto: a.concepto,
        tipo: a.tipo,
        estado: a.estado,
        debe: t.debe,
        haber: t.haber,
      });
    }

    wsResumen.getColumn("debe").numFmt = '#,##0.00';
    wsResumen.getColumn("haber").numFmt = '#,##0.00';
    wsResumen.getColumn("fecha").numFmt = 'dd/mm/yyyy';

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=libro_diario_${ejercicio || "all"}.xlsx`);
    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Error exportarAsientos:", err);
    res.status(500).json({ error: "Error exportando asientos" });
  }
}

// =============================================
// IMPORTAR ASIENTOS (CSV / Excel)
// =============================================

export async function importarAsientos(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const creadoPor = req.user.id;

    if (!req.file) {
      return res.status(400).json({ error: "No se ha enviado ningún archivo" });
    }

    const ext = req.file.originalname.toLowerCase();
    let rows = [];

    if (ext.endsWith(".csv")) {
      // Parse CSV (semicolon or comma separated)
      const content = req.file.buffer.toString("utf-8").replace(/^\uFEFF/, "");
      const lines = content.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return res.status(400).json({ error: "CSV vacío o sin datos" });

      const sep = lines[0].includes(";") ? ";" : ",";
      const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));

      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(sep);
        const row = {};
        headers.forEach((h, j) => { row[h] = (vals[j] || "").trim(); });
        rows.push(row);
      }
    } else if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
      // Parse Excel
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer);
      const ws = wb.worksheets[0];
      if (!ws || ws.rowCount < 2) return res.status(400).json({ error: "Excel vacío o sin datos" });

      const headers = [];
      ws.getRow(1).eachCell((cell, colNum) => {
        headers[colNum] = String(cell.value || "").trim().toLowerCase().replace(/\s+/g, "_");
      });

      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const obj = {};
        row.eachCell((cell, colNum) => {
          const key = headers[colNum];
          if (key) obj[key] = cell.value;
        });
        if (Object.keys(obj).length > 0) rows.push(obj);
      });
    } else {
      return res.status(400).json({ error: "Formato no soportado. Usar CSV (.csv) o Excel (.xlsx)" });
    }

    // Normalize column names (support multiple formats)
    const FIELD_MAP = {
      asiento: ["asiento", "num", "numero", "nº", "entry"],
      fecha: ["fecha", "date", "f.asiento"],
      cuenta: ["cuenta", "cuenta_codigo", "codigo", "account", "code"],
      nombre: ["nombre_cuenta", "nombre", "cuenta_nombre", "description", "account_name"],
      debe: ["debe", "debit", "cargo"],
      haber: ["haber", "credit", "abono"],
      concepto: ["concepto", "concept", "description", "descripcion"],
    };

    function findField(row, aliases) {
      for (const alias of aliases) {
        if (row[alias] !== undefined && row[alias] !== "") return row[alias];
      }
      return null;
    }

    // Group rows by asiento number
    const grouped = new Map();
    for (const row of rows) {
      const asientoNum = findField(row, FIELD_MAP.asiento);
      const cuenta = String(findField(row, FIELD_MAP.cuenta) || "").trim();
      const debe = parseFloat(findField(row, FIELD_MAP.debe) || 0) || 0;
      const haber = parseFloat(findField(row, FIELD_MAP.haber) || 0) || 0;

      if (!cuenta || (debe === 0 && haber === 0)) continue;

      const key = asientoNum || `auto_${grouped.size + 1}`;
      if (!grouped.has(key)) {
        let fechaRaw = findField(row, FIELD_MAP.fecha);
        let fecha;
        if (fechaRaw instanceof Date) {
          fecha = fechaRaw.toISOString().split("T")[0];
        } else if (typeof fechaRaw === "string") {
          // Try dd/mm/yyyy or yyyy-mm-dd
          const parts = fechaRaw.split(/[\/\-\.]/);
          if (parts.length === 3) {
            if (parts[0].length === 4) {
              fecha = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
            } else {
              fecha = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
            }
          }
        }
        if (!fecha) fecha = new Date().toISOString().split("T")[0];

        grouped.set(key, {
          fecha,
          concepto: String(findField(row, FIELD_MAP.concepto) || `Asiento importado ${key}`),
          lineas: [],
        });
      }

      grouped.get(key).lineas.push({
        cuenta_codigo: cuenta,
        cuenta_nombre: String(findField(row, FIELD_MAP.nombre) || cuenta),
        debe,
        haber,
        concepto: String(findField(row, FIELD_MAP.concepto) || ""),
      });
    }

    // Process each grouped asiento
    const resultados = { importados: 0, duplicados: 0, errores: [] };

    for (const [key, data] of grouped) {
      try {
        // Validate partida doble
        const totalDebe = data.lineas.reduce((s, l) => s + l.debe, 0);
        const totalHaber = data.lineas.reduce((s, l) => s + l.haber, 0);
        if (Math.abs(totalDebe - totalHaber) > 0.01) {
          resultados.errores.push(`Asiento ${key}: descuadre (Debe: ${totalDebe.toFixed(2)}, Haber: ${totalHaber.toFixed(2)})`);
          continue;
        }

        if (data.lineas.length < 2) {
          resultados.errores.push(`Asiento ${key}: menos de 2 líneas`);
          continue;
        }

        // Check duplicates: same fecha + concepto + total_debe
        const [existing] = await sql`
          SELECT a.id FROM asientos_180 a
          WHERE a.empresa_id = ${empresaId}
            AND a.fecha = ${data.fecha}
            AND a.concepto = ${data.concepto}
            AND a.estado != 'anulado'
            AND EXISTS (
              SELECT 1 FROM asiento_lineas_180 l
              WHERE l.asiento_id = a.id
              GROUP BY l.asiento_id
              HAVING ABS(SUM(l.debe) - ${totalDebe}) < 0.01
            )
          LIMIT 1
        `;

        if (existing) {
          resultados.duplicados++;
          continue;
        }

        // Create asiento
        await contabilidadService.crearAsiento({
          empresaId,
          fecha: data.fecha,
          concepto: data.concepto,
          tipo: "manual",
          creado_por: creadoPor,
          lineas: data.lineas,
        });
        resultados.importados++;
      } catch (err) {
        resultados.errores.push(`Asiento ${key}: ${err.message}`);
      }
    }

    res.json({
      ...resultados,
      total_procesados: grouped.size,
      message: `Importados: ${resultados.importados}, Duplicados: ${resultados.duplicados}, Errores: ${resultados.errores.length}`,
    });
  } catch (err) {
    console.error("Error importarAsientos:", err);
    res.status(500).json({ error: "Error importando asientos" });
  }
}

// =============================================
// RE-REVISAR CUENTAS DE ASIENTOS
// =============================================

export async function revisarAsientos(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { ids, simular } = req.body;
    const soloSimular = simular === true || simular === "true";
    const asientoIds = Array.isArray(ids) ? ids : [];

    const resultado = await contabilidadService.revisarCuentasAsientos(
      empresaId,
      asientoIds,
      soloSimular
    );

    res.json(resultado);
  } catch (err) {
    console.error("Error revisarAsientos:", err);
    res.status(500).json({ error: "Error revisando asientos" });
  }
}

/**
 * Aplica solo los cambios seleccionados por el usuario (sin re-ejecutar IA).
 * Recibe array de cambios con { asiento_id, linea_id, cuenta_nueva: { codigo, nombre } }
 */
export async function aplicarCambiosSelectivos(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { cambios } = req.body;

    if (!Array.isArray(cambios) || cambios.length === 0) {
      return res.status(400).json({ error: "No se enviaron cambios para aplicar" });
    }

    let aplicados = 0;
    const errores = [];

    for (const cambio of cambios) {
      try {
        // Verificar que el asiento pertenece a la empresa
        const [asiento] = await sql`
          SELECT id FROM asientos_180
          WHERE id = ${cambio.asiento_id} AND empresa_id = ${empresaId}
        `;
        if (!asiento) {
          errores.push(`Asiento ${cambio.asiento_id} no encontrado`);
          continue;
        }

        await sql`
          UPDATE asiento_lineas_180
          SET cuenta_codigo = ${cambio.cuenta_nueva.codigo},
              cuenta_nombre = ${cambio.cuenta_nueva.nombre}
          WHERE id = ${cambio.linea_id} AND empresa_id = ${empresaId}
        `;
        await sql`
          UPDATE asientos_180 SET revisado_ia = true WHERE id = ${cambio.asiento_id}
        `;

        // Registrar en historial
        await sql`
          INSERT INTO historial_cambios_asientos_180 (empresa_id, asiento_id, asiento_numero, asiento_concepto, linea_id, tipo_cambio, cuenta_anterior_codigo, cuenta_anterior_nombre, cuenta_nueva_codigo, cuenta_nueva_nombre, importe, realizado_por, origen)
          VALUES (${empresaId}, ${cambio.asiento_id}, ${cambio.numero || null}, ${cambio.concepto || null}, ${cambio.linea_id}, 'cuenta_corregida', ${cambio.cuenta_anterior?.codigo || null}, ${cambio.cuenta_anterior?.nombre || null}, ${cambio.cuenta_nueva.codigo}, ${cambio.cuenta_nueva.nombre}, ${cambio.importe || null}, ${req.user.id}, 'ia_revision')
        `;
        aplicados++;
      } catch (err) {
        errores.push(`Error en asiento ${cambio.asiento_id}: ${err.message}`);
      }
    }

    res.json({ aplicados, errores });
  } catch (err) {
    console.error("Error aplicarCambiosSelectivos:", err);
    res.status(500).json({ error: "Error aplicando correcciones" });
  }
}

/**
 * Marca asientos como revisados por el usuario (no necesitan re-revisión).
 */
export async function marcarRevisadoUsuario(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { ids, revisado = true } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No se enviaron IDs de asientos" });
    }

    await sql`
      UPDATE asientos_180
      SET revisado_usuario = ${revisado}
      WHERE id = ANY(${ids}) AND empresa_id = ${empresaId}
    `;

    res.json({ success: true, actualizados: ids.length });
  } catch (err) {
    console.error("Error marcarRevisadoUsuario:", err);
    res.status(500).json({ error: "Error marcando asientos como revisados" });
  }
}

/**
 * Consulta el historial de cambios aplicados a asientos.
 * Soporta filtros por fecha, asiento_id y tipo_cambio.
 */
export async function obtenerHistorialCambios(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { desde, hasta, asiento_id, tipo_cambio, limit: lim = 50, offset = 0 } = req.query;

    let query = sql`
      SELECT h.*, u.name as realizado_por_nombre
      FROM historial_cambios_asientos_180 h
      LEFT JOIN users u ON u.id = h.realizado_por
      WHERE h.empresa_id = ${empresaId}
    `;

    const conditions = [];
    const params = [];

    // Build dynamic query with conditions
    if (desde) {
      query = sql`
        SELECT h.*, u.name as realizado_por_nombre
        FROM historial_cambios_asientos_180 h
        LEFT JOIN users u ON u.id = h.realizado_por
        WHERE h.empresa_id = ${empresaId}
          AND h.created_at >= ${desde}
          ${hasta ? sql`AND h.created_at <= ${hasta}` : sql``}
          ${asiento_id ? sql`AND h.asiento_id = ${asiento_id}` : sql``}
          ${tipo_cambio ? sql`AND h.tipo_cambio = ${tipo_cambio}` : sql``}
        ORDER BY h.created_at DESC
        LIMIT ${Number(lim)} OFFSET ${Number(offset)}
      `;
    } else {
      query = sql`
        SELECT h.*, u.name as realizado_por_nombre
        FROM historial_cambios_asientos_180 h
        LEFT JOIN users u ON u.id = h.realizado_por
        WHERE h.empresa_id = ${empresaId}
          ${hasta ? sql`AND h.created_at <= ${hasta}` : sql``}
          ${asiento_id ? sql`AND h.asiento_id = ${asiento_id}` : sql``}
          ${tipo_cambio ? sql`AND h.tipo_cambio = ${tipo_cambio}` : sql``}
        ORDER BY h.created_at DESC
        LIMIT ${Number(lim)} OFFSET ${Number(offset)}
      `;
    }

    const cambios = await query;

    // Count total
    const countQuery = await sql`
      SELECT COUNT(*) as total
      FROM historial_cambios_asientos_180
      WHERE empresa_id = ${empresaId}
        ${desde ? sql`AND created_at >= ${desde}` : sql``}
        ${hasta ? sql`AND created_at <= ${hasta}` : sql``}
        ${asiento_id ? sql`AND asiento_id = ${asiento_id}` : sql``}
        ${tipo_cambio ? sql`AND tipo_cambio = ${tipo_cambio}` : sql``}
    `;

    res.json({
      success: true,
      cambios,
      total: Number(countQuery[0]?.total || 0),
    });
  } catch (err) {
    console.error("Error obtenerHistorialCambios:", err);
    res.status(500).json({ error: "Error obteniendo historial de cambios" });
  }
}

// =============================================
// EXPORTACIÓN CONTABLE COMPLETA (FASE C)
// =============================================

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const CURRENCY_FMT = '#,##0.00 "€"';
const DATE_FMT = "DD/MM/YYYY";
const BOM = "\uFEFF";

function styleExportSheet(ws) {
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF000000" } } };
  });
  headerRow.height = 22;
  if (ws.columns && ws.columns.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  }
  ws.columns.forEach((col) => {
    let maxLen = (col.header || "").length;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > maxLen) maxLen = len;
    });
    col.width = Math.min(Math.max(maxLen + 4, 10), 45);
  });
}

/**
 * GET /contabilidad/balance/exportar?fecha=YYYY-MM-DD&formato=excel|csv
 */
export async function exportarBalance(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { fecha, formato = "excel" } = req.query;
    const fechaHasta = fecha || new Date().toISOString().split("T")[0];

    const balance = await contabilidadService.calcularBalance(empresaId, fechaHasta);
    const allCuentas = [
      ...balance.activo.cuentas.map(c => ({ ...c, seccion: "Activo" })),
      ...balance.pasivo.cuentas.map(c => ({ ...c, seccion: "Pasivo" })),
      ...balance.patrimonio.cuentas.map(c => ({ ...c, seccion: "Patrimonio Neto" })),
    ];

    // Compute sumas debe / haber from asiento_lineas for balance
    const sumasRows = await sql`
      SELECT l.cuenta_codigo,
             SUM(l.debe)::numeric AS suma_debe,
             SUM(l.haber)::numeric AS suma_haber,
             (SUM(l.debe) - SUM(l.haber))::numeric AS saldo
      FROM asiento_lineas_180 l
      JOIN asientos_180 a ON a.id = l.asiento_id
      WHERE l.empresa_id = ${empresaId}
        AND a.estado != 'anulado'
        AND a.fecha <= ${fechaHasta}
      GROUP BY l.cuenta_codigo
      HAVING ABS(SUM(l.debe) - SUM(l.haber)) > 0.001
      ORDER BY l.cuenta_codigo
    `;
    const sumasMap = new Map(sumasRows.map(r => [r.cuenta_codigo, r]));

    if (formato === "csv") {
      const header = "Cuenta;Descripcion;Suma Debe;Suma Haber;Saldo Deudor;Saldo Acreedor";
      const rows = sumasRows.map(r => {
        const saldo = Number(r.saldo);
        const deudor = saldo > 0 ? saldo.toFixed(2) : "0.00";
        const acreedor = saldo < 0 ? Math.abs(saldo).toFixed(2) : "0.00";
        const cta = allCuentas.find(c => c.cuenta_codigo === r.cuenta_codigo);
        return `${r.cuenta_codigo};${(cta?.cuenta_nombre || r.cuenta_codigo).replace(/;/g, ",")};${Number(r.suma_debe).toFixed(2)};${Number(r.suma_haber).toFixed(2)};${deudor};${acreedor}`;
      });
      const csv = BOM + [header, ...rows].join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=balance_sumas_saldos_${fechaHasta}.csv`);
      return res.send(Buffer.from(csv, "utf-8"));
    }

    // Excel
    const wb = new ExcelJS.Workbook();
    wb.creator = "CONTENDO";
    const ws = wb.addWorksheet("Balance Sumas y Saldos");
    ws.columns = [
      { header: "Cuenta", key: "cuenta", width: 12 },
      { header: "Descripción", key: "nombre", width: 40 },
      { header: "Sección", key: "seccion", width: 18 },
      { header: "Suma Debe", key: "suma_debe", width: 16 },
      { header: "Suma Haber", key: "suma_haber", width: 16 },
      { header: "Saldo Deudor", key: "saldo_deudor", width: 16 },
      { header: "Saldo Acreedor", key: "saldo_acreedor", width: 16 },
    ];

    for (const c of allCuentas) {
      const sumas = sumasMap.get(c.cuenta_codigo) || { suma_debe: 0, suma_haber: 0, saldo: 0 };
      const saldo = Number(sumas.saldo);
      ws.addRow({
        cuenta: c.cuenta_codigo,
        nombre: c.cuenta_nombre,
        seccion: c.seccion,
        suma_debe: Number(sumas.suma_debe),
        suma_haber: Number(sumas.suma_haber),
        saldo_deudor: saldo > 0 ? saldo : 0,
        saldo_acreedor: saldo < 0 ? Math.abs(saldo) : 0,
      });
    }

    ws.getColumn("suma_debe").numFmt = CURRENCY_FMT;
    ws.getColumn("suma_haber").numFmt = CURRENCY_FMT;
    ws.getColumn("saldo_deudor").numFmt = CURRENCY_FMT;
    ws.getColumn("saldo_acreedor").numFmt = CURRENCY_FMT;
    styleExportSheet(ws);

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=balance_sumas_saldos_${fechaHasta}.xlsx`);
    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Error exportarBalance:", err);
    res.status(500).json({ error: "Error exportando balance" });
  }
}

/**
 * GET /contabilidad/pyg/exportar?fecha_desde=YYYY-MM-DD&fecha_hasta=YYYY-MM-DD&formato=excel|csv
 */
export async function exportarPyG(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { fecha_desde, fecha_hasta, formato = "excel" } = req.query;
    const desde = fecha_desde || `${new Date().getFullYear()}-01-01`;
    const hasta = fecha_hasta || new Date().toISOString().split("T")[0];

    const pyg = await contabilidadService.calcularPyG(empresaId, desde, hasta);

    if (formato === "csv") {
      const header = "Nota;Concepto;Importe";
      const rows = [];
      rows.push(`1;INGRESOS TOTALES;${pyg.ingresos.total.toFixed(2)}`);
      for (const i of pyg.ingresos.cuentas) {
        rows.push(`;${i.cuenta_codigo} - ${i.cuenta_nombre};${i.importe.toFixed(2)}`);
      }
      rows.push(`2;GASTOS TOTALES;${pyg.gastos.total.toFixed(2)}`);
      for (const g of pyg.gastos.cuentas) {
        rows.push(`;${g.cuenta_codigo} - ${g.cuenta_nombre};${g.importe.toFixed(2)}`);
      }
      rows.push(`;;`);
      rows.push(`;RESULTADO DEL EJERCICIO;${pyg.resultado.toFixed(2)}`);
      const csv = BOM + [header, ...rows].join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=pyg_${desde}_${hasta}.csv`);
      return res.send(Buffer.from(csv, "utf-8"));
    }

    // Excel
    const wb = new ExcelJS.Workbook();
    wb.creator = "CONTENDO";
    const ws = wb.addWorksheet("Cuenta PyG");
    ws.columns = [
      { header: "Nota", key: "nota", width: 8 },
      { header: "Concepto", key: "concepto", width: 50 },
      { header: "Importe", key: "importe", width: 18 },
    ];

    ws.addRow({ nota: "1", concepto: "INGRESOS DE EXPLOTACIÓN", importe: pyg.ingresos.total });
    ws.getRow(ws.rowCount).font = { bold: true };
    for (const i of pyg.ingresos.cuentas) {
      ws.addRow({ nota: "", concepto: `  ${i.cuenta_codigo} - ${i.cuenta_nombre}`, importe: i.importe });
    }
    ws.addRow({});
    ws.addRow({ nota: "2", concepto: "GASTOS DE EXPLOTACIÓN", importe: -pyg.gastos.total });
    ws.getRow(ws.rowCount).font = { bold: true };
    for (const g of pyg.gastos.cuentas) {
      ws.addRow({ nota: "", concepto: `  ${g.cuenta_codigo} - ${g.cuenta_nombre}`, importe: -g.importe });
    }
    ws.addRow({});
    const resRow = ws.addRow({ nota: "", concepto: "RESULTADO DEL EJERCICIO", importe: pyg.resultado });
    resRow.font = { bold: true, size: 12 };
    resRow.getCell("importe").fill = { type: "pattern", pattern: "solid", fgColor: { argb: pyg.resultado >= 0 ? "FFD4EDDA" : "FFF8D7DA" } };

    ws.getColumn("importe").numFmt = CURRENCY_FMT;
    styleExportSheet(ws);

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=pyg_${desde}_${hasta}.xlsx`);
    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Error exportarPyG:", err);
    res.status(500).json({ error: "Error exportando PyG" });
  }
}

/**
 * GET /contabilidad/mayor/exportar?cuenta_codigo=XXX&fecha_desde=YYYY-MM-DD&fecha_hasta=YYYY-MM-DD&formato=excel|csv
 */
export async function exportarMayor(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { cuenta_codigo, fecha_desde, fecha_hasta, formato = "excel" } = req.query;
    const desde = fecha_desde || `${new Date().getFullYear()}-01-01`;
    const hasta = fecha_hasta || new Date().toISOString().split("T")[0];

    // If cuenta_codigo specified, export single account; otherwise export ALL accounts
    let cuentas;
    if (cuenta_codigo) {
      cuentas = [cuenta_codigo];
    } else {
      const rows = await sql`
        SELECT DISTINCT l.cuenta_codigo
        FROM asiento_lineas_180 l
        JOIN asientos_180 a ON a.id = l.asiento_id
        WHERE l.empresa_id = ${empresaId}
          AND a.estado != 'anulado'
          AND a.fecha >= ${desde} AND a.fecha <= ${hasta}
        ORDER BY l.cuenta_codigo
      `;
      cuentas = rows.map(r => r.cuenta_codigo);
    }

    // Collect all movements
    const allMovimientos = [];
    for (const cc of cuentas) {
      const mayor = await contabilidadService.libroMayor(empresaId, cc, desde, hasta);
      for (const m of mayor.movimientos) {
        allMovimientos.push({
          cuenta_codigo: cc,
          cuenta_nombre: mayor.cuenta_nombre || cc,
          ...m,
        });
      }
    }

    if (formato === "csv") {
      const header = "Cuenta;Descripcion;Fecha;Asiento;Concepto;Debe;Haber;Saldo;Documento";
      const rows = allMovimientos.map(m => {
        const fecha = new Date(m.fecha).toLocaleDateString("es-ES");
        return `${m.cuenta_codigo};${(m.cuenta_nombre || "").replace(/;/g, ",")};${fecha};${m.asiento_numero};${(m.linea_concepto || m.asiento_concepto || "").replace(/;/g, ",")};${Number(m.debe).toFixed(2)};${Number(m.haber).toFixed(2)};${Number(m.saldo_acumulado).toFixed(2)};`;
      });
      const csv = BOM + [header, ...rows].join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=libro_mayor_${desde}_${hasta}.csv`);
      return res.send(Buffer.from(csv, "utf-8"));
    }

    // Excel
    const wb = new ExcelJS.Workbook();
    wb.creator = "CONTENDO";
    const ws = wb.addWorksheet("Libro Mayor");
    ws.columns = [
      { header: "Cuenta", key: "cuenta", width: 12 },
      { header: "Descripción", key: "nombre", width: 35 },
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Asiento", key: "asiento", width: 10 },
      { header: "Concepto", key: "concepto", width: 40 },
      { header: "Debe", key: "debe", width: 16 },
      { header: "Haber", key: "haber", width: 16 },
      { header: "Saldo", key: "saldo", width: 16 },
    ];

    for (const m of allMovimientos) {
      ws.addRow({
        cuenta: m.cuenta_codigo,
        nombre: m.cuenta_nombre,
        fecha: new Date(m.fecha),
        asiento: m.asiento_numero,
        concepto: m.linea_concepto || m.asiento_concepto || "",
        debe: Number(m.debe),
        haber: Number(m.haber),
        saldo: Number(m.saldo_acumulado),
      });
    }

    ws.getColumn("debe").numFmt = CURRENCY_FMT;
    ws.getColumn("haber").numFmt = CURRENCY_FMT;
    ws.getColumn("saldo").numFmt = CURRENCY_FMT;
    ws.getColumn("fecha").numFmt = DATE_FMT;
    styleExportSheet(ws);

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=libro_mayor_${desde}_${hasta}.xlsx`);
    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Error exportarMayor:", err);
    res.status(500).json({ error: "Error exportando libro mayor" });
  }
}

/**
 * GET /contabilidad/cuentas/exportar?grupo=X&tipo=X&activa=true&formato=excel|csv
 */
export async function exportarCuentas(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { grupo, tipo, activa, formato = "excel" } = req.query;

    const cuentas = await sql`
      SELECT codigo, nombre, tipo, grupo, subgrupo, nivel, padre_codigo, activa, es_estandar
      FROM pgc_cuentas_180
      WHERE empresa_id = ${empresaId}
        ${grupo ? sql`AND grupo = ${parseInt(grupo)}` : sql``}
        ${tipo ? sql`AND tipo = ${tipo}` : sql``}
        ${activa !== undefined ? sql`AND activa = ${activa === "true"}` : sql``}
      ORDER BY codigo
    `;

    if (formato === "csv") {
      const header = "Cuenta;Descripcion;Tipo;Grupo;Activa";
      const rows = cuentas.map(c =>
        `${c.codigo};${(c.nombre || "").replace(/;/g, ",")};${c.tipo || ""};${c.grupo || ""};${c.activa ? "Si" : "No"}`
      );
      const csv = BOM + [header, ...rows].join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=plan_cuentas.csv");
      return res.send(Buffer.from(csv, "utf-8"));
    }

    // Excel
    const wb = new ExcelJS.Workbook();
    wb.creator = "CONTENDO";
    const ws = wb.addWorksheet("Plan de Cuentas");
    ws.columns = [
      { header: "Cuenta", key: "codigo", width: 12 },
      { header: "Descripción", key: "nombre", width: 45 },
      { header: "Tipo", key: "tipo", width: 15 },
      { header: "Grupo", key: "grupo", width: 8 },
      { header: "Subgrupo", key: "subgrupo", width: 10 },
      { header: "Nivel", key: "nivel", width: 8 },
      { header: "Cuenta Padre", key: "padre", width: 12 },
      { header: "Activa", key: "activa", width: 8 },
      { header: "Estándar", key: "estandar", width: 10 },
    ];

    for (const c of cuentas) {
      ws.addRow({
        codigo: c.codigo,
        nombre: c.nombre,
        tipo: c.tipo,
        grupo: c.grupo,
        subgrupo: c.subgrupo,
        nivel: c.nivel,
        padre: c.padre_codigo,
        activa: c.activa ? "Sí" : "No",
        estandar: c.es_estandar ? "Sí" : "No",
      });
    }

    styleExportSheet(ws);

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=plan_cuentas.xlsx");
    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Error exportarCuentas:", err);
    res.status(500).json({ error: "Error exportando cuentas" });
  }
}

/**
 * GET /contabilidad/exportar-paquete?fecha_desde=YYYY-MM-DD&fecha_hasta=YYYY-MM-DD
 * Downloads a ZIP with all accounting exports (Excel + CSV)
 */
export async function exportarPaquete(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { fecha_desde, fecha_hasta } = req.query;
    const desde = fecha_desde || `${new Date().getFullYear()}-01-01`;
    const hasta = fecha_hasta || new Date().toISOString().split("T")[0];

    // Helper to build Excel buffer for a given build function
    async function buildExcelBuffer(buildFn) {
      const wb = new ExcelJS.Workbook();
      wb.creator = "CONTENDO";
      await buildFn(wb);
      return await wb.xlsx.writeBuffer();
    }

    // 1. Libro Diario
    const asientos = await sql`
      SELECT a.numero, a.fecha, a.concepto, a.tipo, a.estado
      FROM asientos_180 a
      WHERE a.empresa_id = ${empresaId}
        AND a.fecha >= ${desde} AND a.fecha <= ${hasta}
        AND a.estado != 'anulado'
      ORDER BY a.fecha ASC, a.numero ASC
    `;
    const lineas = asientos.length > 0 ? await sql`
      SELECT l.cuenta_codigo, l.cuenta_nombre, l.debe, l.haber, l.concepto AS linea_concepto, l.orden,
             a.numero AS asiento_numero, a.fecha AS asiento_fecha, a.concepto AS asiento_concepto, a.tipo, a.estado
      FROM asiento_lineas_180 l
      JOIN asientos_180 a ON a.id = l.asiento_id
      WHERE a.empresa_id = ${empresaId}
        AND a.fecha >= ${desde} AND a.fecha <= ${hasta}
        AND a.estado != 'anulado'
      ORDER BY a.fecha, a.numero, l.orden
    ` : [];

    // Build Diario Excel
    const diarioXlsx = await buildExcelBuffer(async (wb) => {
      const ws = wb.addWorksheet("Libro Diario");
      ws.columns = [
        { header: "Asiento", key: "asiento", width: 10 },
        { header: "Fecha", key: "fecha", width: 12 },
        { header: "Cuenta", key: "cuenta", width: 12 },
        { header: "Nombre Cuenta", key: "nombre", width: 35 },
        { header: "Debe", key: "debe", width: 16 },
        { header: "Haber", key: "haber", width: 16 },
        { header: "Concepto", key: "concepto", width: 40 },
        { header: "Documento", key: "documento", width: 15 },
      ];
      for (const l of lineas) {
        ws.addRow({
          asiento: l.asiento_numero, fecha: new Date(l.asiento_fecha),
          cuenta: l.cuenta_codigo, nombre: l.cuenta_nombre,
          debe: Number(l.debe), haber: Number(l.haber),
          concepto: l.linea_concepto || l.asiento_concepto || "", documento: l.tipo || "",
        });
      }
      ws.getColumn("debe").numFmt = CURRENCY_FMT;
      ws.getColumn("haber").numFmt = CURRENCY_FMT;
      ws.getColumn("fecha").numFmt = DATE_FMT;
      styleExportSheet(ws);
    });

    // Diario CSV
    const diarioCsvHeader = "Asiento;Fecha;Cuenta;Nombre Cuenta;Debe;Haber;Concepto;Documento";
    const diarioCsvRows = lineas.map(l => {
      const fecha = new Date(l.asiento_fecha).toLocaleDateString("es-ES");
      return `${l.asiento_numero};${fecha};${l.cuenta_codigo};${(l.cuenta_nombre || "").replace(/;/g, ",")};${Number(l.debe).toFixed(2)};${Number(l.haber).toFixed(2)};${(l.linea_concepto || "").replace(/;/g, ",")};${l.tipo || ""}`;
    });
    const diarioCsv = BOM + [diarioCsvHeader, ...diarioCsvRows].join("\r\n");

    // 2. Balance
    const balance = await contabilidadService.calcularBalance(empresaId, hasta);
    const sumasRows = await sql`
      SELECT l.cuenta_codigo, l.cuenta_nombre,
             SUM(l.debe)::numeric AS suma_debe, SUM(l.haber)::numeric AS suma_haber,
             (SUM(l.debe) - SUM(l.haber))::numeric AS saldo
      FROM asiento_lineas_180 l JOIN asientos_180 a ON a.id = l.asiento_id
      WHERE l.empresa_id = ${empresaId} AND a.estado != 'anulado' AND a.fecha <= ${hasta}
      GROUP BY l.cuenta_codigo, l.cuenta_nombre
      HAVING ABS(SUM(l.debe) - SUM(l.haber)) > 0.001
      ORDER BY l.cuenta_codigo
    `;

    const balanceXlsx = await buildExcelBuffer(async (wb) => {
      const ws = wb.addWorksheet("Balance Sumas y Saldos");
      ws.columns = [
        { header: "Cuenta", key: "cuenta", width: 12 },
        { header: "Descripción", key: "nombre", width: 40 },
        { header: "Suma Debe", key: "suma_debe", width: 16 },
        { header: "Suma Haber", key: "suma_haber", width: 16 },
        { header: "Saldo Deudor", key: "saldo_deudor", width: 16 },
        { header: "Saldo Acreedor", key: "saldo_acreedor", width: 16 },
      ];
      for (const r of sumasRows) {
        const saldo = Number(r.saldo);
        ws.addRow({
          cuenta: r.cuenta_codigo, nombre: r.cuenta_nombre,
          suma_debe: Number(r.suma_debe), suma_haber: Number(r.suma_haber),
          saldo_deudor: saldo > 0 ? saldo : 0, saldo_acreedor: saldo < 0 ? Math.abs(saldo) : 0,
        });
      }
      ["suma_debe", "suma_haber", "saldo_deudor", "saldo_acreedor"].forEach(k => ws.getColumn(k).numFmt = CURRENCY_FMT);
      styleExportSheet(ws);
    });

    const balanceCsvHeader = "Cuenta;Descripcion;Suma Debe;Suma Haber;Saldo Deudor;Saldo Acreedor";
    const balanceCsvRows = sumasRows.map(r => {
      const saldo = Number(r.saldo);
      return `${r.cuenta_codigo};${(r.cuenta_nombre || "").replace(/;/g, ",")};${Number(r.suma_debe).toFixed(2)};${Number(r.suma_haber).toFixed(2)};${saldo > 0 ? saldo.toFixed(2) : "0.00"};${saldo < 0 ? Math.abs(saldo).toFixed(2) : "0.00"}`;
    });
    const balanceCsv = BOM + [balanceCsvHeader, ...balanceCsvRows].join("\r\n");

    // 3. PyG
    const pyg = await contabilidadService.calcularPyG(empresaId, desde, hasta);

    const pygXlsx = await buildExcelBuffer(async (wb) => {
      const ws = wb.addWorksheet("Cuenta PyG");
      ws.columns = [
        { header: "Nota", key: "nota", width: 8 },
        { header: "Concepto", key: "concepto", width: 50 },
        { header: "Importe", key: "importe", width: 18 },
      ];
      ws.addRow({ nota: "1", concepto: "INGRESOS DE EXPLOTACIÓN", importe: pyg.ingresos.total });
      ws.getRow(ws.rowCount).font = { bold: true };
      for (const i of pyg.ingresos.cuentas) ws.addRow({ concepto: `  ${i.cuenta_codigo} - ${i.cuenta_nombre}`, importe: i.importe });
      ws.addRow({});
      ws.addRow({ nota: "2", concepto: "GASTOS DE EXPLOTACIÓN", importe: -pyg.gastos.total });
      ws.getRow(ws.rowCount).font = { bold: true };
      for (const g of pyg.gastos.cuentas) ws.addRow({ concepto: `  ${g.cuenta_codigo} - ${g.cuenta_nombre}`, importe: -g.importe });
      ws.addRow({});
      ws.addRow({ concepto: "RESULTADO DEL EJERCICIO", importe: pyg.resultado });
      ws.getRow(ws.rowCount).font = { bold: true, size: 12 };
      ws.getColumn("importe").numFmt = CURRENCY_FMT;
      styleExportSheet(ws);
    });

    const pygCsvHeader = "Nota;Concepto;Importe";
    const pygCsvRows = [];
    pygCsvRows.push(`1;INGRESOS TOTALES;${pyg.ingresos.total.toFixed(2)}`);
    for (const i of pyg.ingresos.cuentas) pygCsvRows.push(`;${i.cuenta_codigo} - ${i.cuenta_nombre};${i.importe.toFixed(2)}`);
    pygCsvRows.push(`2;GASTOS TOTALES;${pyg.gastos.total.toFixed(2)}`);
    for (const g of pyg.gastos.cuentas) pygCsvRows.push(`;${g.cuenta_codigo} - ${g.cuenta_nombre};${g.importe.toFixed(2)}`);
    pygCsvRows.push(`;;`);
    pygCsvRows.push(`;RESULTADO DEL EJERCICIO;${pyg.resultado.toFixed(2)}`);
    const pygCsv = BOM + [pygCsvHeader, ...pygCsvRows].join("\r\n");

    // 4. Libro Mayor (all accounts)
    const cuentasConMovimientos = await sql`
      SELECT DISTINCT l.cuenta_codigo
      FROM asiento_lineas_180 l JOIN asientos_180 a ON a.id = l.asiento_id
      WHERE l.empresa_id = ${empresaId} AND a.estado != 'anulado'
        AND a.fecha >= ${desde} AND a.fecha <= ${hasta}
      ORDER BY l.cuenta_codigo
    `;

    const mayorData = [];
    for (const { cuenta_codigo } of cuentasConMovimientos) {
      const mayor = await contabilidadService.libroMayor(empresaId, cuenta_codigo, desde, hasta);
      for (const m of mayor.movimientos) {
        mayorData.push({ cuenta_codigo, ...m });
      }
    }

    const mayorXlsx = await buildExcelBuffer(async (wb) => {
      const ws = wb.addWorksheet("Libro Mayor");
      ws.columns = [
        { header: "Cuenta", key: "cuenta", width: 12 },
        { header: "Fecha", key: "fecha", width: 12 },
        { header: "Asiento", key: "asiento", width: 10 },
        { header: "Concepto", key: "concepto", width: 40 },
        { header: "Debe", key: "debe", width: 16 },
        { header: "Haber", key: "haber", width: 16 },
        { header: "Saldo", key: "saldo", width: 16 },
      ];
      for (const m of mayorData) {
        ws.addRow({
          cuenta: m.cuenta_codigo, fecha: new Date(m.fecha), asiento: m.asiento_numero,
          concepto: m.linea_concepto || m.asiento_concepto || "",
          debe: Number(m.debe), haber: Number(m.haber), saldo: Number(m.saldo_acumulado),
        });
      }
      ["debe", "haber", "saldo"].forEach(k => ws.getColumn(k).numFmt = CURRENCY_FMT);
      ws.getColumn("fecha").numFmt = DATE_FMT;
      styleExportSheet(ws);
    });

    const mayorCsvHeader = "Cuenta;Fecha;Asiento;Concepto;Debe;Haber;Saldo";
    const mayorCsvRows = mayorData.map(m => {
      const fecha = new Date(m.fecha).toLocaleDateString("es-ES");
      return `${m.cuenta_codigo};${fecha};${m.asiento_numero};${(m.linea_concepto || m.asiento_concepto || "").replace(/;/g, ",")};${Number(m.debe).toFixed(2)};${Number(m.haber).toFixed(2)};${Number(m.saldo_acumulado).toFixed(2)}`;
    });
    const mayorCsv = BOM + [mayorCsvHeader, ...mayorCsvRows].join("\r\n");

    // 5. Plan de Cuentas
    const planCuentas = await sql`
      SELECT codigo, nombre, tipo, grupo, activa FROM pgc_cuentas_180
      WHERE empresa_id = ${empresaId} ORDER BY codigo
    `;

    const planXlsx = await buildExcelBuffer(async (wb) => {
      const ws = wb.addWorksheet("Plan de Cuentas");
      ws.columns = [
        { header: "Cuenta", key: "codigo", width: 12 },
        { header: "Descripción", key: "nombre", width: 45 },
        { header: "Tipo", key: "tipo", width: 15 },
        { header: "Grupo", key: "grupo", width: 8 },
        { header: "Activa", key: "activa", width: 8 },
      ];
      for (const c of planCuentas) {
        ws.addRow({ codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, grupo: c.grupo, activa: c.activa ? "Sí" : "No" });
      }
      styleExportSheet(ws);
    });

    const planCsvHeader = "Cuenta;Descripcion;Tipo;Grupo;Activa";
    const planCsvRows = planCuentas.map(c =>
      `${c.codigo};${(c.nombre || "").replace(/;/g, ",")};${c.tipo || ""};${c.grupo || ""};${c.activa ? "Si" : "No"}`
    );
    const planCsv = BOM + [planCsvHeader, ...planCsvRows].join("\r\n");

    // Build ZIP
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=paquete_contable_${desde}_${hasta}.zip`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    archive.append(Buffer.from(diarioXlsx), { name: "libro_diario.xlsx" });
    archive.append(Buffer.from(balanceXlsx), { name: "balance_sumas_saldos.xlsx" });
    archive.append(Buffer.from(pygXlsx), { name: "cuenta_pyg.xlsx" });
    archive.append(Buffer.from(mayorXlsx), { name: "libro_mayor.xlsx" });
    archive.append(Buffer.from(planXlsx), { name: "plan_cuentas.xlsx" });
    archive.append(Buffer.from(diarioCsv, "utf-8"), { name: "csv/libro_diario.csv" });
    archive.append(Buffer.from(balanceCsv, "utf-8"), { name: "csv/balance.csv" });
    archive.append(Buffer.from(pygCsv, "utf-8"), { name: "csv/pyg.csv" });
    archive.append(Buffer.from(mayorCsv, "utf-8"), { name: "csv/mayor.csv" });
    archive.append(Buffer.from(planCsv, "utf-8"), { name: "csv/plan_cuentas.csv" });

    await archive.finalize();
  } catch (err) {
    console.error("Error exportarPaquete:", err);
    if (!res.headersSent) res.status(500).json({ error: "Error exportando paquete contable" });
  }
}
