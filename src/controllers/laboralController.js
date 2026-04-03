// backend/src/controllers/laboralController.js
// Gestión laboral profesional: contratos, bajas, cotizaciones SS

import { sql } from "../db.js";
import logger from "../utils/logger.js";

// ============================================================
// CONTRATOS
// ============================================================

/**
 * GET /asesor/clientes/:empresa_id/contratos
 * Lista contratos con datos del empleado
 */
export async function getContratos(req, res) {
  try {
    const empresaId = req.params.empresa_id;
    const { estado, employee_id } = req.query;

    let rows;
    if (estado && employee_id) {
      rows = await sql`
        SELECT c.*,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado,
               e.dni, e.puesto
        FROM contratos_180 c
        JOIN employees_180 e ON c.employee_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        WHERE c.empresa_id = ${empresaId}
          AND c.estado = ${estado}
          AND c.employee_id = ${employee_id}
        ORDER BY c.fecha_inicio DESC
      `;
    } else if (estado) {
      rows = await sql`
        SELECT c.*,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado,
               e.dni, e.puesto
        FROM contratos_180 c
        JOIN employees_180 e ON c.employee_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        WHERE c.empresa_id = ${empresaId}
          AND c.estado = ${estado}
        ORDER BY c.fecha_inicio DESC
      `;
    } else if (employee_id) {
      rows = await sql`
        SELECT c.*,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado,
               e.dni, e.puesto
        FROM contratos_180 c
        JOIN employees_180 e ON c.employee_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        WHERE c.empresa_id = ${empresaId}
          AND c.employee_id = ${employee_id}
        ORDER BY c.fecha_inicio DESC
      `;
    } else {
      rows = await sql`
        SELECT c.*,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado,
               e.dni, e.puesto
        FROM contratos_180 c
        JOIN employees_180 e ON c.employee_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        WHERE c.empresa_id = ${empresaId}
        ORDER BY c.fecha_inicio DESC
      `;
    }

    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error("getContratos error", { error: err.message });
    res.status(500).json({ error: "Error obteniendo contratos" });
  }
}

/**
 * POST /asesor/clientes/:empresa_id/contratos
 */
export async function createContrato(req, res) {
  try {
    const empresaId = req.params.empresa_id;
    const {
      employee_id, tipo_contrato, codigo_contrato, jornada, horas_semanales,
      fecha_inicio, fecha_fin, fecha_fin_prevista, periodo_prueba_dias,
      salario_bruto_anual, salario_bruto_mensual, num_pagas,
      convenio_colectivo, categoria_profesional, grupo_cotizacion,
      epigrafes_at, coeficiente_parcialidad, es_bonificado,
      tipo_bonificacion, importe_bonificacion, notas,
    } = req.body;

    if (!employee_id || !tipo_contrato || !fecha_inicio) {
      return res.status(400).json({ error: "employee_id, tipo_contrato y fecha_inicio son requeridos" });
    }

    // Calculate periodo_prueba_fin if days given
    let periodoPruebaFin = null;
    if (periodo_prueba_dias && fecha_inicio) {
      const d = new Date(fecha_inicio);
      d.setDate(d.getDate() + parseInt(periodo_prueba_dias));
      periodoPruebaFin = d.toISOString().split("T")[0];
    }

    const [row] = await sql`
      INSERT INTO contratos_180 (
        empresa_id, employee_id, tipo_contrato, codigo_contrato, jornada,
        horas_semanales, fecha_inicio, fecha_fin, fecha_fin_prevista,
        periodo_prueba_dias, periodo_prueba_fin, salario_bruto_anual,
        salario_bruto_mensual, num_pagas, convenio_colectivo,
        categoria_profesional, grupo_cotizacion, epigrafes_at,
        coeficiente_parcialidad, es_bonificado, tipo_bonificacion,
        importe_bonificacion, notas
      ) VALUES (
        ${empresaId}, ${employee_id}, ${tipo_contrato}, ${codigo_contrato || null},
        ${jornada || "completa"}, ${horas_semanales || 40},
        ${fecha_inicio}, ${fecha_fin || null}, ${fecha_fin_prevista || null},
        ${periodo_prueba_dias || null}, ${periodoPruebaFin},
        ${salario_bruto_anual || null}, ${salario_bruto_mensual || null},
        ${num_pagas || 14}, ${convenio_colectivo || null},
        ${categoria_profesional || null}, ${grupo_cotizacion || null},
        ${epigrafes_at || null}, ${coeficiente_parcialidad || null},
        ${es_bonificado || false}, ${tipo_bonificacion || null},
        ${importe_bonificacion || null}, ${notas || null}
      )
      RETURNING *
    `;

    res.status(201).json({ success: true, data: row });
  } catch (err) {
    logger.error("createContrato error", { error: err.message });
    res.status(500).json({ error: "Error creando contrato" });
  }
}

