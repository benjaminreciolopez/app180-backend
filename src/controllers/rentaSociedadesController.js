/**
 * Controller: Renta IRPF + Impuesto de Sociedades (asesor)
 * Modulo fiscal anual para gestoria
 */

import { sql } from "../db.js";
import logger from "../utils/logger.js";

// ============================================================
// ESCALA IRPF 2025 (estatal + autonomica simplificada)
// ============================================================

const ESCALA_GENERAL_2025 = [
  { hasta: 12450, tipo: 19 },
  { hasta: 20200, tipo: 24 },
  { hasta: 35200, tipo: 30 },
  { hasta: 60000, tipo: 37 },
  { hasta: 300000, tipo: 45 },
  { hasta: Infinity, tipo: 47 },
];

const ESCALA_AHORRO_2025 = [
  { hasta: 6000, tipo: 19 },
  { hasta: 50000, tipo: 21 },
  { hasta: 200000, tipo: 23 },
  { hasta: 300000, tipo: 27 },
  { hasta: Infinity, tipo: 28 },
];

/**
 * Calcula cuota por tramos progresivos
 */
function calcularCuotaProgresiva(base, escala) {
  if (base <= 0) return 0;
  let cuota = 0;
  let baseRestante = base;
  let limiteAnterior = 0;

  for (const tramo of escala) {
    const anchoTramo = tramo.hasta === Infinity
      ? baseRestante
      : tramo.hasta - limiteAnterior;

    const baseEnTramo = Math.min(baseRestante, anchoTramo);
    cuota += baseEnTramo * (tramo.tipo / 100);
    baseRestante -= baseEnTramo;

    if (baseRestante <= 0) break;
    limiteAnterior = tramo.hasta;
  }

  return Math.round(cuota * 100) / 100;
}

// ============================================================
// HELPERS
// ============================================================

function n(val) {
  return parseFloat(val) || 0;
}

function determinarResultado(cuotaDiferencial) {
  if (cuotaDiferencial > 0.5) return "a_pagar";
  if (cuotaDiferencial < -0.5) return "a_devolver";
  return "cero";
}

// ============================================================
// RENTA IRPF
// ============================================================

/**
 * POST /asesor/clientes/:empresa_id/renta/:ejercicio/calcular
 * Auto-calcula la renta IRPF desde datos existentes
 */
