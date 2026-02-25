// backend/src/services/contabilidadService.js
import { sql } from "../db.js";
import { getPgcPymesCuentas } from "../seeds/pgcPymes.js";

/**
 * Inicializa el PGC PYMES para una empresa (solo si no tiene cuentas).
 */
export async function inicializarPGC(empresaId) {
  const existing = await sql`
    SELECT count(*)::int AS total FROM pgc_cuentas_180
    WHERE empresa_id = ${empresaId}
  `;
  if (existing[0].total > 0) return { inserted: 0, message: "PGC ya inicializado" };

  const cuentas = getPgcPymesCuentas();
  let inserted = 0;

  // Insertar en bloques de 50
  for (let i = 0; i < cuentas.length; i += 50) {
    const batch = cuentas.slice(i, i + 50);
    const values = batch.map((c) => ({
      empresa_id: empresaId,
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      grupo: c.grupo,
      subgrupo: c.subgrupo,
      nivel: c.nivel,
      padre_codigo: c.padre_codigo,
      activa: true,
      es_estandar: true,
    }));

    await sql`INSERT INTO pgc_cuentas_180 ${sql(values)}`;
    inserted += batch.length;
  }

  return { inserted, message: `PGC PYMES inicializado con ${inserted} cuentas` };
}

/**
 * Obtener o crear el ejercicio contable del año dado.
 */
export async function getOrCreateEjercicio(empresaId, anio) {
  const rows = await sql`
    SELECT * FROM ejercicios_contables_180
    WHERE empresa_id = ${empresaId} AND anio = ${anio}
    LIMIT 1
  `;
  if (rows.length > 0) return rows[0];

  const inserted = await sql`
    INSERT INTO ejercicios_contables_180 (empresa_id, anio, fecha_inicio, fecha_fin, estado)
    VALUES (${empresaId}, ${anio}, ${`${anio}-01-01`}, ${`${anio}-12-31`}, 'abierto')
    RETURNING *
  `;
  return inserted[0];
}

/**
 * Obtener siguiente número de asiento para empresa/ejercicio.
 */
export async function siguienteNumeroAsiento(empresaId, ejercicio) {
  const rows = await sql`
    SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente
    FROM asientos_180
    WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio}
  `;
  return rows[0].siguiente;
}

/**
 * Crear un asiento contable con sus líneas (partida doble).
 * Valida que debe = haber antes de guardar.
 *
 * @param {Object} params
 * @param {string} params.empresaId
 * @param {string} params.fecha - YYYY-MM-DD
 * @param {string} params.concepto
 * @param {string} [params.tipo='manual']
 * @param {string} [params.referencia_tipo]
 * @param {string} [params.referencia_id]
 * @param {string} [params.notas]
 * @param {string} [params.creado_por]
 * @param {Array} params.lineas - [{cuenta_codigo, cuenta_nombre, debe, haber, concepto}]
 */
export async function crearAsiento({
  empresaId,
  fecha,
  concepto,
  tipo = "manual",
  referencia_tipo = null,
  referencia_id = null,
  notas = null,
  creado_por = null,
  lineas = [],
}) {
  if (!lineas || lineas.length < 2) {
    throw Object.assign(new Error("Un asiento necesita al menos 2 líneas"), { status: 400 });
  }

  // Validar partida doble
  const totalDebe = lineas.reduce((sum, l) => sum + parseFloat(l.debe || 0), 0);
  const totalHaber = lineas.reduce((sum, l) => sum + parseFloat(l.haber || 0), 0);

  if (Math.abs(totalDebe - totalHaber) > 0.01) {
    throw Object.assign(
      new Error(`El asiento no cuadra: Debe=${totalDebe.toFixed(2)}, Haber=${totalHaber.toFixed(2)}`),
      { status: 400 }
    );
  }

  const ejercicio = new Date(fecha).getFullYear();

  // Verificar que el ejercicio esté abierto
  const ej = await getOrCreateEjercicio(empresaId, ejercicio);
  if (ej.estado === "cerrado") {
    throw Object.assign(new Error(`El ejercicio ${ejercicio} está cerrado`), { status: 400 });
  }

  return await sql.begin(async (tx) => {
    const numero = await siguienteNumeroAsientoTx(tx, empresaId, ejercicio);

    const [asiento] = await tx`
      INSERT INTO asientos_180 (
        empresa_id, numero, fecha, ejercicio, concepto, tipo,
        estado, referencia_tipo, referencia_id, notas, creado_por
      ) VALUES (
        ${empresaId}, ${numero}, ${fecha}, ${ejercicio}, ${concepto}, ${tipo},
        'borrador', ${referencia_tipo}, ${referencia_id}, ${notas}, ${creado_por}
      ) RETURNING *
    `;

    const lineasData = lineas.map((l, idx) => ({
      asiento_id: asiento.id,
      empresa_id: empresaId,
      cuenta_codigo: l.cuenta_codigo,
      cuenta_nombre: l.cuenta_nombre || l.cuenta_codigo,
      debe: parseFloat(l.debe || 0),
      haber: parseFloat(l.haber || 0),
      concepto: l.concepto || concepto,
      orden: idx + 1,
    }));

    await tx`INSERT INTO asiento_lineas_180 ${tx(lineasData)}`;

    const lineasInserted = await tx`
      SELECT * FROM asiento_lineas_180
      WHERE asiento_id = ${asiento.id}
      ORDER BY orden
    `;

    return { ...asiento, lineas: lineasInserted };
  });
}

async function siguienteNumeroAsientoTx(tx, empresaId, ejercicio) {
  const rows = await tx`
    SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente
    FROM asientos_180
    WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio}
  `;
  return rows[0].siguiente;
}

/**
 * Generar asiento automático desde una factura emitida.
 * factura_180 columns: id(int), subtotal, iva_total, total, cliente_id, numero, fecha, retencion_importe
 */