/**
 * PUT /asesor/clientes/:empresa_id/contratos/:id
 */
export async function updateContrato(req, res) {
  try {
    const { empresa_id, id } = req.params;
    const {
      tipo_contrato, codigo_contrato, jornada, horas_semanales,
      fecha_inicio, fecha_fin, fecha_fin_prevista, periodo_prueba_dias,
      salario_bruto_anual, salario_bruto_mensual, num_pagas,
      convenio_colectivo, categoria_profesional, grupo_cotizacion,
      epigrafes_at, coeficiente_parcialidad, es_bonificado,
      tipo_bonificacion, importe_bonificacion, estado, notas,
    } = req.body;

    let periodoPruebaFin = null;
    if (periodo_prueba_dias && fecha_inicio) {
      const d = new Date(fecha_inicio);
      d.setDate(d.getDate() + parseInt(periodo_prueba_dias));
      periodoPruebaFin = d.toISOString().split("T")[0];
    }

    const [row] = await sql`
      UPDATE contratos_180 SET
        tipo_contrato = COALESCE(${tipo_contrato || null}, tipo_contrato),
        codigo_contrato = ${codigo_contrato !== undefined ? codigo_contrato : null},
        jornada = COALESCE(${jornada || null}, jornada),
        horas_semanales = COALESCE(${horas_semanales || null}, horas_semanales),
        fecha_inicio = COALESCE(${fecha_inicio || null}, fecha_inicio),
        fecha_fin = ${fecha_fin !== undefined ? fecha_fin : null},
        fecha_fin_prevista = ${fecha_fin_prevista !== undefined ? fecha_fin_prevista : null},
        periodo_prueba_dias = ${periodo_prueba_dias !== undefined ? periodo_prueba_dias : null},
        periodo_prueba_fin = ${periodoPruebaFin},
        salario_bruto_anual = ${salario_bruto_anual !== undefined ? salario_bruto_anual : null},
        salario_bruto_mensual = ${salario_bruto_mensual !== undefined ? salario_bruto_mensual : null},
        num_pagas = COALESCE(${num_pagas || null}, num_pagas),
        convenio_colectivo = ${convenio_colectivo !== undefined ? convenio_colectivo : null},
        categoria_profesional = ${categoria_profesional !== undefined ? categoria_profesional : null},
        grupo_cotizacion = ${grupo_cotizacion !== undefined ? grupo_cotizacion : null},
        epigrafes_at = ${epigrafes_at !== undefined ? epigrafes_at : null},
        coeficiente_parcialidad = ${coeficiente_parcialidad !== undefined ? coeficiente_parcialidad : null},
        es_bonificado = COALESCE(${es_bonificado !== undefined ? es_bonificado : null}, es_bonificado),
        tipo_bonificacion = ${tipo_bonificacion !== undefined ? tipo_bonificacion : null},
        importe_bonificacion = ${importe_bonificacion !== undefined ? importe_bonificacion : null},
        estado = COALESCE(${estado || null}, estado),
        notas = ${notas !== undefined ? notas : null},
        updated_at = now()
      WHERE id = ${id} AND empresa_id = ${empresa_id}
      RETURNING *
    `;

    if (!row) return res.status(404).json({ error: "Contrato no encontrado" });
    res.json({ success: true, data: row });
  } catch (err) {
    logger.error("updateContrato error", { error: err.message });
    res.status(500).json({ error: "Error actualizando contrato" });
  }
}

/**
 * POST /asesor/clientes/:empresa_id/contratos/:id/extinguir
 */
export async function extinguirContrato(req, res) {
  try {
    const { empresa_id, id } = req.params;
    const { motivo_extincion, fecha_extincion } = req.body;

    if (!motivo_extincion || !fecha_extincion) {
      return res.status(400).json({ error: "motivo_extincion y fecha_extincion son requeridos" });
    }

    const [row] = await sql`
      UPDATE contratos_180 SET
        estado = 'extinguido',
        motivo_extincion = ${motivo_extincion},
        fecha_extincion = ${fecha_extincion},
        updated_at = now()
      WHERE id = ${id} AND empresa_id = ${empresa_id}
      RETURNING *
    `;

    if (!row) return res.status(404).json({ error: "Contrato no encontrado" });
    res.json({ success: true, data: row });
  } catch (err) {
    logger.error("extinguirContrato error", { error: err.message });
    res.status(500).json({ error: "Error extinguiendo contrato" });
  }
}

/**
 * POST /asesor/clientes/:empresa_id/contratos/:id/finiquito
 * Calcula finiquito: vacaciones pendientes, pagas extra proporcionales, indemnizacion
 */