export async function calcularRentaIRPF(req, res) {
  try {
    const { empresa_id, ejercicio } = req.params;
    const year = parseInt(ejercicio);

    if (!year || year < 2000 || year > 2099) {
      return res.status(400).json({ error: "Ejercicio invalido" });
    }

    // 1. Ingresos actividad (facturas emitidas)
    const [facturacion] = await sql`
      SELECT
        COALESCE(SUM(subtotal), 0) as ingresos,
        COALESCE(SUM(retencion_importe), 0) as retenciones_clientes
      FROM factura_180
      WHERE empresa_id = ${empresa_id}
        AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND EXTRACT(YEAR FROM fecha) = ${year}
    `;

    // 2. Gastos deducibles (purchases)
    const [gastos] = await sql`
      SELECT COALESCE(SUM(base_imponible), 0) as total_gastos
      FROM purchases_180
      WHERE empresa_id = ${empresa_id}
        AND activo = true
        AND EXTRACT(YEAR FROM fecha_compra) = ${year}
    `;

    // 3. Nominas (si tiene empleados)
    let nominasData = { bruto_total: 0, ss_empresa: 0, irpf_nominas: 0 };
    try {
      const [nom] = await sql`
        SELECT
          COALESCE(SUM(bruto), 0) as bruto_total,
          COALESCE(SUM(seguridad_social_empresa), 0) as ss_empresa,
          COALESCE(SUM(irpf_retencion), 0) as irpf_nominas
        FROM nominas_180
        WHERE empresa_id = ${empresa_id} AND anio = ${year}
      `;
      nominasData = nom;
    } catch (e) { /* tabla puede no existir */ }

    // 4. Pagos fraccionados mod 130
    let totalPagos130 = 0;
    try {
      const [p130] = await sql`
        SELECT COALESCE(SUM(resultado_importe), 0) as total
        FROM fiscal_models_180
        WHERE empresa_id = ${empresa_id} AND modelo = '130'
          AND ejercicio = ${year} AND estado IN ('GENERADO', 'PRESENTADO')
      `;
      totalPagos130 = n(p130.total);
    } catch (e) { /* tabla puede no existir */ }

    // 5. Calcular rendimiento neto actividad
    const ingresosActividad = n(facturacion.ingresos);
    const gastosDeduciblesActividad = n(gastos.total_gastos);
    const rendimientoNetoActividad = ingresosActividad - gastosDeduciblesActividad;

    // Gastos de dificil justificacion: 5% desde 2023 (max 2000 EUR)
    const pctDificilJustificacion = year >= 2023 ? 0.05 : 0.07;
    const gastosDificilJustificacion = Math.min(
      rendimientoNetoActividad > 0 ? rendimientoNetoActividad * pctDificilJustificacion : 0,
      2000
    );
    const rendimientoNetoReducidoActividad = rendimientoNetoActividad - gastosDificilJustificacion;

    // 6. Cargar datos existentes para campos manuales
    const [existing] = await sql`
      SELECT * FROM renta_irpf_180
      WHERE empresa_id = ${empresa_id} AND ejercicio = ${year}
    `.catch(() => [null]);

    // Usar datos manuales existentes o defaults
    const rendimientosTrabajo = n(existing?.rendimientos_trabajo);
    const retencionesTrabajo = n(existing?.retenciones_trabajo);
    const ingresosAlquiler = n(existing?.ingresos_alquiler);
    const gastosAlquiler = n(existing?.gastos_alquiler);
    const rendimientoInmobiliario = ingresosAlquiler - gastosAlquiler;
    const reduccionAlquilerVivienda = n(existing?.reduccion_alquiler_vivienda);
    const interesesCuentas = n(existing?.intereses_cuentas);
    const dividendos = n(existing?.dividendos);
    const otrosMobiliario = n(existing?.otros_mobiliario);
    const gananciasPatrimoniales = n(existing?.ganancias_patrimoniales);
    const perdidasPatrimoniales = n(existing?.perdidas_patrimoniales);

    // 7. Base imponible general
    const baseImponibleGeneral =
      rendimientoNetoReducidoActividad
      + rendimientosTrabajo
      + (rendimientoInmobiliario - reduccionAlquilerVivienda);

    // Base imponible del ahorro
    const baseImponibleAhorro =
      interesesCuentas + dividendos + otrosMobiliario
      + (gananciasPatrimoniales - perdidasPatrimoniales);

    // 8. Reducciones
    const reduccionTributacionConjunta = n(existing?.reduccion_tributacion_conjunta);
    const aportacionesPlanesPensiones = Math.min(n(existing?.aportaciones_planes_pensiones), 1500);
    const otrasReducciones = n(existing?.otras_reducciones);
    const totalReducciones = reduccionTributacionConjunta + aportacionesPlanesPensiones + otrasReducciones;

    // 9. Base liquidable
    const baseLiquidableGeneral = Math.max(baseImponibleGeneral - totalReducciones, 0);
    const baseLiquidableAhorro = Math.max(baseImponibleAhorro, 0);

    // 10. Cuota integra (escala progresiva)
    // Estatal = ~50% de la cuota total, autonomica = ~50% (simplificado)
    const cuotaTotal = calcularCuotaProgresiva(baseLiquidableGeneral, ESCALA_GENERAL_2025);
    const cuotaIntegrEstatal = Math.round(cuotaTotal * 0.5 * 100) / 100;
    const cuotaIntegrAutonomica = Math.round(cuotaTotal * 0.5 * 100) / 100;
    const cuotaAhorro = calcularCuotaProgresiva(baseLiquidableAhorro, ESCALA_AHORRO_2025);
    const cuotaIntegrTotal = Math.round((cuotaTotal + cuotaAhorro) * 100) / 100;

    // 11. Deducciones
    const deduccionViviendaHabitual = n(existing?.deduccion_vivienda_habitual);
    const deduccionMaternidad = n(existing?.deduccion_maternidad);
    const deduccionFamiliaNumerosa = n(existing?.deduccion_familia_numerosa);
    const deduccionesAutonomicas = n(existing?.deducciones_autonomicas);
    const otrasDeducciones = n(existing?.otras_deducciones);
    const totalDeducciones = deduccionViviendaHabitual + deduccionMaternidad
      + deduccionFamiliaNumerosa + deduccionesAutonomicas + otrasDeducciones;

    // 12. Cuota liquida
    const cuotaLiquida = Math.max(cuotaIntegrTotal - totalDeducciones, 0);

    // 13. Retenciones y pagos a cuenta
    const retencionesClientes = n(facturacion.retenciones_clientes);
    const retencionesPagosCuenta = retencionesClientes + retencionesTrabajo;
    const pagosFraccionados = totalPagos130;

    // 14. Cuota diferencial
    const cuotaDiferencial = Math.round(
      (cuotaLiquida - retencionesPagosCuenta - pagosFraccionados) * 100
    ) / 100;

    const resultado = determinarResultado(cuotaDiferencial);
    const importeResultado = Math.abs(cuotaDiferencial);

    // 15. Upsert en BD
    const data = {
      empresa_id,
      ejercicio: year,
      estado: "calculado",
      ingresos_actividad: ingresosActividad,
      gastos_deducibles_actividad: gastosDeduciblesActividad,
      rendimiento_neto_actividad: rendimientoNetoActividad,
      gastos_dificil_justificacion: gastosDificilJustificacion,
      rendimiento_neto_reducido_actividad: rendimientoNetoReducidoActividad,
      rendimientos_trabajo: rendimientosTrabajo,
      retenciones_trabajo: retencionesTrabajo,
      ingresos_alquiler: ingresosAlquiler,
      gastos_alquiler: gastosAlquiler,
      rendimiento_inmobiliario: rendimientoInmobiliario,
      reduccion_alquiler_vivienda: reduccionAlquilerVivienda,
      intereses_cuentas: interesesCuentas,
      dividendos,
      otros_mobiliario: otrosMobiliario,
      ganancias_patrimoniales: gananciasPatrimoniales,
      perdidas_patrimoniales: perdidasPatrimoniales,
      base_imponible_general: baseImponibleGeneral,
      base_imponible_ahorro: baseImponibleAhorro,
      reduccion_tributacion_conjunta: reduccionTributacionConjunta,
      aportaciones_planes_pensiones: aportacionesPlanesPensiones,
      otras_reducciones: otrasReducciones,
      base_liquidable_general: baseLiquidableGeneral,
      base_liquidable_ahorro: baseLiquidableAhorro,
      cuota_integra_estatal: cuotaIntegrEstatal,
      cuota_integra_autonomica: cuotaIntegrAutonomica,
      cuota_integra_total: cuotaIntegrTotal,
      deduccion_vivienda_habitual: deduccionViviendaHabitual,
      deduccion_maternidad: deduccionMaternidad,
      deduccion_familia_numerosa: deduccionFamiliaNumerosa,
      deducciones_autonomicas: deduccionesAutonomicas,
      otras_deducciones: otrasDeducciones,
      total_deducciones: totalDeducciones,
      cuota_liquida: cuotaLiquida,
      retenciones_pagos_cuenta: retencionesPagosCuenta,
      pagos_fraccionados: pagosFraccionados,
      cuota_diferencial: cuotaDiferencial,
      resultado,
      importe_resultado: importeResultado,
      updated_at: new Date(),
    };

    let record;
    if (existing) {
      [record] = await sql`
        UPDATE renta_irpf_180
        SET ${sql(data, ...Object.keys(data).filter(k => k !== 'empresa_id' && k !== 'ejercicio'))}
        WHERE empresa_id = ${empresa_id} AND ejercicio = ${year}
        RETURNING *
      `;
    } else {
      [record] = await sql`
        INSERT INTO renta_irpf_180 ${sql(data)}
        RETURNING *
      `;
    }

    logger.info(`Renta IRPF calculada: empresa=${empresa_id} ejercicio=${year} resultado=${resultado} importe=${importeResultado}`);

    res.json({
      data: record,
      resumen: {
        ingresos_actividad: ingresosActividad,
        gastos_deducibles: gastosDeduciblesActividad,
        rendimiento_neto: rendimientoNetoActividad,
        base_liquidable_general: baseLiquidableGeneral,
        cuota_integra: cuotaIntegrTotal,
        deducciones: totalDeducciones,
        retenciones: retencionesPagosCuenta,
        pagos_fraccionados: pagosFraccionados,
        cuota_diferencial: cuotaDiferencial,
        resultado,
        importe: importeResultado,
      },
      escala_aplicada: ESCALA_GENERAL_2025,
      escala_ahorro: ESCALA_AHORRO_2025,
    });
  } catch (err) {
    logger.error("Error calculando renta IRPF", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Error al calcular la renta IRPF" });
  }
}

/**
 * GET /asesor/clientes/:empresa_id/renta/:ejercicio
 */
export async function getRentaIRPF(req, res) {
  try {
    const { empresa_id, ejercicio } = req.params;
    const year = parseInt(ejercicio);

    const [record] = await sql`
      SELECT r.*, e.nombre as empresa_nombre, e.tipo_contribuyente
      FROM renta_irpf_180 r
      JOIN empresa_180 e ON e.id = r.empresa_id
      WHERE r.empresa_id = ${empresa_id} AND r.ejercicio = ${year}
    `;

    if (!record) {
      return res.json({
        data: null,
        mensaje: "No hay datos de renta para este ejercicio. Pulse Calcular para generar.",
      });
    }

    res.json({ data: record });
  } catch (err) {
    logger.error("Error obteniendo renta IRPF", { error: err.message });
    res.status(500).json({ error: "Error al obtener la renta IRPF" });
  }
}

/**
 * PUT /asesor/clientes/:empresa_id/renta/:ejercicio
 * Ajustes manuales sobre la renta calculada
 */
export async function updateRentaIRPF(req, res) {
  try {
    const { empresa_id, ejercicio } = req.params;
    const year = parseInt(ejercicio);
    const updates = req.body;

    // Campos permitidos para actualizacion manual
    const allowedFields = [
      "rendimientos_trabajo", "retenciones_trabajo",
      "ingresos_alquiler", "gastos_alquiler", "reduccion_alquiler_vivienda",
      "intereses_cuentas", "dividendos", "otros_mobiliario",
      "ganancias_patrimoniales", "perdidas_patrimoniales",
      "reduccion_tributacion_conjunta", "aportaciones_planes_pensiones", "otras_reducciones",
      "deduccion_vivienda_habitual", "deduccion_maternidad",
      "deduccion_familia_numerosa", "deducciones_autonomicas", "otras_deducciones",
      "reduccion_rendimiento_irregular",
      "notas", "datos_extra",
    ];

    const filtered = {};
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        filtered[key] = updates[key];
      }
    }

    if (Object.keys(filtered).length === 0) {
      return res.status(400).json({ error: "No hay campos validos para actualizar" });
    }

    filtered.estado = "en_progreso";
    filtered.updated_at = new Date();

    const [existing] = await sql`
      SELECT id FROM renta_irpf_180
      WHERE empresa_id = ${empresa_id} AND ejercicio = ${year}
    `;

    let record;
    if (existing) {
      [record] = await sql`
        UPDATE renta_irpf_180
        SET ${sql(filtered, ...Object.keys(filtered))}
        WHERE empresa_id = ${empresa_id} AND ejercicio = ${year}
        RETURNING *
      `;
    } else {
      [record] = await sql`
        INSERT INTO renta_irpf_180 ${sql({ empresa_id, ejercicio: year, ...filtered })}
        RETURNING *
      `;
    }

    res.json({ data: record });
  } catch (err) {
    logger.error("Error actualizando renta IRPF", { error: err.message });
    res.status(500).json({ error: "Error al actualizar la renta IRPF" });
  }
}