export async function generarAsientoFactura(empresaId, factura, creadoPor) {
  const base = parseFloat(factura.subtotal || 0);
  const iva = parseFloat(factura.iva_total || 0);
  const retencion = parseFloat(factura.retencion_importe || 0);
  const total = parseFloat(factura.total || base + iva - retencion);
  const clienteNombre = factura.cliente_nombre || "Cliente";

  // Auto-crear subcuenta de cliente (430XXXX) si hay cliente_id
  const cuentaCliente = await getOrCreateCuentaTercero(
    empresaId, "cliente", factura.cliente_id, clienteNombre
  );

  const lineas = [
    {
      cuenta_codigo: cuentaCliente.codigo,
      cuenta_nombre: cuentaCliente.nombre,
      debe: total,
      haber: 0,
      concepto: `Factura ${factura.numero || ""}`.trim(),
    },
    {
      cuenta_codigo: "705",
      cuenta_nombre: "Prestaciones de servicios",
      debe: 0,
      haber: base,
      concepto: `Factura ${factura.numero || ""}`.trim(),
    },
  ];

  if (iva > 0) {
    lineas.push({
      cuenta_codigo: "477",
      cuenta_nombre: "Hacienda Pública, IVA repercutido",
      debe: 0,
      haber: iva,
      concepto: `IVA factura ${factura.numero || ""}`.trim(),
    });
  }

  if (retencion > 0) {
    lineas.push({
      cuenta_codigo: "4751",
      cuenta_nombre: "HP acreedora por retenciones practicadas",
      debe: 0,
      haber: retencion,
      concepto: `Retención factura ${factura.numero || ""}`.trim(),
    });
  }

  return crearAsiento({
    empresaId,
    fecha: factura.fecha || new Date().toISOString().split("T")[0],
    concepto: `Factura emitida ${factura.numero || ""} - ${clienteNombre}`.trim(),
    tipo: "auto_factura",
    referencia_tipo: "factura",
    referencia_id: String(factura.id),
    creado_por: creadoPor,
    lineas,
  });
}

/**
 * Generar asiento automático desde un gasto/factura recibida.
 * purchases_180 columns: id(uuid), proveedor, descripcion, base_imponible, iva_importe, total, categoria, fecha_compra, retencion_importe
 */
export async function generarAsientoGasto(empresaId, gasto, creadoPor) {
  const base = parseFloat(gasto.base_imponible || gasto.total || 0);
  const iva = parseFloat(gasto.iva_importe || 0);
  const retencion = parseFloat(gasto.retencion_importe || 0);
  const total = parseFloat(gasto.total || base + iva - retencion);
  const proveedorNombre = gasto.proveedor || "Proveedor";

  // Determinar cuenta de gasto: primero intenta por descripción (más preciso), luego por categoría
  const cuentaGasto = detectarCuentaPorDescripcion(gasto.descripcion, gasto.proveedor)
    || mapCategoriaToCuenta(gasto.categoria);

  // Auto-crear subcuenta de proveedor (4000xx)
  const cuentaProveedor = await getOrCreateCuentaTercero(
    empresaId, "proveedor", gasto.id, proveedorNombre
  );

  const lineas = [
    {
      cuenta_codigo: cuentaGasto.codigo,
      cuenta_nombre: cuentaGasto.nombre,
      debe: base,
      haber: 0,
      concepto: `Gasto: ${gasto.descripcion || ""}`.trim(),
    },
  ];

  if (iva > 0) {
    lineas.push({
      cuenta_codigo: "472",
      cuenta_nombre: "Hacienda Pública, IVA soportado",
      debe: iva,
      haber: 0,
      concepto: `IVA gasto: ${gasto.descripcion || ""}`.trim(),
    });
  }

  if (retencion > 0) {
    lineas.push({
      cuenta_codigo: "4751",
      cuenta_nombre: "HP acreedora por retenciones practicadas",
      debe: retencion,
      haber: 0,
      concepto: `Retención gasto: ${gasto.descripcion || ""}`.trim(),
    });
  }

  lineas.push({
    cuenta_codigo: cuentaProveedor.codigo,
    cuenta_nombre: cuentaProveedor.nombre,
    debe: 0,
    haber: total,
    concepto: `Proveedor: ${proveedorNombre}`.trim(),
  });

  return crearAsiento({
    empresaId,
    fecha: gasto.fecha_compra || gasto.fecha || new Date().toISOString().split("T")[0],
    concepto: `Gasto: ${gasto.descripcion || ""} - ${proveedorNombre}`.trim(),
    tipo: "auto_gasto",
    referencia_tipo: "gasto",
    referencia_id: String(gasto.id),
    creado_por: creadoPor,
    lineas,
  });
}

/**
 * Generar asiento automático desde una nómina.
 * nominas_180 columns: id(uuid), empleado_id, anio, mes, bruto, seguridad_social_empresa, seguridad_social_empleado, irpf_retencion, liquido
 */