export async function calcularFiniquito(req, res) {
  try {
    const { empresa_id, id } = req.params;
    const { fecha_extincion, motivo_extincion, dias_vacaciones_disfrutados } = req.body;

    // Get contract data
    const [contrato] = await sql`
      SELECT c.*,
             COALESCE(u.nombre, e.nombre) AS nombre_empleado
      FROM contratos_180 c
      JOIN employees_180 e ON c.employee_id = e.id
      LEFT JOIN users_180 u ON e.user_id = u.id
      WHERE c.id = ${id} AND c.empresa_id = ${empresa_id}
    `;

    if (!contrato) return res.status(404).json({ error: "Contrato no encontrado" });

    const fechaExt = new Date(fecha_extincion || contrato.fecha_extincion || new Date());
    const fechaInicio = new Date(contrato.fecha_inicio);
    const salarioBrutoAnual = parseFloat(contrato.salario_bruto_anual) || 0;
    const salarioBrutoMensual = parseFloat(contrato.salario_bruto_mensual) || (salarioBrutoAnual / (contrato.num_pagas || 14));
    const salarioDiario = salarioBrutoAnual / 365;
    const numPagas = contrato.num_pagas || 14;
    const pagasExtra = numPagas - 12; // normally 2

    // --- 1. Dias trabajados en el año actual ---
    const inicioAnio = new Date(fechaExt.getFullYear(), 0, 1);
    const inicioCalc = fechaInicio > inicioAnio ? fechaInicio : inicioAnio;
    const diasTrabajadosAnio = Math.ceil((fechaExt - inicioCalc) / (1000 * 60 * 60 * 24)) + 1;

    // --- 2. Vacaciones pendientes ---
    const diasVacacionesAnuales = 30; // dias naturales por convenio (standard)
    const diasVacacionesDevengados = Math.round((diasVacacionesAnuales * diasTrabajadosAnio) / 365);
    const diasVacDisfrutados = parseInt(dias_vacaciones_disfrutados) || 0;
    const diasVacacionesPendientes = Math.max(0, diasVacacionesDevengados - diasVacDisfrutados);
    const importeVacaciones = diasVacacionesPendientes * salarioDiario;

    // --- 3. Parte proporcional pagas extra ---
    // Each extra pay accrues over 6 months (semestral) or 12 months (anual)
    // Standard: 2 pagas extra anuales, each = salario mensual
    // Proportional = (months worked in current period / 6) * salario_mensual per paga
    const mesInicioPeriodo = fechaInicio > inicioAnio ? fechaInicio.getMonth() : 0;
    const mesesTrabajados = fechaExt.getMonth() - mesInicioPeriodo + 1;
    // Paga junio (ene-jun), paga diciembre (jul-dic)
    let proporcionalPagaJunio = 0;
    let proporcionalPagaDiciembre = 0;
    if (pagasExtra >= 1) {
      if (fechaExt.getMonth() < 6) {
        // Before June paga: proportional
        proporcionalPagaJunio = (mesesTrabajados / 6) * salarioBrutoMensual;
      }
      // Paga diciembre
      const mesesDesdeJulio = fechaExt.getMonth() >= 6 ? (fechaExt.getMonth() - 6 + 1) : 0;
      if (mesesDesdeJulio > 0) {
        proporcionalPagaDiciembre = (mesesDesdeJulio / 6) * salarioBrutoMensual;
      } else if (fechaExt.getMonth() < 6) {
        // Full year accrual for previous december paga if not paid yet
        proporcionalPagaDiciembre = 0;
      }
    }
    const totalPagasExtra = proporcionalPagaJunio + proporcionalPagaDiciembre;

    // --- 4. Salario pendiente del mes ---
    const diasMesActual = fechaExt.getDate();
    const salarioPendienteMes = (salarioBrutoMensual / 30) * diasMesActual;

    // --- 5. Indemnizacion segun tipo de extincion ---
    const antiguedadMs = fechaExt - fechaInicio;
    const antiguedadAnios = antiguedadMs / (1000 * 60 * 60 * 24 * 365.25);
    const motivo = motivo_extincion || contrato.motivo_extincion || "";

    let diasPorAnio = 0;
    let topeIndemnizacion = null;
    let descripcionIndem = "";

    switch (motivo) {
      case "despido_improcedente":
        diasPorAnio = 33; // Post-reforma 2012
        topeIndemnizacion = 24; // meses
        descripcionIndem = "33 dias/anio (max 24 mensualidades)";
        break;
      case "despido_improcedente_anterior_2012":
        diasPorAnio = 45;
        topeIndemnizacion = 42;
        descripcionIndem = "45 dias/anio (max 42 mensualidades)";
        break;
      case "despido_objetivo":
      case "causas_objetivas":
        diasPorAnio = 20;
        topeIndemnizacion = 12;
        descripcionIndem = "20 dias/anio (max 12 mensualidades)";
        break;
      case "fin_contrato_temporal":
        diasPorAnio = 12;
        topeIndemnizacion = null;
        descripcionIndem = "12 dias/anio";
        break;
      case "despido_disciplinario_procedente":
      case "baja_voluntaria":
      case "mutuo_acuerdo":
        diasPorAnio = 0;
        descripcionIndem = "Sin indemnizacion";
        break;
      case "despido_colectivo":
      case "ere":
        diasPorAnio = 20;
        topeIndemnizacion = 12;
        descripcionIndem = "20 dias/anio (max 12 mensualidades) - minimo legal";
        break;
      default:
        diasPorAnio = 0;
        descripcionIndem = "Tipo de extincion no reconocido - revisar manualmente";
    }

    let indemnizacion = (salarioDiario * diasPorAnio) * antiguedadAnios;
    if (topeIndemnizacion) {
      const maxIndem = salarioBrutoMensual * topeIndemnizacion;
      indemnizacion = Math.min(indemnizacion, maxIndem);
    }
    indemnizacion = Math.max(0, indemnizacion);

    // --- Total ---
    const totalFiniquito = salarioPendienteMes + importeVacaciones + totalPagasExtra + indemnizacion;

    const resultado = {
      contrato: {
        id: contrato.id,
        nombre_empleado: contrato.nombre_empleado,
        tipo_contrato: contrato.tipo_contrato,
        fecha_inicio: contrato.fecha_inicio,
        salario_bruto_anual: salarioBrutoAnual,
        salario_bruto_mensual: salarioBrutoMensual,
        num_pagas: numPagas,
      },
      fecha_extincion: fechaExt.toISOString().split("T")[0],
      motivo_extincion: motivo,
      antiguedad_anios: Math.round(antiguedadAnios * 100) / 100,
      desglose: {
        salario_pendiente_mes: {
          dias: diasMesActual,
          importe: round2(salarioPendienteMes),
        },
        vacaciones_pendientes: {
          dias_devengados: diasVacacionesDevengados,
          dias_disfrutados: diasVacDisfrutados,
          dias_pendientes: diasVacacionesPendientes,
          importe: round2(importeVacaciones),
        },
        pagas_extra_proporcionales: {
          paga_junio: round2(proporcionalPagaJunio),
          paga_diciembre: round2(proporcionalPagaDiciembre),
          importe: round2(totalPagasExtra),
        },
        indemnizacion: {
          dias_por_anio: diasPorAnio,
          descripcion: descripcionIndem,
          importe: round2(indemnizacion),
        },
      },
      total_finiquito: round2(totalFiniquito),
    };

    res.json({ success: true, data: resultado });
  } catch (err) {
    logger.error("calcularFiniquito error", { error: err.message });
    res.status(500).json({ error: "Error calculando finiquito" });
  }
}