/**
 * PUT /asesor/clientes/:empresa_id/renta/:ejercicio/presentar
 */
export async function marcarRentaPresentada(req, res) {
  try {
    const { empresa_id, ejercicio } = req.params;
    const year = parseInt(ejercicio);
    const { csv, numero_justificante, fecha_presentacion } = req.body;

    const [record] = await sql`
      UPDATE renta_irpf_180
      SET estado = 'presentado',
          csv = ${csv || null},
          numero_justificante = ${numero_justificante || null},
          fecha_presentacion = ${fecha_presentacion || new Date()},
          updated_at = NOW()
      WHERE empresa_id = ${empresa_id} AND ejercicio = ${year}
      RETURNING *
    `;

    if (!record) {
      return res.status(404).json({ error: "No existe renta para este ejercicio" });
    }

    logger.info(`Renta IRPF marcada como presentada: empresa=${empresa_id} ejercicio=${year}`);
    res.json({ data: record });
  } catch (err) {
    logger.error("Error marcando renta presentada", { error: err.message });
    res.status(500).json({ error: "Error al marcar la renta como presentada" });
  }
}

// ============================================================
// IMPUESTO DE SOCIEDADES
// ============================================================

/**
 * POST /asesor/clientes/:empresa_id/sociedades/:ejercicio/calcular
 */