export async function generarAsientoNomina(empresaId, nomina, creadoPor) {
  const bruto = parseFloat(nomina.bruto || 0);
  const irpf = parseFloat(nomina.irpf_retencion || 0);
  const ssEmpresa = parseFloat(nomina.seguridad_social_empresa || 0);
  const ssTrabajador = parseFloat(nomina.seguridad_social_empleado || 0);
  const neto = parseFloat(nomina.liquido || bruto - irpf - ssTrabajador);
  const empNombre = nomina.empleado_nombre || "Empleado";
  const periodo = `${String(nomina.mes || 1).padStart(2, "0")}/${nomina.anio || ""}`;

  const lineas = [];

  // DEBE: Sueldos y salarios
  if (bruto > 0) {
    lineas.push({
      cuenta_codigo: "640",
      cuenta_nombre: "Sueldos y salarios",
      debe: bruto,
      haber: 0,
      concepto: `Nómina ${empNombre} ${periodo}`,
    });
  }

  // DEBE: SS a cargo empresa
  if (ssEmpresa > 0) {
    lineas.push({
      cuenta_codigo: "642",
      cuenta_nombre: "Seguridad Social a cargo de la empresa",
      debe: ssEmpresa,
      haber: 0,
      concepto: `SS empresa ${empNombre}`,
    });
  }

  // HABER: IRPF retenido
  if (irpf > 0) {
    lineas.push({
      cuenta_codigo: "4751",
      cuenta_nombre: "HP acreedora por retenciones practicadas",
      debe: 0,
      haber: irpf,
      concepto: `IRPF ${empNombre}`,
    });
  }

  // HABER: SS total (empresa + trabajador)
  if (ssEmpresa + ssTrabajador > 0) {
    lineas.push({
      cuenta_codigo: "476",
      cuenta_nombre: "Organismos de la Seguridad Social, acreedores",
      debe: 0,
      haber: ssEmpresa + ssTrabajador,
      concepto: `SS total ${empNombre}`,
    });
  }

  // HABER: Neto a pagar
  if (neto > 0) {
    lineas.push({
      cuenta_codigo: "465",
      cuenta_nombre: "Remuneraciones pendientes de pago",
      debe: 0,
      haber: neto,
      concepto: `Neto ${empNombre}`,
    });
  }

  if (lineas.length < 2) {
    throw new Error(`Nómina ${nomina.id} sin importes válidos`);
  }

  return crearAsiento({
    empresaId,
    fecha: `${nomina.anio || new Date().getFullYear()}-${String(nomina.mes || 1).padStart(2, "0")}-28`,
    concepto: `Nómina ${empNombre} - ${periodo}`,
    tipo: "auto_nomina",
    referencia_tipo: "nomina",
    referencia_id: String(nomina.id),
    creado_por: creadoPor,
    lineas,
  });
}

/**
 * Calcula el balance de situación a una fecha.
 * Agrupa saldos por tipo de cuenta (activo, pasivo, patrimonio).
 */
export async function calcularBalance(empresaId, fechaHasta) {
  const rows = await sql`
    SELECT
      c.tipo,
      c.grupo,
      l.cuenta_codigo,
      l.cuenta_nombre,
      SUM(l.debe) AS total_debe,
      SUM(l.haber) AS total_haber,
      SUM(l.debe) - SUM(l.haber) AS saldo
    FROM asiento_lineas_180 l
    JOIN asientos_180 a ON a.id = l.asiento_id
    JOIN pgc_cuentas_180 c ON c.empresa_id = l.empresa_id AND c.codigo = l.cuenta_codigo
    WHERE l.empresa_id = ${empresaId}
      AND a.estado != 'anulado'
      AND a.fecha <= ${fechaHasta}
    GROUP BY c.tipo, c.grupo, l.cuenta_codigo, l.cuenta_nombre
    HAVING SUM(l.debe) - SUM(l.haber) != 0
    ORDER BY l.cuenta_codigo
  `;

  const activo = [];
  const pasivo = [];
  const patrimonio = [];
  let totalActivo = 0;
  let totalPasivo = 0;
  let totalPatrimonio = 0;

  for (const r of rows) {
    const saldo = parseFloat(r.saldo);
    const entry = {
      cuenta_codigo: r.cuenta_codigo,
      cuenta_nombre: r.cuenta_nombre,
      grupo: r.grupo,
      saldo: Math.abs(saldo),
    };

    if (r.tipo === "activo") {
      // Cuentas de activo: saldo deudor (debe > haber)
      entry.saldo = saldo; // positivo = activo
      activo.push(entry);
      totalActivo += saldo;
    } else if (r.tipo === "pasivo") {
      // Cuentas de pasivo: saldo acreedor (haber > debe)
      entry.saldo = -saldo; // invertir signo
      pasivo.push(entry);
      totalPasivo += -saldo;
    } else if (r.tipo === "patrimonio") {
      entry.saldo = -saldo;
      patrimonio.push(entry);
      totalPatrimonio += -saldo;
    }
  }

  return {
    fecha: fechaHasta,
    activo: { cuentas: activo, total: totalActivo },
    pasivo: { cuentas: pasivo, total: totalPasivo },
    patrimonio: { cuentas: patrimonio, total: totalPatrimonio },
    cuadra: Math.abs(totalActivo - (totalPasivo + totalPatrimonio)) < 0.01,
  };
}

/**
 * Calcula la cuenta de Pérdidas y Ganancias de un periodo.
 */
export async function calcularPyG(empresaId, fechaDesde, fechaHasta) {
  const rows = await sql`
    SELECT
      c.tipo,
      c.grupo,
      c.subgrupo,
      l.cuenta_codigo,
      l.cuenta_nombre,
      SUM(l.debe) AS total_debe,
      SUM(l.haber) AS total_haber
    FROM asiento_lineas_180 l
    JOIN asientos_180 a ON a.id = l.asiento_id
    JOIN pgc_cuentas_180 c ON c.empresa_id = l.empresa_id AND c.codigo = l.cuenta_codigo
    WHERE l.empresa_id = ${empresaId}
      AND a.estado != 'anulado'
      AND a.fecha >= ${fechaDesde}
      AND a.fecha <= ${fechaHasta}
      AND c.tipo IN ('ingreso', 'gasto')
    GROUP BY c.tipo, c.grupo, c.subgrupo, l.cuenta_codigo, l.cuenta_nombre
    ORDER BY l.cuenta_codigo
  `;

  const ingresos = [];
  const gastos = [];
  let totalIngresos = 0;
  let totalGastos = 0;

  for (const r of rows) {
    const debe = parseFloat(r.total_debe);
    const haber = parseFloat(r.total_haber);

    if (r.tipo === "ingreso") {
      const importe = haber - debe; // Ingresos van por el haber
      ingresos.push({
        cuenta_codigo: r.cuenta_codigo,
        cuenta_nombre: r.cuenta_nombre,
        grupo: r.grupo,
        subgrupo: r.subgrupo,
        importe,
      });
      totalIngresos += importe;
    } else if (r.tipo === "gasto") {
      const importe = debe - haber; // Gastos van por el debe
      gastos.push({
        cuenta_codigo: r.cuenta_codigo,
        cuenta_nombre: r.cuenta_nombre,
        grupo: r.grupo,
        subgrupo: r.subgrupo,
        importe,
      });
      totalGastos += importe;
    }
  }

  return {
    periodo: { desde: fechaDesde, hasta: fechaHasta },
    ingresos: { cuentas: ingresos, total: totalIngresos },
    gastos: { cuentas: gastos, total: totalGastos },
    resultado: totalIngresos - totalGastos,
  };
}