// ============================================================
// BAJAS LABORALES
// ============================================================

/**
 * GET /asesor/clientes/:empresa_id/bajas
 */
export async function getBajas(req, res) {
  try {
    const empresaId = req.params.empresa_id;
    const { estado, employee_id } = req.query;

    let rows;
    if (estado && employee_id) {
      rows = await sql`
        SELECT b.*,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM bajas_laborales_180 b
        JOIN employees_180 e ON b.employee_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        WHERE b.empresa_id = ${empresaId}
          AND b.estado = ${estado}
          AND b.employee_id = ${employee_id}
        ORDER BY b.fecha_inicio DESC
      `;
    } else if (estado) {
      rows = await sql`
        SELECT b.*,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM bajas_laborales_180 b
        JOIN employees_180 e ON b.employee_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        WHERE b.empresa_id = ${empresaId}
          AND b.estado = ${estado}
        ORDER BY b.fecha_inicio DESC
      `;
    } else if (employee_id) {
      rows = await sql`
        SELECT b.*,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM bajas_laborales_180 b
        JOIN employees_180 e ON b.employee_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        WHERE b.empresa_id = ${empresaId}
          AND b.employee_id = ${employee_id}
        ORDER BY b.fecha_inicio DESC
      `;
    } else {
      rows = await sql`
        SELECT b.*,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM bajas_laborales_180 b
        JOIN employees_180 e ON b.employee_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        WHERE b.empresa_id = ${empresaId}
        ORDER BY b.fecha_inicio DESC
      `;
    }

    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error("getBajas error", { error: err.message });
    res.status(500).json({ error: "Error obteniendo bajas" });
  }
}