export async function calcularImpuestoSociedades(req, res) {
  try {
    const { empresa_id, ejercicio } = req.params;
    const year = parseInt(ejercicio);

    if (!year || year < 2000 || year > 2099) {
      return res.status(400).json({ error: "Ejercicio invalido" });
    }

    // 1. Verificar que es sociedad
    const [empresa] = await sql`
      SELECT id, nombre, tipo_contribuyente, created_at
      FROM empresa_180 WHERE id = ${empresa_id}
    `;
    if (!empresa) {
      return res.status(404).json({ error: "Empresa no encontrada" });
    }

    // 2. Ingresos explotacion (facturas emitidas)
    const [facturacion] = await sql`
      SELECT
        COALESCE(SUM(subtotal), 0) as ingresos,
        COALESCE(SUM(retencion_importe), 0) as retenciones
      FROM factura_180
      WHERE empresa_id = ${empresa_id}
        AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND EXTRACT(YEAR FROM fecha) = ${year}
    `;

    // 3. Gastos explotacion
    const [gastos] = await sql`
      SELECT COALESCE(SUM(base_imponible), 0) as total_gastos
      FROM purchases_180
      WHERE empresa_id = ${empresa_id}
        AND activo = true
        AND EXTRACT(YEAR FROM fecha_compra) = ${year}
    `;

    // 4. Nominas
    let nominasData = { bruto_total: 0, ss_empresa: 0 };
    try {
      const [nom] = await sql`
        SELECT
          COALESCE(SUM(bruto), 0) as bruto_total,
          COALESCE(SUM(seguridad_social_empresa), 0) as ss_empresa
        FROM nominas_180
        WHERE empresa_id = ${empresa_id} AND anio = ${year}
      `;
      nominasData = nom;
    } catch (e) { /* tabla puede no existir */ }

    // 5. Pagos fraccionados mod 202
    let totalPagos202 = 0;
    try {
      const [p202] = await sql`
        SELECT COALESCE(SUM(resultado_importe), 0) as total
        FROM fiscal_models_180
        WHERE empresa_id = ${empresa_id} AND modelo = '202'
          AND ejercicio = ${year} AND estado IN ('GENERADO', 'PRESENTADO')
      `;
      totalPagos202 = n(p202.total);
    } catch (e) { /* tabla puede no existir */ }

    // 6. Calcular cuenta de resultados
    const ingresosExplotacion = n(facturacion.ingresos);
    const gastosExplotacion = n(gastos.total_gastos) + n(nominasData.bruto_total) + n(nominasData.ss_empresa);
    const resultadoExplotacion = ingresosExplotacion - gastosExplotacion;

    // Datos existentes para campos manuales
    const [existing] = await sql`
      SELECT * FROM impuesto_sociedades_180
      WHERE empresa_id = ${empresa_id} AND ejercicio = ${year}
    `.catch(() => [null]);

    const ingresosFinancieros = n(existing?.ingresos_financieros);
    const gastosFinancieros = n(existing?.gastos_financieros);
    const resultadoFinanciero = ingresosFinancieros - gastosFinancieros;
    const resultadoAntesImpuestos = resultadoExplotacion + resultadoFinanciero;

    // 7. Ajustes extracontables
    const ajustesPositivos = n(existing?.ajustes_positivos);
    const ajustesNegativos = n(existing?.ajustes_negativos);

    // 8. Base imponible
    const baseImponiblePrevia = resultadoAntesImpuestos + ajustesPositivos - ajustesNegativos;
    const compensacionBin = n(existing?.compensacion_bin);
    const baseImponible = Math.max(baseImponiblePrevia - compensacionBin, 0);

    // 9. Tipo de gravamen
    let tipoGravamen = 25;
    let tipoAplicado = "general";

    // Determinar si es nueva empresa (2 primeros ejercicios con BI positiva)
    const empresaAge = new Date().getFullYear() - new Date(empresa.created_at).getFullYear();
    if (empresaAge <= 2 && baseImponible > 0) {
      tipoGravamen = 15;
      tipoAplicado = "reducido_nueva_empresa";
    } else if (ingresosExplotacion < 1000000) {
      // Pyme: primeros 300k al 23%
      tipoGravamen = 23;
      tipoAplicado = "reducido_pyme";
    }

    // Permitir override manual
    if (existing?.tipo_aplicado && existing.tipo_aplicado !== "general") {
      tipoAplicado = existing.tipo_aplicado;
      if (tipoAplicado === "reducido_nueva_empresa") tipoGravamen = 15;
      else if (tipoAplicado === "reducido_pyme") tipoGravamen = 23;
      else if (tipoAplicado === "microempresa") tipoGravamen = 23;
      else tipoGravamen = 25;
    }

    // 10. Cuota integra
    const cuotaIntegra = Math.round(baseImponible * (tipoGravamen / 100) * 100) / 100;

    // 11. Deducciones
    const deduccionDobleImposicion = n(existing?.deduccion_doble_imposicion);
    const deduccionesId = n(existing?.deducciones_id);
    const bonificaciones = n(existing?.bonificaciones);
    const otrasDeducciones = n(existing?.otras_deducciones);
    const totalDeducciones = deduccionDobleImposicion + deduccionesId + bonificaciones + otrasDeducciones;

    // 12. Cuota liquida
    const cuotaLiquida = Math.max(cuotaIntegra - totalDeducciones, 0);

    // 13. Retenciones y pagos a cuenta
    const retenciones = n(facturacion.retenciones);
    const pagosFraccionados = totalPagos202;

    // 14. Cuota diferencial
    const cuotaDiferencial = Math.round(
      (cuotaLiquida - retenciones - pagosFraccionados) * 100
    ) / 100;

    const resultado = determinarResultado(cuotaDiferencial);
    const importeResultado = Math.abs(cuotaDiferencial);

    // 15. Fecha limite: 25 julio del ejercicio siguiente
    const fechaLimite = `${year + 1}-07-25`;

    // 16. Upsert
    const data = {
      empresa_id,
      ejercicio: year,
      estado: "calculado",
      ingresos_explotacion: ingresosExplotacion,
      gastos_explotacion: gastosExplotacion,
      resultado_explotacion: resultadoExplotacion,
      ingresos_financieros: ingresosFinancieros,
      gastos_financieros: gastosFinancieros,
      resultado_financiero: resultadoFinanciero,
      resultado_antes_impuestos: resultadoAntesImpuestos,
      ajustes_positivos: ajustesPositivos,
      ajustes_negativos: ajustesNegativos,
      detalle_ajustes: existing?.detalle_ajustes || null,
      base_imponible_previa: baseImponiblePrevia,
      compensacion_bin: compensacionBin,
      base_imponible: baseImponible,
      tipo_gravamen: tipoGravamen,
      tipo_aplicado: tipoAplicado,
      cuota_integra: cuotaIntegra,
      deduccion_doble_imposicion: deduccionDobleImposicion,
      deducciones_id: deduccionesId,
      bonificaciones,
      otras_deducciones: otrasDeducciones,
      total_deducciones: totalDeducciones,
      cuota_liquida: cuotaLiquida,
      retenciones,
      pagos_fraccionados: pagosFraccionados,
      cuota_diferencial: cuotaDiferencial,
      resultado,
      importe_resultado: importeResultado,
      fecha_limite: fechaLimite,
      updated_at: new Date(),
    };

    let record;
    if (existing) {
      [record] = await sql`
        UPDATE impuesto_sociedades_180
        SET ${sql(data, ...Object.keys(data).filter(k => k !== 'empresa_id' && k !== 'ejercicio'))}
        WHERE empresa_id = ${empresa_id} AND ejercicio = ${year}
        RETURNING *
      `;
    } else {
      [record] = await sql`
        INSERT INTO impuesto_sociedades_180 ${sql(data)}
        RETURNING *
      `;
    }

    logger.info(`IS calculado: empresa=${empresa_id} ejercicio=${year} resultado=${resultado} importe=${importeResultado}`);

    res.json({
      data: record,
      resumen: {
        ingresos_explotacion: ingresosExplotacion,
        gastos_explotacion: gastosExplotacion,
        resultado_antes_impuestos: resultadoAntesImpuestos,
        base_imponible: baseImponible,
        tipo_gravamen: tipoGravamen,
        tipo_aplicado: tipoAplicado,
        cuota_integra: cuotaIntegra,
        deducciones: totalDeducciones,
        retenciones,
        pagos_fraccionados: pagosFraccionados,
        cuota_diferencial: cuotaDiferencial,
        resultado,
        importe: importeResultado,
      },
    });
  } catch (err) {
    logger.error("Error calculando IS", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Error al calcular el Impuesto de Sociedades" });
  }
}

/**
 * GET /asesor/clientes/:empresa_id/sociedades/:ejercicio
 */
export async function getImpuestoSociedades(req, res) {
  try {
    const { empresa_id, ejercicio } = req.params;
    const year = parseInt(ejercicio);

    const [record] = await sql`
      SELECT s.*, e.nombre as empresa_nombre, e.tipo_contribuyente
      FROM impuesto_sociedades_180 s
      JOIN empresa_180 e ON e.id = s.empresa_id
      WHERE s.empresa_id = ${empresa_id} AND s.ejercicio = ${year}
    `;

    if (!record) {
      return res.json({
        data: null,
        mensaje: "No hay datos de IS para este ejercicio. Pulse Calcular para generar.",
      });
    }

    res.json({ data: record });
  } catch (err) {
    logger.error("Error obteniendo IS", { error: err.message });
    res.status(500).json({ error: "Error al obtener el Impuesto de Sociedades" });
  }
}

/**
 * PUT /asesor/clientes/:empresa_id/sociedades/:ejercicio
 */
export async function updateImpuestoSociedades(req, res) {
  try {
    const { empresa_id, ejercicio } = req.params;
    const year = parseInt(ejercicio);
    const updates = req.body;

    const allowedFields = [
      "ingresos_financieros", "gastos_financieros",
      "ajustes_positivos", "ajustes_negativos", "detalle_ajustes",
      "compensacion_bin", "tipo_aplicado",
      "deduccion_doble_imposicion", "deducciones_id", "bonificaciones", "otras_deducciones",
      "notas", "datos_extra",
    ];

    const filtered = {};
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        filtered[key] = updates[key];
      }
    }

    if (Object.keys(filtered).length === 0) {
      return res.status(400).json({ error: "No hay campos validos para actualizar" });
    }

    filtered.estado = "en_progreso";
    filtered.updated_at = new Date();

    const [existing] = await sql`
      SELECT id FROM impuesto_sociedades_180
      WHERE empresa_id = ${empresa_id} AND ejercicio = ${year}
    `;

    let record;
    if (existing) {
      [record] = await sql`
        UPDATE impuesto_sociedades_180
        SET ${sql(filtered, ...Object.keys(filtered))}
        WHERE empresa_id = ${empresa_id} AND ejercicio = ${year}
        RETURNING *
      `;
    } else {
      [record] = await sql`
        INSERT INTO impuesto_sociedades_180 ${sql({ empresa_id, ejercicio: year, ...filtered })}
        RETURNING *
      `;
    }

    res.json({ data: record });
  } catch (err) {
    logger.error("Error actualizando IS", { error: err.message });
    res.status(500).json({ error: "Error al actualizar el Impuesto de Sociedades" });
  }
}

