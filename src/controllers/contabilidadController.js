// backend/src/controllers/contabilidadController.js
import { sql } from "../db.js";
import * as contabilidadService from "../services/contabilidadService.js";
import ExcelJS from "exceljs";

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