/**
 * POST /asesor/clientes/:empresa_id/bajas
 */
export async function createBaja(req, res) {
  try {
    const empresaId = req.params.empresa_id;
    const {
      employee_id, contrato_id, tipo_baja, fecha_inicio, fecha_fin,
      diagnostico, codigo_diagnostico, base_reguladora,
      porcentaje_prestacion, importe_diario, pagador, mutua,
      parte_confirmacion_fecha, siguiente_revision, notas,
    } = req.body;

    if (!employee_id || !tipo_baja || !fecha_inicio) {
      return res.status(400).json({ error: "employee_id, tipo_baja y fecha_inicio son requeridos" });
    }

    const [row] = await sql`
      INSERT INTO bajas_laborales_180 (
        empresa_id, employee_id, contrato_id, tipo_baja, fecha_inicio,
        fecha_fin, diagnostico, codigo_diagnostico, base_reguladora,
        porcentaje_prestacion, importe_diario, pagador, mutua,
        parte_confirmacion_fecha, siguiente_revision, notas
      ) VALUES (
        ${empresaId}, ${employee_id}, ${contrato_id || null}, ${tipo_baja},
        ${fecha_inicio}, ${fecha_fin || null}, ${diagnostico || null},
        ${codigo_diagnostico || null}, ${base_reguladora || null},
        ${porcentaje_prestacion || null}, ${importe_diario || null},
        ${pagador || "empresa"}, ${mutua || null},
        ${parte_confirmacion_fecha || null}, ${siguiente_revision || null},
        ${notas || null}
      )
      RETURNING *
    `;

    res.status(201).json({ success: true, data: row });
  } catch (err) {
    logger.error("createBaja error", { error: err.message });
    res.status(500).json({ error: "Error creando baja" });
  }
}

/**
 * PUT /asesor/clientes/:empresa_id/bajas/:id
 */
export async function updateBaja(req, res) {
  try {
    const { empresa_id, id } = req.params;
    const {
      tipo_baja, fecha_inicio, fecha_fin, diagnostico, codigo_diagnostico,
      base_reguladora, porcentaje_prestacion, importe_diario, pagador,
      mutua, parte_confirmacion_fecha, siguiente_revision, estado, notas,
    } = req.body;

    const [row] = await sql`
      UPDATE bajas_laborales_180 SET
        tipo_baja = COALESCE(${tipo_baja || null}, tipo_baja),
        fecha_inicio = COALESCE(${fecha_inicio || null}, fecha_inicio),
        fecha_fin = ${fecha_fin !== undefined ? fecha_fin : null},
        diagnostico = ${diagnostico !== undefined ? diagnostico : null},
        codigo_diagnostico = ${codigo_diagnostico !== undefined ? codigo_diagnostico : null},
        base_reguladora = ${base_reguladora !== undefined ? base_reguladora : null},
        porcentaje_prestacion = ${porcentaje_prestacion !== undefined ? porcentaje_prestacion : null},
        importe_diario = ${importe_diario !== undefined ? importe_diario : null},
        pagador = COALESCE(${pagador || null}, pagador),
        mutua = ${mutua !== undefined ? mutua : null},
        parte_confirmacion_fecha = ${parte_confirmacion_fecha !== undefined ? parte_confirmacion_fecha : null},
        siguiente_revision = ${siguiente_revision !== undefined ? siguiente_revision : null},
        estado = COALESCE(${estado || null}, estado),
        notas = ${notas !== undefined ? notas : null},
        updated_at = now()
      WHERE id = ${id} AND empresa_id = ${empresa_id}
      RETURNING *
    `;

    if (!row) return res.status(404).json({ error: "Baja no encontrada" });
    res.json({ success: true, data: row });
  } catch (err) {
    logger.error("updateBaja error", { error: err.message });
    res.status(500).json({ error: "Error actualizando baja" });
  }
}

/**
 * POST /asesor/clientes/:empresa_id/bajas/:id/alta
 */
export async function darAltaMedica(req, res) {
  try {
    const { empresa_id, id } = req.params;
    const { fecha_alta_medica } = req.body;

    if (!fecha_alta_medica) {
      return res.status(400).json({ error: "fecha_alta_medica requerida" });
    }

    // Calculate total days
    const [baja] = await sql`
      SELECT fecha_inicio FROM bajas_laborales_180 WHERE id = ${id} AND empresa_id = ${empresa_id}
    `;
    if (!baja) return res.status(404).json({ error: "Baja no encontrada" });

    const diasTotales = Math.ceil(
      (new Date(fecha_alta_medica) - new Date(baja.fecha_inicio)) / (1000 * 60 * 60 * 24)
    ) + 1;

    const [row] = await sql`
      UPDATE bajas_laborales_180 SET
        fecha_alta_medica = ${fecha_alta_medica},
        fecha_fin = ${fecha_alta_medica},
        dias_totales = ${diasTotales},
        estado = 'alta_medica',
        updated_at = now()
      WHERE id = ${id} AND empresa_id = ${empresa_id}
      RETURNING *
    `;

    res.json({ success: true, data: row });
  } catch (err) {
    logger.error("darAltaMedica error", { error: err.message });
    res.status(500).json({ error: "Error dando alta medica" });
  }
}