/**
 * PUT /asesor/clientes/:empresa_id/sociedades/:ejercicio/presentar
 */
export async function marcarSociedadesPresentado(req, res) {
  try {
    const { empresa_id, ejercicio } = req.params;
    const year = parseInt(ejercicio);
    const { csv, numero_justificante, fecha_presentacion } = req.body;

    const [record] = await sql`
      UPDATE impuesto_sociedades_180
      SET estado = 'presentado',
          csv = ${csv || null},
          numero_justificante = ${numero_justificante || null},
          fecha_presentacion = ${fecha_presentacion || new Date()},
          updated_at = NOW()
      WHERE empresa_id = ${empresa_id} AND ejercicio = ${year}
      RETURNING *
    `;

    if (!record) {
      return res.status(404).json({ error: "No existe IS para este ejercicio" });
    }

    logger.info(`IS marcado como presentado: empresa=${empresa_id} ejercicio=${year}`);
    res.json({ data: record });
  } catch (err) {
    logger.error("Error marcando IS presentado", { error: err.message });
    res.status(500).json({ error: "Error al marcar el IS como presentado" });
  }
}

// ============================================================
// CAMPANA RENTA - Vista consolidada
// ============================================================

/**
 * GET /asesor/fiscal/renta-campana/:ejercicio
 * Vista resumen de la campana de renta de todos los clientes
 */
