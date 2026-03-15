// backend/src/services/nominaCalculationService.js
// Motor de cálculo automático de nóminas según normativa española

import { sql } from "../db.js";

// Tipos de cotización SS empleado (2024-2025 España)
const SS_TIPOS_EMPLEADO = {
  contingencias_comunes: 0.047, // 4.70%
  desempleo_indefinido: 0.0155, // 1.55%
  desempleo_temporal: 0.016, // 1.60%
  formacion_profesional: 0.001, // 0.10%
};

// Tipos de cotización SS empresa (informativo)
const SS_TIPOS_EMPRESA = {
  contingencias_comunes: 0.236, // 23.60%
  desempleo_indefinido: 0.055, // 5.50%
  desempleo_temporal: 0.065, // 6.50%
  fogasa: 0.002, // 0.20%
  formacion_profesional: 0.006, // 0.60%
};

/**
 * Calcula una nómina completa para un empleado
 * @param {Object} empleado - Registro de empleado con campos de contrato/salario
 * @param {Array} incidencias - Array de incidencias del periodo
 * @param {Object} periodo - { anio, mes }
 * @returns {Object} Desglose completo de la nómina
 */
export function calcularNomina(empleado, incidencias, periodo) {
  const salarioBase = parseFloat(empleado.salario_base) || 0;
  const salarioMensual = salarioBase / 12; // 12 pagas

  // Sumar incidencias por tipo
  let totalHorasExtra = 0;
  let totalComplementos = 0;
  let totalDeduccionesAusencias = 0;

  for (const inc of incidencias) {
    const importe = parseFloat(inc.importe) || 0;
    switch (inc.tipo) {
      case "horas_extra":
        totalHorasExtra += importe;
        break;
      case "complemento":
      case "bonus":
        totalComplementos += importe;
        break;
      case "ausencia_no_retribuida":
        totalDeduccionesAusencias += Math.abs(importe);
        break;
      case "baja_it":
      case "baja_at":
        // Las bajas pueden reducir el salario según días
        totalDeduccionesAusencias += Math.abs(importe);
        break;
      default:
        // Otros tipos: si positivo suma, si negativo resta
        if (importe > 0) totalComplementos += importe;
        else totalDeduccionesAusencias += Math.abs(importe);
    }
  }

  // Devengos (bruto)
  const bruto =
    salarioMensual + totalHorasExtra + totalComplementos - totalDeduccionesAusencias;

  // Base de cotización
  const baseCotizacion = Math.max(bruto, 0);

  // SS Empleado
  const esTemporal =
    empleado.tipo_contrato === "temporal" || empleado.tipo_contrato === "practicas";
  const tipoDesempleo = esTemporal
    ? SS_TIPOS_EMPLEADO.desempleo_temporal
    : SS_TIPOS_EMPLEADO.desempleo_indefinido;

  const ssContingenciasComunes = round2(
    baseCotizacion * SS_TIPOS_EMPLEADO.contingencias_comunes
  );
  const ssDesempleo = round2(baseCotizacion * tipoDesempleo);
  const ssFormacion = round2(baseCotizacion * SS_TIPOS_EMPLEADO.formacion_profesional);
  const totalSSEmpleado = round2(ssContingenciasComunes + ssDesempleo + ssFormacion);

  // SS Empresa (informativo)
  const tipoDesempleoEmp = esTemporal
    ? SS_TIPOS_EMPRESA.desempleo_temporal
    : SS_TIPOS_EMPRESA.desempleo_indefinido;

  const ssEmpresaCC = round2(baseCotizacion * SS_TIPOS_EMPRESA.contingencias_comunes);
  const ssEmpresaDesempleo = round2(baseCotizacion * tipoDesempleoEmp);
  const ssEmpresaFogasa = round2(baseCotizacion * SS_TIPOS_EMPRESA.fogasa);
  const ssEmpresaFormacion = round2(baseCotizacion * SS_TIPOS_EMPRESA.formacion_profesional);
  const totalSSEmpresa = round2(
    ssEmpresaCC + ssEmpresaDesempleo + ssEmpresaFogasa + ssEmpresaFormacion
  );

  // IRPF
  const porcentajeIrpf = parseFloat(empleado.porcentaje_irpf) || 0;
  const irpfRetencion = round2(bruto * (porcentajeIrpf / 100));

  // Líquido
  const liquido = round2(bruto - totalSSEmpleado - irpfRetencion);

  return {
    bruto: round2(bruto),
    salario_base_mensual: round2(salarioMensual),
    horas_extra: round2(totalHorasExtra),
    complementos: round2(totalComplementos),
    deducciones_ausencias: round2(totalDeduccionesAusencias),
    base_cotizacion: round2(baseCotizacion),
    // SS Empleado desglose
    tipo_contingencias_comunes: ssContingenciasComunes,
    tipo_desempleo: ssDesempleo,
    tipo_formacion: ssFormacion,
    seguridad_social_empleado: totalSSEmpleado,
    // SS Empresa desglose
    seguridad_social_empresa: totalSSEmpresa,
    ss_empresa_cc: ssEmpresaCC,
    ss_empresa_desempleo: ssEmpresaDesempleo,
    ss_empresa_fogasa: ssEmpresaFogasa,
    ss_empresa_formacion: ssEmpresaFormacion,
    tipo_fogasa: ssEmpresaFogasa,
    // IRPF
    porcentaje_irpf: porcentajeIrpf,
    irpf_retencion: irpfRetencion,
    // Neto
    liquido,
  };
}

