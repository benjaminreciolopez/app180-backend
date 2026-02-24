// backend/src/controllers/contabilidadController.js
import { sql } from "../db.js";
import * as contabilidadService from "../services/contabilidadService.js";

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
    } else {
      cuentas = await sql`
        SELECT * FROM pgc_cuentas_180
        WHERE empresa_id = ${empresaId}
          ${grupo ? sql`AND grupo = ${parseInt(grupo)}` : sql``}
          ${tipo ? sql`AND tipo = ${tipo}` : sql``}
          ${activa !== undefined ? sql`AND activa = ${activa === "true"}` : sql``}
        ORDER BY codigo
      `;
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
    res.json(cuenta);
  } catch (err) {
    console.error("Error actualizarCuenta:", err);
    res.status(500).json({ error: "Error actualizando cuenta" });
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
    const { ejercicio, fecha_desde, fecha_hasta, tipo, estado, page = 1, limit = 50, sort_field, sort_dir } = req.query;
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
      ORDER BY ${orderClause}
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `;

    const [{ total }] = await sql`
      SELECT count(*)::int AS total FROM asientos_180
      WHERE empresa_id = ${empresaId}
        ${ejercicio ? sql`AND ejercicio = ${parseInt(ejercicio)}` : sql``}
        ${fecha_desde ? sql`AND fecha >= ${fecha_desde}` : sql``}
        ${fecha_hasta ? sql`AND fecha <= ${fecha_hasta}` : sql``}
        ${tipo ? sql`AND tipo = ${tipo}` : sql``}
        ${estado ? sql`AND estado = ${estado}` : sql``}
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

    // Solo se pueden editar borradores
    const [existing] = await sql`
      SELECT estado FROM asientos_180
      WHERE id = ${id} AND empresa_id = ${empresaId}
    `;

    if (!existing) return res.status(404).json({ error: "Asiento no encontrado" });
    if (existing.estado !== "borrador") {
      return res.status(400).json({ error: "Solo se pueden editar asientos en borrador" });
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