export async function getRentaCampana(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const { ejercicio } = req.params;
    const year = parseInt(ejercicio);

    // Obtener todos los clientes con su estado de renta/IS
    const clientes = await sql`
      SELECT
        e.id as empresa_id,
        e.nombre,
        e.tipo_contribuyente,
        r.id as renta_id,
        r.estado as renta_estado,
        r.resultado as renta_resultado,
        r.importe_resultado as renta_importe,
        r.cuota_diferencial as renta_cuota_diferencial,
        r.fecha_presentacion as renta_fecha_presentacion,
        s.id as is_id,
        s.estado as is_estado,
        s.resultado as is_resultado,
        s.importe_resultado as is_importe,
        s.cuota_diferencial as is_cuota_diferencial,
        s.fecha_presentacion as is_fecha_presentacion,
        s.fecha_limite as is_fecha_limite
      FROM empresa_180 e
      JOIN asesoria_clientes_180 v ON v.empresa_id = e.id
        AND v.asesoria_id = ${asesoriaId} AND v.estado = 'activo'
      LEFT JOIN renta_irpf_180 r ON r.empresa_id = e.id AND r.ejercicio = ${year}
      LEFT JOIN impuesto_sociedades_180 s ON s.empresa_id = e.id AND s.ejercicio = ${year}
      WHERE e.activo = true
      ORDER BY e.nombre
    `;

    // Separar autonomos y sociedades
    const autonomos = clientes.filter(c => c.tipo_contribuyente === "autonomo" || (!c.tipo_contribuyente && c.renta_id));
    const sociedades = clientes.filter(c => c.tipo_contribuyente === "sociedad");

    // Totales
    const totalAPagarRenta = autonomos
      .filter(c => c.renta_resultado === "a_pagar")
      .reduce((sum, c) => sum + n(c.renta_importe), 0);
    const totalADevolverRenta = autonomos
      .filter(c => c.renta_resultado === "a_devolver")
      .reduce((sum, c) => sum + n(c.renta_importe), 0);
    const totalAPagarIS = sociedades
      .filter(c => c.is_resultado === "a_pagar")
      .reduce((sum, c) => sum + n(c.is_importe), 0);
    const totalADevolverIS = sociedades
      .filter(c => c.is_resultado === "a_devolver")
      .reduce((sum, c) => sum + n(c.is_importe), 0);

    // Conteo por estado
    const countByEstado = (list, field) => {
      const counts = { borrador: 0, en_progreso: 0, calculado: 0, presentado: 0, sin_datos: 0 };
      for (const c of list) {
        const estado = c[field] || "sin_datos";
        counts[estado] = (counts[estado] || 0) + 1;
      }
      return counts;
    };

    res.json({
      ejercicio: year,
      autonomos: {
        clientes: autonomos,
        total: autonomos.length,
        estados: countByEstado(autonomos, "renta_estado"),
        total_a_pagar: totalAPagarRenta,
        total_a_devolver: totalADevolverRenta,
      },
      sociedades: {
        clientes: sociedades,
        total: sociedades.length,
        estados: countByEstado(sociedades, "is_estado"),
        total_a_pagar: totalAPagarIS,
        total_a_devolver: totalADevolverIS,
      },
      resumen: {
        total_clientes: clientes.length,
        total_a_pagar: totalAPagarRenta + totalAPagarIS,
        total_a_devolver: totalADevolverRenta + totalADevolverIS,
      },
    });
  } catch (err) {
    logger.error("Error obteniendo campana renta", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Error al obtener la campana de renta" });
  }
}