// ============================================================
// COTIZACIONES SS
// ============================================================

// Tipos de cotizacion SS 2025/2026 (actualizables)
const TIPOS_SS = {
  empresa: {
    contingencias_comunes: 23.60,
    desempleo_general: 5.50,
    desempleo_temporal: 6.70,
    fogasa: 0.20,
    formacion_profesional: 0.60,
    mep: 0.58, // Mecanismo equidad intergeneracional 2025
  },
  trabajador: {
    contingencias_comunes: 4.70,
    desempleo_general: 1.55,
    desempleo_temporal: 1.60,
    formacion_profesional: 0.10,
    mep: 0.12,
  },
};

/**
 * GET /asesor/clientes/:empresa_id/cotizaciones/:anio
 */
export async function getCotizaciones(req, res) {
  try {
    const { empresa_id, anio } = req.params;
    const { mes, employee_id } = req.query;

    let rows;
    if (mes && employee_id) {
      rows = await sql`
        SELECT c.*,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM cotizaciones_ss_180 c
        JOIN employees_180 e ON c.employee_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        WHERE c.empresa_id = ${empresa_id}
          AND c.periodo_anio = ${parseInt(anio)}
          AND c.periodo_mes = ${parseInt(mes)}
          AND c.employee_id = ${employee_id}
        ORDER BY c.periodo_mes, e.nombre
      `;
    } else if (mes) {
      rows = await sql`
        SELECT c.*,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM cotizaciones_ss_180 c
        JOIN employees_180 e ON c.employee_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        WHERE c.empresa_id = ${empresa_id}
          AND c.periodo_anio = ${parseInt(anio)}
          AND c.periodo_mes = ${parseInt(mes)}
        ORDER BY c.periodo_mes, e.nombre
      `;
    } else {
      rows = await sql`
        SELECT c.*,
               COALESCE(u.nombre, e.nombre) AS nombre_empleado
        FROM cotizaciones_ss_180 c
        JOIN employees_180 e ON c.employee_id = e.id
        LEFT JOIN users_180 u ON e.user_id = u.id
        WHERE c.empresa_id = ${empresa_id}
          AND c.periodo_anio = ${parseInt(anio)}
        ORDER BY c.periodo_mes, e.nombre
      `;
    }

    // Summary by month
    const resumen = {};
    for (const r of rows) {
      const m = r.periodo_mes;
      if (!resumen[m]) {
        resumen[m] = { mes: m, total_empresa: 0, total_trabajador: 0, total: 0, empleados: 0 };
      }
      resumen[m].total_empresa += parseFloat(r.total_cuota_empresa) || 0;
      resumen[m].total_trabajador += parseFloat(r.total_cuota_trabajador) || 0;
      resumen[m].total += parseFloat(r.total_cotizacion) || 0;
      resumen[m].empleados += 1;
    }

    res.json({
      success: true,
      data: rows,
      resumen: Object.values(resumen),
    });
  } catch (err) {
    logger.error("getCotizaciones error", { error: err.message });
    res.status(500).json({ error: "Error obteniendo cotizaciones" });
  }
}

/**
 * POST /asesor/clientes/:empresa_id/cotizaciones/:anio/:mes/calcular
 * Calcula cotizaciones SS para todos los empleados con contrato vigente
 */