/**
 * Obtener libro mayor de una cuenta (todos sus movimientos).
 */
export async function libroMayor(empresaId, cuentaCodigo, fechaDesde, fechaHasta) {
  const movimientos = await sql`
    SELECT
      a.numero AS asiento_numero,
      a.fecha,
      a.concepto AS asiento_concepto,
      l.debe,
      l.haber,
      l.concepto AS linea_concepto,
      a.tipo AS asiento_tipo,
      a.estado AS asiento_estado
    FROM asiento_lineas_180 l
    JOIN asientos_180 a ON a.id = l.asiento_id
    WHERE l.empresa_id = ${empresaId}
      AND l.cuenta_codigo = ${cuentaCodigo}
      AND a.estado != 'anulado'
      AND a.fecha >= ${fechaDesde}
      AND a.fecha <= ${fechaHasta}
    ORDER BY a.fecha, a.numero, l.orden
  `;

  let saldo = 0;
  const detalle = movimientos.map((m) => {
    const debe = parseFloat(m.debe);
    const haber = parseFloat(m.haber);
    saldo += debe - haber;
    return {
      ...m,
      debe,
      haber,
      saldo_acumulado: saldo,
    };
  });

  return {
    cuenta_codigo: cuentaCodigo,
    periodo: { desde: fechaDesde, hasta: fechaHasta },
    movimientos: detalle,
    total_debe: detalle.reduce((s, m) => s + m.debe, 0),
    total_haber: detalle.reduce((s, m) => s + m.haber, 0),
    saldo_final: saldo,
  };
}

/**
 * Cerrar un ejercicio contable.
 * Genera asiento de regularización (salda cuentas 6 y 7 contra 129) y asiento de cierre.
 */
export async function cerrarEjercicio(empresaId, anio, creadoPor) {
  const ej = await getOrCreateEjercicio(empresaId, anio);
  if (ej.estado === "cerrado") {
    throw Object.assign(new Error(`El ejercicio ${anio} ya está cerrado`), { status: 400 });
  }

  const fechaFin = `${anio}-12-31`;

  // 1. Calcular PyG para obtener resultado
  const pyg = await calcularPyG(empresaId, `${anio}-01-01`, fechaFin);

  // 2. Generar asiento de regularización (saldar 6 y 7 contra 129)
  const lineasRegularizacion = [];

  // Saldar gastos (cuentas 6xx): tienen saldo deudor, se saldan por el haber
  for (const g of pyg.gastos.cuentas) {
    if (g.importe !== 0) {
      lineasRegularizacion.push({
        cuenta_codigo: g.cuenta_codigo,
        cuenta_nombre: g.cuenta_nombre,
        debe: 0,
        haber: g.importe,
        concepto: "Regularización de resultados",
      });
    }
  }

  // Saldar ingresos (cuentas 7xx): tienen saldo acreedor, se saldan por el debe
  for (const i of pyg.ingresos.cuentas) {
    if (i.importe !== 0) {
      lineasRegularizacion.push({
        cuenta_codigo: i.cuenta_codigo,
        cuenta_nombre: i.cuenta_nombre,
        debe: i.importe,
        haber: 0,
        concepto: "Regularización de resultados",
      });
    }
  }

  // Cuenta 129 - Resultado del ejercicio
  if (pyg.resultado >= 0) {
    lineasRegularizacion.push({
      cuenta_codigo: "129",
      cuenta_nombre: "Resultado del ejercicio",
      debe: 0,
      haber: pyg.resultado,
      concepto: `Beneficio del ejercicio ${anio}`,
    });
  } else {
    lineasRegularizacion.push({
      cuenta_codigo: "129",
      cuenta_nombre: "Resultado del ejercicio",
      debe: Math.abs(pyg.resultado),
      haber: 0,
      concepto: `Pérdida del ejercicio ${anio}`,
    });
  }

  let asientoRegularizacion = null;
  if (lineasRegularizacion.length >= 2) {
    asientoRegularizacion = await crearAsiento({
      empresaId,
      fecha: fechaFin,
      concepto: `Regularización de resultados ejercicio ${anio}`,
      tipo: "regularizacion",
      creado_por: creadoPor,
      lineas: lineasRegularizacion,
    });

    // Validar automáticamente
    await sql`
      UPDATE asientos_180
      SET estado = 'validado', validado_por = ${creadoPor}, validado_at = now()
      WHERE id = ${asientoRegularizacion.id}
    `;
  }

  // 3. Marcar ejercicio como cerrado
  await sql`
    UPDATE ejercicios_contables_180
    SET estado = 'cerrado',
        asiento_cierre_id = ${asientoRegularizacion?.id || null},
        updated_at = now()
    WHERE id = ${ej.id}
  `;

  return {
    ejercicio: anio,
    resultado: pyg.resultado,
    asiento_regularizacion_id: asientoRegularizacion?.id || null,
    message: `Ejercicio ${anio} cerrado. Resultado: ${pyg.resultado >= 0 ? "Beneficio" : "Pérdida"} de ${Math.abs(pyg.resultado).toFixed(2)}€`,
  };
}

/**
 * Auto-generar asientos desde facturas/gastos/nóminas existentes de un período.
 * Solo genera asientos para movimientos que aún no tienen asiento asociado.
 * Devuelve resumen con contadores y lista de ya existentes.
 */