/**
 * Recopila incidencias automáticas y manuales para un empleado en un periodo
 */
export async function recopilarIncidencias(empresaId, empleadoId, anio, mes) {
  // 1. Incidencias manuales existentes
  const manuales = await sql`
    SELECT * FROM nomina_incidencias_180
    WHERE empresa_id = ${empresaId}
      AND empleado_id = ${empleadoId}
      AND anio = ${anio}
      AND mes = ${mes}
      AND estado != 'descartada'
    ORDER BY created_at
  `;

  // 2. Auto-detectar ausencias no retribuidas del mes
  const inicioMes = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const finMes =
    mes === 12
      ? `${anio + 1}-01-01`
      : `${anio}-${String(mes + 1).padStart(2, "0")}-01`;

  const ausencias = await sql`
    SELECT id, tipo, fecha_inicio, fecha_fin, retribuida, motivo
    FROM ausencias_180
    WHERE empresa_id = ${empresaId}
      AND empleado_id = ${empleadoId}
      AND estado = 'aprobada'
      AND fecha_inicio < ${finMes}::date
      AND fecha_fin >= ${inicioMes}::date
  `.catch(() => []);

  const incidenciasAuto = [];

  for (const aus of ausencias) {
    // Verificar si ya existe una incidencia automática para esta ausencia
    const yaExiste = manuales.some(
      (m) => m.automatica && m.referencia_id === aus.id && m.referencia_tipo === "ausencia"
    );
    if (yaExiste) continue;

    // Calcular días en el mes
    const inicio = new Date(
      Math.max(new Date(aus.fecha_inicio).getTime(), new Date(inicioMes).getTime())
    );
    const fin = new Date(
      Math.min(new Date(aus.fecha_fin).getTime(), new Date(finMes).getTime() - 86400000)
    );
    const dias = Math.max(1, Math.ceil((fin - inicio) / 86400000) + 1);

    if (!aus.retribuida) {
      incidenciasAuto.push({
        tipo: "ausencia_no_retribuida",
        concepto: `Ausencia: ${aus.motivo || aus.tipo} (${dias} días)`,
        importe: 0, // Se calculará como deducción proporcional al salario
        dias,
        automatica: true,
        referencia_id: aus.id,
        referencia_tipo: "ausencia",
      });
    }
  }

  return [...manuales, ...incidenciasAuto];
}

/**
 * Genera nóminas para todos los empleados activos de una empresa
 */