export async function calcularCotizacionMensual(req, res) {
  try {
    const { empresa_id, anio, mes } = req.params;
    const anioNum = parseInt(anio);
    const mesNum = parseInt(mes);

    // Get all active contracts for this empresa in this period
    const contratos = await sql`
      SELECT c.*,
             COALESCE(u.nombre, e.nombre) AS nombre_empleado
      FROM contratos_180 c
      JOIN employees_180 e ON c.employee_id = e.id
      LEFT JOIN users_180 u ON e.user_id = u.id
      WHERE c.empresa_id = ${empresa_id}
        AND c.estado IN ('vigente', 'suspendido')
        AND c.fecha_inicio <= ${`${anio}-${String(mes).padStart(2, "0")}-28`}::date
        AND (c.fecha_fin IS NULL OR c.fecha_fin >= ${`${anio}-${String(mes).padStart(2, "0")}-01`}::date)
    `;

    if (contratos.length === 0) {
      return res.json({ success: true, data: [], message: "No hay contratos vigentes en este periodo" });
    }

    const resultados = [];

    for (const contrato of contratos) {
      const baseCC = parseFloat(contrato.salario_bruto_mensual) || 0;
      const baseAT = baseCC;
      const esTemporal = ["temporal", "obra_servicio", "interinidad", "formacion", "practicas"].includes(contrato.tipo_contrato);

      // Empresa
      const cuotaEmpresaCC = round2(baseCC * TIPOS_SS.empresa.contingencias_comunes / 100);
      const cuotaEmpresaDesempleo = round2(baseCC * (esTemporal ? TIPOS_SS.empresa.desempleo_temporal : TIPOS_SS.empresa.desempleo_general) / 100);
      const cuotaEmpresaFogasa = round2(baseCC * TIPOS_SS.empresa.fogasa / 100);
      const cuotaEmpresaFP = round2(baseCC * TIPOS_SS.empresa.formacion_profesional / 100);
      const cuotaEmpresaAT = round2(baseAT * 1.50 / 100); // Default 1.5% - varies by CNAE
      const cuotaEmpresaMEP = round2(baseCC * TIPOS_SS.empresa.mep / 100);
      const totalEmpresa = round2(cuotaEmpresaCC + cuotaEmpresaDesempleo + cuotaEmpresaFogasa + cuotaEmpresaFP + cuotaEmpresaAT + cuotaEmpresaMEP);

      // Trabajador
      const cuotaTrabajadorCC = round2(baseCC * TIPOS_SS.trabajador.contingencias_comunes / 100);
      const cuotaTrabajadorDesempleo = round2(baseCC * (esTemporal ? TIPOS_SS.trabajador.desempleo_temporal : TIPOS_SS.trabajador.desempleo_general) / 100);
      const cuotaTrabajadorFP = round2(baseCC * TIPOS_SS.trabajador.formacion_profesional / 100);
      const cuotaTrabajadorMEP = round2(baseCC * TIPOS_SS.trabajador.mep / 100);
      const totalTrabajador = round2(cuotaTrabajadorCC + cuotaTrabajadorDesempleo + cuotaTrabajadorFP + cuotaTrabajadorMEP);

      const totalCotizacion = round2(totalEmpresa + totalTrabajador);

      // Upsert
      const [row] = await sql`
        INSERT INTO cotizaciones_ss_180 (
          empresa_id, employee_id, contrato_id, periodo_mes, periodo_anio,
          base_contingencias_comunes, base_accidentes_trabajo,
          cuota_empresa_cc, cuota_empresa_desempleo, cuota_empresa_fogasa,
          cuota_empresa_fp, cuota_empresa_at, cuota_empresa_mep, total_cuota_empresa,
          cuota_trabajador_cc, cuota_trabajador_desempleo, cuota_trabajador_fp,
          cuota_trabajador_mep, total_cuota_trabajador, total_cotizacion
        ) VALUES (
          ${empresa_id}, ${contrato.employee_id}, ${contrato.id},
          ${mesNum}, ${anioNum}, ${baseCC}, ${baseAT},
          ${cuotaEmpresaCC}, ${cuotaEmpresaDesempleo}, ${cuotaEmpresaFogasa},
          ${cuotaEmpresaFP}, ${cuotaEmpresaAT}, ${cuotaEmpresaMEP}, ${totalEmpresa},
          ${cuotaTrabajadorCC}, ${cuotaTrabajadorDesempleo}, ${cuotaTrabajadorFP},
          ${cuotaTrabajadorMEP}, ${totalTrabajador}, ${totalCotizacion}
        )
        ON CONFLICT (empresa_id, employee_id, periodo_mes, periodo_anio)
        DO UPDATE SET
          contrato_id = EXCLUDED.contrato_id,
          base_contingencias_comunes = EXCLUDED.base_contingencias_comunes,
          base_accidentes_trabajo = EXCLUDED.base_accidentes_trabajo,
          cuota_empresa_cc = EXCLUDED.cuota_empresa_cc,
          cuota_empresa_desempleo = EXCLUDED.cuota_empresa_desempleo,
          cuota_empresa_fogasa = EXCLUDED.cuota_empresa_fogasa,
          cuota_empresa_fp = EXCLUDED.cuota_empresa_fp,
          cuota_empresa_at = EXCLUDED.cuota_empresa_at,
          cuota_empresa_mep = EXCLUDED.cuota_empresa_mep,
          total_cuota_empresa = EXCLUDED.total_cuota_empresa,
          cuota_trabajador_cc = EXCLUDED.cuota_trabajador_cc,
          cuota_trabajador_desempleo = EXCLUDED.cuota_trabajador_desempleo,
          cuota_trabajador_fp = EXCLUDED.cuota_trabajador_fp,
          cuota_trabajador_mep = EXCLUDED.cuota_trabajador_mep,
          total_cuota_trabajador = EXCLUDED.total_cuota_trabajador,
          total_cotizacion = EXCLUDED.total_cotizacion
        RETURNING *
      `;

      resultados.push({ ...row, nombre_empleado: contrato.nombre_empleado });
    }

    res.json({ success: true, data: resultados });
  } catch (err) {
    logger.error("calcularCotizacionMensual error", { error: err.message });
    res.status(500).json({ error: "Error calculando cotizaciones" });
  }
}