export async function generarAsientosPeriodo(empresaId, fechaDesde, fechaHasta, creadoPor) {
  const resultados = { facturas: 0, gastos: 0, nominas: 0, errores: [], ya_existentes: { facturas: 0, gastos: 0, nominas: 0 } };

  // Ensure PGC is initialized
  await inicializarPGC(empresaId);

  // ============== FACTURAS EMITIDAS ==============
  // Count total and already registered
  const [facturaStats] = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(CASE WHEN EXISTS (
        SELECT 1 FROM asientos_180 a
        WHERE a.empresa_id = f.empresa_id AND a.referencia_tipo = 'factura'
          AND a.referencia_id = f.id::text AND a.estado != 'anulado'
      ) THEN 1 END)::int AS con_asiento
    FROM factura_180 f
    WHERE f.empresa_id = ${empresaId}
      AND f.fecha >= ${fechaDesde} AND f.fecha <= ${fechaHasta}
  `;
  resultados.ya_existentes.facturas = facturaStats.con_asiento;

  // Facturas sin asiento - join clients_180 for nombre
  const facturas = await sql`
    SELECT f.*, c.nombre AS cliente_nombre
    FROM factura_180 f
    LEFT JOIN clients_180 c ON c.id = f.cliente_id
    WHERE f.empresa_id = ${empresaId}
      AND f.fecha >= ${fechaDesde}
      AND f.fecha <= ${fechaHasta}
      AND NOT EXISTS (
        SELECT 1 FROM asientos_180 a
        WHERE a.empresa_id = ${empresaId}
          AND a.referencia_tipo = 'factura'
          AND a.referencia_id = f.id::text
          AND a.estado != 'anulado'
      )
    ORDER BY f.fecha
  `;

  for (const f of facturas) {
    try {
      await generarAsientoFactura(empresaId, f, creadoPor);
      resultados.facturas++;
    } catch (err) {
      resultados.errores.push(`Factura ${f.numero || f.id}: ${err.message}`);
    }
  }

  // ============== GASTOS / COMPRAS ==============
  const [gastoStats] = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(CASE WHEN EXISTS (
        SELECT 1 FROM asientos_180 a
        WHERE a.empresa_id = g.empresa_id AND a.referencia_tipo = 'gasto'
          AND a.referencia_id = g.id::text AND a.estado != 'anulado'
      ) THEN 1 END)::int AS con_asiento
    FROM purchases_180 g
    WHERE g.empresa_id = ${empresaId} AND g.activo = true
      AND g.fecha_compra >= ${fechaDesde} AND g.fecha_compra <= ${fechaHasta}
  `;
  resultados.ya_existentes.gastos = gastoStats.con_asiento;

  const gastos = await sql`
    SELECT g.*
    FROM purchases_180 g
    WHERE g.empresa_id = ${empresaId}
      AND g.activo = true
      AND g.fecha_compra >= ${fechaDesde}
      AND g.fecha_compra <= ${fechaHasta}
      AND NOT EXISTS (
        SELECT 1 FROM asientos_180 a
        WHERE a.empresa_id = ${empresaId}
          AND a.referencia_tipo = 'gasto'
          AND a.referencia_id = g.id::text
          AND a.estado != 'anulado'
      )
    ORDER BY g.fecha_compra
  `;

  for (const g of gastos) {
    try {
      await generarAsientoGasto(empresaId, g, creadoPor);
      resultados.gastos++;
    } catch (err) {
      resultados.errores.push(`Gasto ${g.descripcion || g.id}: ${err.message}`);
    }
  }

  // ============== NÓMINAS ==============
  const fdDesde = new Date(fechaDesde);
  const fdHasta = new Date(fechaHasta);
  const periodoDesde = fdDesde.getFullYear() * 100 + (fdDesde.getMonth() + 1);
  const periodoHasta = fdHasta.getFullYear() * 100 + (fdHasta.getMonth() + 1);

  const [nominaStats] = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(CASE WHEN EXISTS (
        SELECT 1 FROM asientos_180 a
        WHERE a.empresa_id = n.empresa_id AND a.referencia_tipo = 'nomina'
          AND a.referencia_id = n.id::text AND a.estado != 'anulado'
      ) THEN 1 END)::int AS con_asiento
    FROM nominas_180 n
    WHERE n.empresa_id = ${empresaId}
      AND (n.anio * 100 + n.mes) >= ${periodoDesde}
      AND (n.anio * 100 + n.mes) <= ${periodoHasta}
  `;
  resultados.ya_existentes.nominas = nominaStats.con_asiento;

  const nominas = await sql`
    SELECT n.*, e.nombre AS empleado_nombre
    FROM nominas_180 n
    LEFT JOIN employees_180 e ON e.id = n.empleado_id
    WHERE n.empresa_id = ${empresaId}
      AND (n.anio * 100 + n.mes) >= ${periodoDesde}
      AND (n.anio * 100 + n.mes) <= ${periodoHasta}
      AND NOT EXISTS (
        SELECT 1 FROM asientos_180 a
        WHERE a.empresa_id = ${empresaId}
          AND a.referencia_tipo = 'nomina'
          AND a.referencia_id = n.id::text
          AND a.estado != 'anulado'
      )
    ORDER BY n.anio, n.mes
  `;

  for (const n of nominas) {
    try {
      await generarAsientoNomina(empresaId, n, creadoPor);
      resultados.nominas++;
    } catch (err) {
      resultados.errores.push(`Nómina ${n.empleado_nombre || n.id}: ${err.message}`);
    }
  }

  return resultados;
}

// =============================================
// Terceros (subcuentas 430x clientes / 400x proveedores)
// =============================================

/**
 * Obtiene o crea una subcuenta de tercero en el PGC.
 * - Clientes: 4300xx (bajo 430 - Clientes)
 * - Proveedores: 4000xx (bajo 400 - Proveedores)
 *
 * @param {string} empresaId
 * @param {'cliente'|'proveedor'} tipo - Tipo de tercero
 * @param {string|number|null} terceroId - ID del cliente o proveedor (para buscar existente)
 * @param {string} nombre - Nombre del tercero
 * @returns {{ codigo: string, nombre: string }}
 */
async function getOrCreateCuentaTercero(empresaId, tipo, terceroId, nombre) {
  const prefijo = tipo === "cliente" ? "4300" : "4000";
  const cuentaPadre = tipo === "cliente" ? "430" : "400";
  const tipoContable = tipo === "cliente" ? "activo" : "pasivo";
  const nombreBase = tipo === "cliente" ? "Clientes" : "Proveedores";

  // If no terceroId, return the generic parent account
  if (!terceroId) {
    return { codigo: cuentaPadre, nombre: nombreBase };
  }

  // Check if a subcuenta already exists for this tercero (stored in metadata or by name match)
  const terceroIdStr = String(terceroId);

  // Look for existing subcuenta that matches this tercero
  const existing = await sql`
    SELECT codigo, nombre FROM pgc_cuentas_180
    WHERE empresa_id = ${empresaId}
      AND codigo LIKE ${prefijo + '%'}
      AND padre_codigo = ${cuentaPadre}
      AND nombre ILIKE ${'%' + nombre.substring(0, 20) + '%'}
    LIMIT 1
  `;

  if (existing.length > 0) {
    return { codigo: existing[0].codigo, nombre: existing[0].nombre };
  }

  // Generate next sequential code: 430001, 430002, ... or 400001, 400002, ...
  const [maxRow] = await sql`
    SELECT MAX(codigo) AS max_codigo FROM pgc_cuentas_180
    WHERE empresa_id = ${empresaId}
      AND codigo LIKE ${prefijo + '%'}
      AND LENGTH(codigo) > ${prefijo.length}
      AND padre_codigo = ${cuentaPadre}
  `;

  let nextNum = 1;
  if (maxRow.max_codigo) {
    const suffix = maxRow.max_codigo.substring(prefijo.length);
    nextNum = parseInt(suffix, 10) + 1;
  }

  const nuevoCodigo = prefijo + String(nextNum).padStart(3, "0");
  const nuevaCuentaNombre = `${nombreBase} - ${nombre}`.substring(0, 100);

  // Ensure parent account exists
  const parentExists = await sql`
    SELECT 1 FROM pgc_cuentas_180
    WHERE empresa_id = ${empresaId} AND codigo = ${cuentaPadre}
    LIMIT 1
  `;
  if (parentExists.length === 0) {
    await sql`
      INSERT INTO pgc_cuentas_180 (empresa_id, codigo, nombre, tipo, grupo, subgrupo, nivel, padre_codigo, activa, es_estandar)
      VALUES (${empresaId}, ${cuentaPadre}, ${nombreBase}, ${tipoContable}, 4, ${tipo === "cliente" ? 43 : 40}, 3, ${tipo === "cliente" ? '43' : '40'}, true, true)
    `;
  }

  // Create the subcuenta
  await sql`
    INSERT INTO pgc_cuentas_180 (empresa_id, codigo, nombre, tipo, grupo, subgrupo, nivel, padre_codigo, activa, es_estandar)
    VALUES (${empresaId}, ${nuevoCodigo}, ${nuevaCuentaNombre}, ${tipoContable}, 4, ${tipo === "cliente" ? 43 : 40}, 4, ${cuentaPadre}, true, false)
    ON CONFLICT DO NOTHING
  `;

  return { codigo: nuevoCodigo, nombre: nuevaCuentaNombre };
}

// =============================================
// Helpers
// =============================================

function mapCategoriaToCuenta(categoria) {
  const map = {
    alquiler: { codigo: "621", nombre: "Arrendamientos y cánones" },
    reparaciones: { codigo: "622", nombre: "Reparaciones y conservación" },
    profesionales: { codigo: "623", nombre: "Servicios de profesionales independientes" },
    transporte: { codigo: "624", nombre: "Transportes" },
    seguros: { codigo: "625", nombre: "Primas de seguros" },
    bancarios: { codigo: "626", nombre: "Servicios bancarios y similares" },
    publicidad: { codigo: "627", nombre: "Publicidad, propaganda y relaciones públicas" },
    suministros: { codigo: "628", nombre: "Suministros" },
    material_oficina: { codigo: "629", nombre: "Otros servicios" },
    compras: { codigo: "600", nombre: "Compras de mercaderías" },
    materias_primas: { codigo: "601", nombre: "Compras de materias primas" },
    subcontratacion: { codigo: "607", nombre: "Trabajos realizados por otras empresas" },
    tributos: { codigo: "631", nombre: "Otros tributos" },
    sueldos: { codigo: "640", nombre: "Sueldos y salarios" },
    ss_empresa: { codigo: "642", nombre: "Seguridad Social a cargo de la empresa" },
    amortizacion: { codigo: "681", nombre: "Amortización del inmovilizado material" },
    intereses: { codigo: "662", nombre: "Intereses de deudas" },
    otros_gastos: { codigo: "629", nombre: "Otros servicios" },
  };

  return map[categoria] || { codigo: "629", nombre: "Otros servicios" };
}

/**
 * Detecta la cuenta PGC analizando la descripción y proveedor del gasto.
 * Devuelve null si no puede determinar una cuenta específica (se usará el fallback por categoría).
 *
 * Esto resuelve casos como:
 * - "RECIBO DE AUTÓNOMO ENERO-2026" → 642 (SS a cargo empresa)
 * - "SEGURIDAD SOCIAL" → 642
 * - "CUOTA AUTÓNOMOS RETA" → 642
 * - "TESORERÍA GENERAL SS" → 642
 * - "MUTUA ACCIDENTES" → 649
 * - "ALQUILER LOCAL" → 621
 * - "FACTURA LUZ / GAS / AGUA / TELÉFONO" → 628
 * - "GESTORÍA / ASESORÍA" → 623
 * - "NOTARÍA / REGISTRO" → 623
 * - "ABOGADO / LETRADO" → 623
 */
function detectarCuentaPorDescripcion(descripcion, proveedor) {
  if (!descripcion && !proveedor) return null;

  const texto = `${descripcion || ""} ${proveedor || ""}`.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Reglas ordenadas de más específica a menos específica
  const reglas = [
    // --- SEGURIDAD SOCIAL / AUTÓNOMOS (642) ---
    {
      patron: /AUTONOMO|CUOTA\s*(DE\s*)?AUTONOMO|RETA\b|RECIBO\s*(DE\s*)?(EL\s*)?AUTONOMO|COTIZACION\s*AUTONOMO|REGIMEN\s*ESPECIAL\s*TRABAJADOR/,
      cuenta: { codigo: "642", nombre: "Seguridad Social a cargo de la empresa" },
    },
    {
      patron: /SEGURIDAD\s*SOCIAL|TESORERIA\s*GENERAL|TGSS|SEG\.?\s*SOC|S\.?\s*SOCIAL/,
      cuenta: { codigo: "642", nombre: "Seguridad Social a cargo de la empresa" },
    },
    {
      patron: /COTIZACION\s*(SOCIAL|EMPRESA|TRABAJADOR)|CUOTA\s*OBRERA|CUOTA\s*PATRONAL/,
      cuenta: { codigo: "642", nombre: "Seguridad Social a cargo de la empresa" },
    },

    // --- MUTUAS / GASTOS SOCIALES (649) ---
    {
      patron: /MUTUA\s*(DE\s*)?(ACCIDENTE|TRABAJO|LABORAL)|PREVENCION\s*(DE\s*)?RIESGOS|SERVICIO\s*PREVENCION|RECONOCIMIENTO\s*MEDICO/,
      cuenta: { codigo: "649", nombre: "Otros gastos sociales" },
    },

    // --- SUELDOS (640) ---
    {
      patron: /NOMINA|SUELDO|SALARIO|PAGA\s*EXTRA|FINIQUITO|LIQUIDACION\s*(DE\s*)?(HABERES|SUELDO)/,
      cuenta: { codigo: "640", nombre: "Sueldos y salarios" },
    },

    // --- INDEMNIZACIONES (641) ---
    {
      patron: /INDEMNIZACION|DESPIDO|ERE\b|ERTE\b/,
      cuenta: { codigo: "641", nombre: "Indemnizaciones" },
    },

    // --- ALQUILERES (621) ---
    {
      patron: /ALQUILER|ARRENDAMIENTO|RENTA\s*(MENSUAL|LOCAL|OFICINA|NAVE)|LEASING/,
      cuenta: { codigo: "621", nombre: "Arrendamientos y cánones" },
    },

    // --- SUMINISTROS (628) ---
    {
      patron: /\b(LUZ|ELECTRIC|ENDESA|IBERDROLA|NATURGY|REPSOL\s*LUZ|EDP|HOLALUZ|FACTOR\s*ENERGIA)\b/,
      cuenta: { codigo: "628", nombre: "Suministros" },
    },
    {
      patron: /\b(GAS\s*NATURAL|BUTANO|PROPANO|CALEFACCION)\b/,
      cuenta: { codigo: "628", nombre: "Suministros" },
    },
    {
      patron: /\b(AGUA|CANAL\s*DE|AGUAS\s*DE|EMASA|EMASESA|AQUALIA)\b/,
      cuenta: { codigo: "628", nombre: "Suministros" },
    },
    {
      patron: /\b(TELEFON|MOVISTAR|VODAFONE|ORANGE|MASMOVIL|YOIGO|DIGI\b|O2\b|FIBRA|INTERNET|ADSL)\b/,
      cuenta: { codigo: "628", nombre: "Suministros" },
    },

    // --- SEGUROS (625) ---
    {
      patron: /SEGURO|POLIZA|PRIMA\s*(DE\s*)?SEGURO|ASEGURADORA|MAPFRE|ALLIANZ|AXA\b|ZURICH|GENERALI|MUTUA\s*MADRILENA|LINEA\s*DIRECTA/,
      cuenta: { codigo: "625", nombre: "Primas de seguros" },
    },

    // --- SERVICIOS PROFESIONALES (623) ---
    {
      patron: /GESTORIA|ASESORIA|ASESOR\s*(FISCAL|CONTABLE|LABORAL)|CONSULTORIA|ABOGADO|LETRADO|NOTARI|REGISTRO\s*(MERCANTIL|PROPIEDAD)|PROCURADOR|AUDITORIA|AUDITOR/,
      cuenta: { codigo: "623", nombre: "Servicios de profesionales independientes" },
    },

    // --- PUBLICIDAD (627) ---
    {
      patron: /PUBLICIDAD|MARKETING|GOOGLE\s*ADS|META\s*ADS|FACEBOOK\s*ADS|INSTAGRAM|CAMPANA\s*(PUBLICITARIA|MARKETING)|SEO\b|SEM\b|PROPAGANDA/,
      cuenta: { codigo: "627", nombre: "Publicidad, propaganda y relaciones públicas" },
    },

    // --- SERVICIOS BANCARIOS (626) ---
    {
      patron: /COMISION\s*(BANCARIA|BANCO|MANTENIMIENTO|TARJETA)|GASTOS\s*BANCARIOS|INTERESES\s*BANCARIOS|SWIFT|TRANSFERENCIA\s*COMISION/,
      cuenta: { codigo: "626", nombre: "Servicios bancarios y similares" },
    },

    // --- INTERESES (662) ---
    {
      patron: /INTERESES?\s*(PRESTAMO|HIPOTECA|CREDITO|DEUDA|FINANC)/,
      cuenta: { codigo: "662", nombre: "Intereses de deudas" },
    },

    // --- REPARACIONES (622) ---
    {
      patron: /REPARACION|MANTENIMIENTO|AVERIA|REVISION\s*(TECNICA|VEHICULO|MAQUINARIA)/,
      cuenta: { codigo: "622", nombre: "Reparaciones y conservación" },
    },

    // --- TRANSPORTE (624) ---
    {
      patron: /TRANSPORTE|MENSAJERIA|ENVIO|CORREOS|SEUR|MRW|DHL|UPS|FEDEX|PAQUETERIA|PORTE/,
      cuenta: { codigo: "624", nombre: "Transportes" },
    },

    // --- TRIBUTOS (631) ---
    {
      patron: /IBI\b|IMPUESTO\s*(BIENES|VEHICULO|CIRCULACION|ACTIVIDADES|MUNICIPAL)|IAE\b|BASURA|TASA\s*(MUNICIPAL|BASURA|RESIDUOS)|PLUSVALIA/,
      cuenta: { codigo: "631", nombre: "Otros tributos" },
    },

    // --- AMORTIZACIÓN (681) ---
    {
      patron: /AMORTIZACION|DEPRECIACION/,
      cuenta: { codigo: "681", nombre: "Amortización del inmovilizado material" },
    },
  ];

  for (const regla of reglas) {
    if (regla.patron.test(texto)) {
      return regla.cuenta;
    }
  }

  return null; // No se pudo determinar → se usará el fallback por categoría
}

/**
 * Re-revisa las cuentas contables de asientos auto-generados desde gastos.
 * Compara la cuenta actual del gasto (línea 6xx) con la que detectaría ahora
 * la lógica de `detectarCuentaPorDescripcion`. Si difiere, corrige la línea.
 *
 * @param {string} empresaId
 * @param {string[]} asientoIds - IDs específicos a revisar (opcional, si vacío revisa todos los auto_gasto)
 * @param {boolean} soloSimular - true = solo devuelve cambios sin aplicarlos
 * @returns {{ revisados, corregidos, sin_cambios, errores, cambios[] }}
 */
export async function revisarCuentasAsientos(empresaId, asientoIds = [], soloSimular = false) {
  const resultado = { revisados: 0, corregidos: 0, sin_cambios: 0, errores: [], cambios: [] };

  // Obtener asientos auto_gasto con referencia a gasto
  let asientos;
  if (asientoIds.length > 0) {
    asientos = await sql`
      SELECT a.id, a.concepto, a.referencia_id, a.estado
      FROM asientos_180 a
      WHERE a.empresa_id = ${empresaId}
        AND a.id = ANY(${asientoIds})
        AND a.estado != 'anulado'
    `;
  } else {
    asientos = await sql`
      SELECT a.id, a.concepto, a.referencia_id, a.estado
      FROM asientos_180 a
      WHERE a.empresa_id = ${empresaId}
        AND a.tipo = 'auto_gasto'
        AND a.estado != 'anulado'
      ORDER BY a.fecha
    `;
  }

  for (const asiento of asientos) {
    resultado.revisados++;
    try {
      // Buscar el gasto original para obtener descripción y proveedor
      let gasto = null;
      if (asiento.referencia_id) {
        const [g] = await sql`
          SELECT id, descripcion, proveedor, categoria
          FROM purchases_180
          WHERE id = ${asiento.referencia_id}::uuid AND empresa_id = ${empresaId}
        `;
        gasto = g;
      }

      // Si no encontramos el gasto, intentar extraer info del concepto del asiento
      const textoAnalisis = gasto
        ? `${gasto.descripcion || ""} ${gasto.proveedor || ""}`
        : asiento.concepto || "";

      const proveedorAnalisis = gasto ? gasto.proveedor : null;

      // Detectar cuenta correcta
      const cuentaCorrecta = detectarCuentaPorDescripcion(textoAnalisis, proveedorAnalisis)
        || (gasto ? mapCategoriaToCuenta(gasto.categoria) : null);

      if (!cuentaCorrecta) {
        resultado.sin_cambios++;
        continue;
      }

      // Obtener las líneas del asiento - buscar la línea de gasto (cuenta 6xx)
      const lineas = await sql`
        SELECT id, cuenta_codigo, cuenta_nombre, debe, haber
        FROM asiento_lineas_180
        WHERE asiento_id = ${asiento.id} AND empresa_id = ${empresaId}
        ORDER BY orden
      `;

      const lineaGasto = lineas.find(l => l.cuenta_codigo.startsWith("6") && Number(l.debe) > 0);

      if (!lineaGasto) {
        resultado.sin_cambios++;
        continue;
      }

      // Comprobar si la cuenta es diferente
      if (lineaGasto.cuenta_codigo === cuentaCorrecta.codigo) {
        resultado.sin_cambios++;
        continue;
      }

      // Hay corrección
      resultado.cambios.push({
        asiento_id: asiento.id,
        concepto: asiento.concepto,
        estado: asiento.estado,
        linea_id: lineaGasto.id,
        cuenta_anterior: { codigo: lineaGasto.cuenta_codigo, nombre: lineaGasto.cuenta_nombre },
        cuenta_nueva: { codigo: cuentaCorrecta.codigo, nombre: cuentaCorrecta.nombre },
        importe: Number(lineaGasto.debe),
      });

      if (!soloSimular) {
        await sql`
          UPDATE asiento_lineas_180
          SET cuenta_codigo = ${cuentaCorrecta.codigo},
              cuenta_nombre = ${cuentaCorrecta.nombre}
          WHERE id = ${lineaGasto.id}
        `;
        resultado.corregidos++;
      } else {
        resultado.corregidos++;
      }
    } catch (err) {
      resultado.errores.push(`Asiento ${asiento.id}: ${err.message}`);
    }
  }

  resultado.sin_cambios = resultado.revisados - resultado.corregidos - resultado.errores.length;
  return resultado;
}