export async function generarNominasParaEmpresa(
  empresaId,
  anio,
  mes,
  empleadoIds,
  createdBy
) {
  // Obtener empleados activos con datos de contrato
  let empleados;
  if (empleadoIds && empleadoIds.length > 0) {
    empleados = await sql`
      SELECT e.*, u.nombre as nombre_empleado
      FROM employees_180 e
      LEFT JOIN users_180 u ON e.user_id = u.id
      WHERE e.empresa_id = ${empresaId}
        AND e.activo = true
        AND e.id = ANY(${empleadoIds})
    `;
  } else {
    empleados = await sql`
      SELECT e.*, u.nombre as nombre_empleado
      FROM employees_180 e
      LEFT JOIN users_180 u ON e.user_id = u.id
      WHERE e.empresa_id = ${empresaId}
        AND e.activo = true
    `;
  }

  // Verificar cuáles ya tienen nómina
  const existentes = await sql`
    SELECT empleado_id FROM nominas_180
    WHERE empresa_id = ${empresaId}
      AND anio = ${anio}
      AND mes = ${mes}
      AND deleted_at IS NULL
  `;
  const existenteIds = new Set(existentes.map((e) => e.empleado_id));

  const generadas = [];
  const saltadas = [];
  const errores = [];

  for (const emp of empleados) {
    if (existenteIds.has(emp.id)) {
      saltadas.push({
        empleado_id: emp.id,
        nombre: emp.nombre_empleado || emp.nombre,
        razon: "Ya tiene nómina para este periodo",
      });
      continue;
    }

    try {
      const incidencias = await recopilarIncidencias(empresaId, emp.id, anio, mes);
      const calculo = calcularNomina(emp, incidencias, { anio, mes });

      const [nomina] = await sql`
        INSERT INTO nominas_180 (
          empresa_id, empleado_id, anio, mes,
          bruto, seguridad_social_empresa, seguridad_social_empleado,
          irpf_retencion, liquido,
          base_cotizacion, tipo_contingencias_comunes, tipo_desempleo,
          tipo_formacion, tipo_fogasa, horas_extra, complementos,
          estado, generada_por, metodo_generacion
        ) VALUES (
          ${empresaId}, ${emp.id}, ${anio}, ${mes},
          ${calculo.bruto}, ${calculo.seguridad_social_empresa}, ${calculo.seguridad_social_empleado},
          ${calculo.irpf_retencion}, ${calculo.liquido},
          ${calculo.base_cotizacion}, ${calculo.tipo_contingencias_comunes}, ${calculo.tipo_desempleo},
          ${calculo.tipo_formacion}, ${calculo.tipo_fogasa}, ${calculo.horas_extra}, ${calculo.complementos},
          'calculada', ${createdBy || null}, 'automatica'
        )
        RETURNING *
      `;

      // Marcar incidencias automáticas como aplicadas
      for (const inc of incidencias) {
        if (inc.automatica && !inc.id) {
          await sql`
            INSERT INTO nomina_incidencias_180 (
              empresa_id, empleado_id, anio, mes,
              tipo, concepto, importe, horas, dias,
              automatica, referencia_id, referencia_tipo, estado, created_by
            ) VALUES (
              ${empresaId}, ${emp.id}, ${anio}, ${mes},
              ${inc.tipo}, ${inc.concepto}, ${inc.importe || 0}, ${inc.horas || 0}, ${inc.dias || 0},
              true, ${inc.referencia_id || null}, ${inc.referencia_tipo || null}, 'aplicada', ${createdBy || null}
            )
          `;
        }
      }

      generadas.push({
        nomina_id: nomina.id,
        empleado_id: emp.id,
        nombre: emp.nombre_empleado || emp.nombre,
        bruto: calculo.bruto,
        liquido: calculo.liquido,
      });
    } catch (err) {
      errores.push({
        empleado_id: emp.id,
        nombre: emp.nombre_empleado || emp.nombre,
        error: err.message,
      });
    }
  }

  return { generadas, saltadas, errores };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