// ============================================================
// DASHBOARD LABORAL (cross-client)
// ============================================================

/**
 * GET /asesor/laboral/dashboard
 */
export async function getDashboardLaboral(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const asesoriaEmpresaId = req.user.empresa_id;

    // Get empresa IDs this asesor manages
    const clientes = await sql`
      SELECT empresa_id FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoriaId} AND estado = 'activo'
    `;
    const ids = clientes.map((c) => c.empresa_id);
    if (asesoriaEmpresaId && !ids.includes(asesoriaEmpresaId)) {
      ids.push(asesoriaEmpresaId);
    }

    if (ids.length === 0) {
      return res.json({
        success: true,
        data: {
          contratos_vigentes: 0,
          bajas_activas: 0,
          contratos_proximos_vencimiento: [],
          bajas_revision_pendiente: [],
        },
      });
    }

    // Contratos vigentes
    const [contratosCount] = await sql`
      SELECT COUNT(*)::int AS total FROM contratos_180
      WHERE empresa_id = ANY(${ids}) AND estado = 'vigente'
    `;

    // Bajas activas
    const [bajasCount] = await sql`
      SELECT COUNT(*)::int AS total FROM bajas_laborales_180
      WHERE empresa_id = ANY(${ids}) AND estado = 'activa'
    `;

    // Contratos que vencen en proximos 30 dias
    const proximosVencimiento = await sql`
      SELECT c.id, c.fecha_fin, c.tipo_contrato,
             COALESCE(u.nombre, e.nombre) AS nombre_empleado,
             emp.nombre AS nombre_empresa
      FROM contratos_180 c
      JOIN employees_180 e ON c.employee_id = e.id
      LEFT JOIN users_180 u ON e.user_id = u.id
      JOIN empresa_180 emp ON c.empresa_id = emp.id
      WHERE c.empresa_id = ANY(${ids})
        AND c.estado = 'vigente'
        AND c.fecha_fin IS NOT NULL
        AND c.fecha_fin <= CURRENT_DATE + INTERVAL '30 days'
        AND c.fecha_fin >= CURRENT_DATE
      ORDER BY c.fecha_fin ASC
      LIMIT 20
    `;

    // Bajas pendientes de revision
    const bajasRevision = await sql`
      SELECT b.id, b.tipo_baja, b.fecha_inicio, b.siguiente_revision,
             COALESCE(u.nombre, e.nombre) AS nombre_empleado,
             emp.nombre AS nombre_empresa
      FROM bajas_laborales_180 b
      JOIN employees_180 e ON b.employee_id = e.id
      LEFT JOIN users_180 u ON e.user_id = u.id
      JOIN empresa_180 emp ON b.empresa_id = emp.id
      WHERE b.empresa_id = ANY(${ids})
        AND b.estado = 'activa'
        AND (b.siguiente_revision IS NULL OR b.siguiente_revision <= CURRENT_DATE + INTERVAL '7 days')
      ORDER BY b.siguiente_revision ASC NULLS FIRST
      LIMIT 20
    `;

    // Contratos extinguidos pendientes de finiquito (recent, last 30 days)
    const [finiquitosPendientes] = await sql`
      SELECT COUNT(*)::int AS total FROM contratos_180
      WHERE empresa_id = ANY(${ids})
        AND estado = 'extinguido'
        AND fecha_extincion >= CURRENT_DATE - INTERVAL '30 days'
    `;

    res.json({
      success: true,
      data: {
        contratos_vigentes: contratosCount.total,
        bajas_activas: bajasCount.total,
        finiquitos_pendientes: finiquitosPendientes.total,
        contratos_proximos_vencimiento: proximosVencimiento,
        bajas_revision_pendiente: bajasRevision,
      },
    });
  } catch (err) {
    logger.error("getDashboardLaboral error", { error: err.message });
    res.status(500).json({ error: "Error obteniendo dashboard laboral" });
  }
}

// ============================================================
// HELPERS
// ============================================================

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
