// backend/src/services/contabilidadService.js
import { sql } from "../db.js";
import { getPgcPymesCuentas } from "../seeds/pgcPymes.js";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

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
  revisado_ia = false,
  pendiente_revision = false,
  revision_motivo = null,
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
        estado, referencia_tipo, referencia_id, notas, creado_por, revisado_ia,
        pendiente_revision, revision_motivo
      ) VALUES (
        ${empresaId}, ${numero}, ${fecha}, ${ejercicio}, ${concepto}, ${tipo},
        'borrador', ${referencia_tipo}, ${referencia_id}, ${notas}, ${creado_por}, ${revisado_ia || false},
        ${pendiente_revision || false}, ${revision_motivo}
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
export async function generarAsientoFactura(empresaId, factura, creadoPor, cuentaIngresoIA = null) {
  const base = parseFloat(factura.subtotal || 0);
  const iva = parseFloat(factura.iva_total || 0);
  const retencion = parseFloat(factura.retencion_importe || 0);
  const total = parseFloat(factura.total || base + iva - retencion);
  const clienteNombre = factura.cliente_nombre || "Cliente";

  // Auto-crear subcuenta de cliente (430XXXX) si hay cliente_id
  const cuentaCliente = await getOrCreateCuentaTercero(
    empresaId, "cliente", factura.cliente_id, clienteNombre
  );

  // Cuenta de ingreso: IA pre-clasificada > fallback 705
  const cuentaIngreso = cuentaIngresoIA || { codigo: "705", nombre: "Prestaciones de servicios" };

  const lineas = [
    {
      cuenta_codigo: cuentaCliente.codigo,
      cuenta_nombre: cuentaCliente.nombre,
      debe: total,
      haber: 0,
      concepto: `Factura ${factura.numero || ""}`.trim(),
    },
    {
      cuenta_codigo: cuentaIngreso.codigo,
      cuenta_nombre: cuentaIngreso.nombre,
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
    revisado_ia: !!cuentaIngresoIA,
    lineas,
  });
}

/**
 * Generar asiento automático desde un gasto/factura recibida.
 * purchases_180 columns: id(uuid), proveedor, descripcion, base_imponible, iva_importe, total, categoria, fecha_compra, retencion_importe
 */
export async function generarAsientoGasto(empresaId, gasto, creadoPor, cuentaGastoIA = null) {
  const base = parseFloat(gasto.base_imponible || gasto.total || 0);
  const iva = parseFloat(gasto.iva_importe || 0);
  const retencion = parseFloat(gasto.retencion_importe || 0);
  const total = parseFloat(gasto.total || base + iva - retencion);
  const proveedorNombre = gasto.proveedor || "Proveedor";

  // Cuenta de gasto: IA pre-clasificada > regex > IA individual > categoría
  const cuentaGasto = cuentaGastoIA
    || detectarCuentaPorDescripcion(gasto.descripcion, gasto.proveedor)
    || await clasificarCuentaConIA(gasto.descripcion, gasto.proveedor, gasto.categoria)
    || mapCategoriaToCuenta(gasto.categoria);

  // Detectar si la cuenta asignada es ambigua y requiere revisión
  const cuentasAmbiguas = ["623", "629", "607", "649"];
  const esAmbigua = cuentasAmbiguas.includes(cuentaGasto.codigo) && !cuentaGastoIA;
  let revisionMotivo = null;
  if (esAmbigua) {
    if (["623", "629"].includes(cuentaGasto.codigo)) {
      revisionMotivo = `Cuenta ${cuentaGasto.codigo} asignada automáticamente. Verificar si el proveedor "${proveedorNombre}" es autónomo (623) o sociedad S.L./S.A. (629).`;
    } else {
      revisionMotivo = `Cuenta ${cuentaGasto.codigo} asignada automáticamente. Verificar que la clasificación es correcta.`;
    }
  }

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
    revisado_ia: !!cuentaGastoIA,
    pendiente_revision: esAmbigua,
    revision_motivo: revisionMotivo,
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

// =============================================
// Asientos de Cobro y Pago (FASE A)
// =============================================

/**
 * Mapea un método de pago a la cuenta contable correspondiente.
 * - transferencia / domiciliacion / tarjeta / bizum → 572 (Bancos)
 * - efectivo → 570 (Caja)
 */
function cuentaTesoreriaPorMetodo(metodo) {
  const m = (metodo || "").toLowerCase().trim();
  if (["efectivo"].includes(m)) {
    return { codigo: "570", nombre: "Caja, euros" };
  }
  // transferencia, tarjeta, domiciliacion, bizum, otro → banco
  return { codigo: "572", nombre: "Bancos e instituciones de crédito c/c vista, euros" };
}

/**
 * Generar asiento automático de COBRO de una factura emitida.
 * Se genera al asignar un pago a una factura en el módulo de cobros-pagos.
 *
 * Asiento:
 *   Debe: 572 (Banco) o 570 (Caja) → según método de pago
 *   Haber: 430xxx (subcuenta del cliente)
 *
 * @param {string} empresaId
 * @param {Object} params
 * @param {string} params.paymentId - ID del pago
 * @param {string} params.metodo - Método de pago (transferencia, efectivo, tarjeta, bizum, otro)
 * @param {number} params.importe - Importe cobrado
 * @param {string} params.fecha - Fecha del cobro (YYYY-MM-DD)
 * @param {number|string|null} params.facturaId - ID de la factura cobrada (puede ser int o uuid)
 * @param {string|null} params.facturaNumero - Número de factura
 * @param {string|null} params.clienteId - ID del cliente
 * @param {string|null} params.clienteNombre - Nombre del cliente
 * @param {string|null} params.creadoPor - ID del usuario
 */
export async function generarAsientoCobro(empresaId, {
  paymentId,
  metodo,
  importe,
  fecha,
  facturaId = null,
  facturaNumero = null,
  clienteId = null,
  clienteNombre = null,
  creadoPor = null,
}) {
  const importeNum = parseFloat(importe);
  if (!importeNum || importeNum <= 0) return null;

  // Evitar duplicados: verificar que no exista asiento con misma referencia
  const refId = `cobro_${paymentId}_${facturaId || "gen"}`;
  const existing = await sql`
    SELECT id FROM asientos_180
    WHERE empresa_id = ${empresaId}
      AND referencia_tipo = 'cobro'
      AND referencia_id = ${refId}
      AND estado != 'anulado'
    LIMIT 1
  `;
  if (existing.length > 0) return null; // Ya existe

  // Cuenta de tesorería según método
  const cuentaTesoro = cuentaTesoreriaPorMetodo(metodo);

  // Subcuenta del cliente (430xxx)
  const cuentaCliente = await getOrCreateCuentaTercero(
    empresaId, "cliente", clienteId, clienteNombre || "Cliente"
  );

  const concepto = facturaNumero
    ? `Cobro fact. ${facturaNumero} - ${clienteNombre || "Cliente"}`
    : `Cobro - ${clienteNombre || "Cliente"}`;

  const lineas = [
    {
      cuenta_codigo: cuentaTesoro.codigo,
      cuenta_nombre: cuentaTesoro.nombre,
      debe: importeNum,
      haber: 0,
      concepto,
    },
    {
      cuenta_codigo: cuentaCliente.codigo,
      cuenta_nombre: cuentaCliente.nombre,
      debe: 0,
      haber: importeNum,
      concepto,
    },
  ];

  return crearAsiento({
    empresaId,
    fecha: fecha || new Date().toISOString().split("T")[0],
    concepto,
    tipo: "auto_cobro",
    referencia_tipo: "cobro",
    referencia_id: refId,
    creado_por: creadoPor,
    lineas,
  });
}

/**
 * Generar asiento automático de PAGO de un gasto/factura recibida.
 * Se genera automáticamente al crear un gasto que tiene método de pago.
 *
 * Asiento:
 *   Debe: 400xxx (subcuenta del proveedor) → cancela la deuda
 *   Haber: 572 (Banco) o 570 (Caja) → según método de pago
 *
 * @param {string} empresaId
 * @param {Object} gasto - El gasto (purchase) ya creado
 * @param {string|null} creadoPor - ID del usuario
 */
export async function generarAsientoPagoGasto(empresaId, gasto, creadoPor = null) {
  const total = parseFloat(gasto.total || 0);
  if (!total || total <= 0) return null;
  if (!gasto.metodo_pago) return null;

  // Evitar duplicados
  const refId = `pago_gasto_${gasto.id}`;
  const existing = await sql`
    SELECT id FROM asientos_180
    WHERE empresa_id = ${empresaId}
      AND referencia_tipo = 'pago_gasto'
      AND referencia_id = ${refId}
      AND estado != 'anulado'
    LIMIT 1
  `;
  if (existing.length > 0) return null;

  const proveedorNombre = gasto.proveedor || "Proveedor";

  // Subcuenta del proveedor (400xxx) - reutilizar la misma que el asiento de devengo
  const cuentaProveedor = await getOrCreateCuentaTercero(
    empresaId, "proveedor", gasto.id, proveedorNombre
  );

  // Cuenta de tesorería según método de pago
  const cuentaTesoro = cuentaTesoreriaPorMetodo(gasto.metodo_pago);

  const concepto = `Pago - ${proveedorNombre} - ${gasto.descripcion || ""}`.trim();

  const lineas = [
    {
      cuenta_codigo: cuentaProveedor.codigo,
      cuenta_nombre: cuentaProveedor.nombre,
      debe: total,
      haber: 0,
      concepto,
    },
    {
      cuenta_codigo: cuentaTesoro.codigo,
      cuenta_nombre: cuentaTesoro.nombre,
      debe: 0,
      haber: total,
      concepto,
    },
  ];

  return crearAsiento({
    empresaId,
    fecha: gasto.fecha_compra || gasto.fecha || new Date().toISOString().split("T")[0],
    concepto,
    tipo: "auto_pago",
    referencia_tipo: "pago_gasto",
    referencia_id: refId,
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
  const resultados = {
    facturas: 0, gastos: 0, nominas: 0, cobros: 0, pagos: 0, errores: [],
    ya_existentes: { facturas: 0, gastos: 0, nominas: 0, cobros: 0, pagos: 0 },
    ia_clasificaciones: 0,
  };

  // Ensure PGC is initialized
  await inicializarPGC(empresaId);

  // ============== PASO 1: RECOPILAR TODOS LOS DATOS DEL PERIODO ==============

  // --- Facturas ---
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

  // --- Gastos ---
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

  // --- Nóminas ---
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

  // ============== PASO 2: CLASIFICACIÓN IA POR LOTES (EL CATEDRÁTICO) ==============
  // CONTENDO clasifica TODAS las operaciones en una sola llamada antes de generar asientos.
  // Esto garantiza que cada asiento nace con la cuenta correcta.

  const itemsParaIA = [];

  // Obtener descripciones de líneas de factura para mejor clasificación IA
  const facturaIds = facturas.map(f => f.id);
  let lineaDescMap = new Map();
  if (facturaIds.length > 0) {
    const lineasFactura = await sql`
      SELECT factura_id, descripcion FROM lineafactura_180
      WHERE factura_id = ANY(${facturaIds})
      ORDER BY factura_id, id
    `;
    for (const l of lineasFactura) {
      const prev = lineaDescMap.get(l.factura_id) || [];
      if (l.descripcion) prev.push(l.descripcion);
      lineaDescMap.set(l.factura_id, prev);
    }
  }

  for (const f of facturas) {
    // factura_180 no tiene concepto/descripcion - usar líneas + numero + cliente
    const lineaDescs = lineaDescMap.get(f.id) || [];
    const desc = [f.numero, ...lineaDescs.slice(0, 3), f.cliente_nombre]
      .filter(Boolean).join(" - ") || "Factura emitida";
    itemsParaIA.push({
      id: String(f.id),
      tipo: "factura",
      descripcion: desc,
      cliente: f.cliente_nombre || "Cliente",
    });
  }

  for (const g of gastos) {
    itemsParaIA.push({
      id: String(g.id),
      tipo: "gasto",
      descripcion: g.descripcion || "",
      proveedor: g.proveedor || "",
      categoria: g.categoria || "",
    });
  }

  // Clasificar todo con IA en lote
  let clasificacionesIA = new Map();
  if (itemsParaIA.length > 0) {
    try {
      clasificacionesIA = await clasificarLoteConIA(itemsParaIA);
      resultados.ia_clasificaciones = clasificacionesIA.size;
    } catch (err) {
      console.error("Error clasificación IA por lotes:", err.message);
      resultados.errores.push(`IA clasificación: ${err.message} (se usarán fallbacks)`);
    }
  }

  // ============== PASO 3: GENERAR ASIENTOS CON CUENTAS IA ==============

  // --- Facturas con cuenta de ingreso clasificada por IA ---
  for (const f of facturas) {
    try {
      const cuentaIA = clasificacionesIA.get(String(f.id)) || null;
      await generarAsientoFactura(empresaId, f, creadoPor, cuentaIA);
      resultados.facturas++;
    } catch (err) {
      resultados.errores.push(`Factura ${f.numero || f.id}: ${err.message}`);
    }
  }

  // --- Gastos con cuenta clasificada por IA ---
  for (const g of gastos) {
    try {
      const cuentaIA = clasificacionesIA.get(String(g.id)) || null;
      await generarAsientoGasto(empresaId, g, creadoPor, cuentaIA);
      resultados.gastos++;
    } catch (err) {
      resultados.errores.push(`Gasto ${g.descripcion || g.id}: ${err.message}`);
    }
  }

  // --- Nóminas (cuentas estándar 640/642/476/4751/465 - no necesitan IA) ---
  for (const n of nominas) {
    try {
      await generarAsientoNomina(empresaId, n, creadoPor);
      resultados.nominas++;
    } catch (err) {
      resultados.errores.push(`Nómina ${n.empleado_nombre || n.id}: ${err.message}`);
    }
  }

  // ============== PASO 4: COBROS Y PAGOS DEL PERIODO ==============

  // --- Cobros: Pagos asignados a facturas en el periodo ---
  const [cobroStats] = await sql`
    SELECT
      COUNT(DISTINCT CONCAT(pa.payment_id, '_', pa.factura_id))::int AS total,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM asientos_180 a
        WHERE a.empresa_id = pa.empresa_id AND a.referencia_tipo = 'cobro'
          AND a.referencia_id = CONCAT('cobro_', pa.payment_id, '_', pa.factura_id)
          AND a.estado != 'anulado'
      ) THEN CONCAT(pa.payment_id, '_', pa.factura_id) END)::int AS con_asiento
    FROM payment_allocations_180 pa
    JOIN payments_180 p ON p.id = pa.payment_id
    WHERE pa.empresa_id = ${empresaId}
      AND pa.factura_id IS NOT NULL
      AND p.fecha_pago >= ${fechaDesde} AND p.fecha_pago <= ${fechaHasta}
  `;
  resultados.ya_existentes.cobros = cobroStats.con_asiento;

  const cobros = await sql`
    SELECT pa.payment_id, pa.factura_id, pa.importe,
           p.metodo, p.fecha_pago,
           f.numero AS factura_numero, f.cliente_id,
           c.nombre AS cliente_nombre
    FROM payment_allocations_180 pa
    JOIN payments_180 p ON p.id = pa.payment_id
    JOIN factura_180 f ON f.id = pa.factura_id
    LEFT JOIN clients_180 c ON c.id = f.cliente_id
    WHERE pa.empresa_id = ${empresaId}
      AND pa.factura_id IS NOT NULL
      AND p.fecha_pago >= ${fechaDesde} AND p.fecha_pago <= ${fechaHasta}
      AND NOT EXISTS (
        SELECT 1 FROM asientos_180 a
        WHERE a.empresa_id = ${empresaId}
          AND a.referencia_tipo = 'cobro'
          AND a.referencia_id = CONCAT('cobro_', pa.payment_id, '_', pa.factura_id)
          AND a.estado != 'anulado'
      )
    ORDER BY p.fecha_pago
  `;

  for (const co of cobros) {
    try {
      await generarAsientoCobro(empresaId, {
        paymentId: co.payment_id,
        metodo: co.metodo,
        importe: co.importe,
        fecha: co.fecha_pago,
        facturaId: co.factura_id,
        facturaNumero: co.factura_numero,
        clienteId: co.cliente_id,
        clienteNombre: co.cliente_nombre,
        creadoPor,
      });
      resultados.cobros++;
    } catch (err) {
      resultados.errores.push(`Cobro fact. ${co.factura_numero || co.factura_id}: ${err.message}`);
    }
  }

  // --- Pagos: Gastos con método de pago que no tienen asiento de pago ---
  const [pagoStats] = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(CASE WHEN EXISTS (
        SELECT 1 FROM asientos_180 a
        WHERE a.empresa_id = g.empresa_id AND a.referencia_tipo = 'pago_gasto'
          AND a.referencia_id = CONCAT('pago_gasto_', g.id) AND a.estado != 'anulado'
      ) THEN 1 END)::int AS con_asiento
    FROM purchases_180 g
    WHERE g.empresa_id = ${empresaId} AND g.activo = true
      AND g.metodo_pago IS NOT NULL AND g.metodo_pago != ''
      AND g.fecha_compra >= ${fechaDesde} AND g.fecha_compra <= ${fechaHasta}
  `;
  resultados.ya_existentes.pagos = pagoStats.con_asiento;

  const gastosConPago = await sql`
    SELECT g.*
    FROM purchases_180 g
    WHERE g.empresa_id = ${empresaId}
      AND g.activo = true
      AND g.metodo_pago IS NOT NULL AND g.metodo_pago != ''
      AND g.fecha_compra >= ${fechaDesde} AND g.fecha_compra <= ${fechaHasta}
      AND NOT EXISTS (
        SELECT 1 FROM asientos_180 a
        WHERE a.empresa_id = ${empresaId}
          AND a.referencia_tipo = 'pago_gasto'
          AND a.referencia_id = CONCAT('pago_gasto_', g.id)
          AND a.estado != 'anulado'
      )
    ORDER BY g.fecha_compra
  `;

  for (const gp of gastosConPago) {
    try {
      await generarAsientoPagoGasto(empresaId, gp, creadoPor);
      resultados.pagos++;
    } catch (err) {
      resultados.errores.push(`Pago gasto ${gp.descripcion || gp.id}: ${err.message}`);
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

  const nombreNorm = (nombre || "").trim().toUpperCase();

  // 1. Search by tercero_ref (most reliable — original name when account was created)
  if (nombreNorm) {
    const byRef = await sql`
      SELECT codigo, nombre FROM pgc_cuentas_180
      WHERE empresa_id = ${empresaId}
        AND codigo LIKE ${prefijo + '%'}
        AND padre_codigo = ${cuentaPadre}
        AND UPPER(tercero_ref) = ${nombreNorm}
        AND activa = true
      LIMIT 1
    `;
    if (byRef.length > 0) {
      return { codigo: byRef[0].codigo, nombre: byRef[0].nombre };
    }

    // 2. Search in aliases (accumulated from merges)
    const byAlias = await sql`
      SELECT codigo, nombre FROM pgc_cuentas_180
      WHERE empresa_id = ${empresaId}
        AND codigo LIKE ${prefijo + '%'}
        AND padre_codigo = ${cuentaPadre}
        AND tercero_aliases @> ${JSON.stringify([nombreNorm])}::jsonb
        AND activa = true
      LIMIT 1
    `;
    if (byAlias.length > 0) {
      return { codigo: byAlias[0].codigo, nombre: byAlias[0].nombre };
    }
  }

  // 3. Fallback: search by name (legacy behavior)
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

  // 4. Create new account with tercero_ref
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

  // Create the subcuenta with tercero_ref for future lookups
  await sql`
    INSERT INTO pgc_cuentas_180 (empresa_id, codigo, nombre, tipo, grupo, subgrupo, nivel, padre_codigo, activa, es_estandar, tercero_ref, tercero_aliases)
    VALUES (${empresaId}, ${nuevoCodigo}, ${nuevaCuentaNombre}, ${tipoContable}, 4, ${tipo === "cliente" ? 43 : 40}, 4, ${cuentaPadre}, true, false, ${nombreNorm || null}, '[]'::jsonb)
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

    // --- SERVICIOS PROFESIONALES: Sociedades (629) vs Autónomos (623) ---
    // Si el proveedor es una sociedad (S.L., S.A., etc.) → 629 (Otros servicios)
    {
      patron: /GESTORIA|ASESORIA|ASESOR\s*(FISCAL|CONTABLE|LABORAL)|CONSULTORIA|ABOGADO|LETRADO|NOTARI|REGISTRO\s*(MERCANTIL|PROPIEDAD)|PROCURADOR|AUDITORIA|AUDITOR/,
      condicionProveedor: /\b(S\.?L\.?U?\.?|S\.?A\.?|S\.?C\.?|S\.?COOP\.?)\b/i,
      cuenta: { codigo: "629", nombre: "Otros servicios" },
    },
    // Si el proveedor NO es sociedad (persona física / autónomo) → 623
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

  const proveedorUpper = (proveedor || "").toUpperCase();

  for (const regla of reglas) {
    if (regla.patron.test(texto)) {
      // Si la regla tiene condición sobre proveedor, verificar que el proveedor la cumpla
      if (regla.condicionProveedor) {
        if (proveedorUpper && regla.condicionProveedor.test(proveedorUpper)) {
          return regla.cuenta;
        }
        continue; // No cumple la condición, probar siguiente regla
      }
      return regla.cuenta;
    }
  }

  return null; // No se pudo determinar → se usará el fallback por categoría
}

// Cache de clasificaciones IA para evitar llamadas repetidas en la misma sesión
const iaClasificacionCache = new Map();

/**
 * Clasifica un gasto individual en su cuenta PGC correcta usando Claude Haiku.
 * Se usa como fallback cuando detectarCuentaPorDescripcion() devuelve null.
 */
export async function clasificarCuentaConIA(descripcion, proveedor, categoria) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.length < 10) {
    return null;
  }

  const textoGasto = `${descripcion || ""} | ${proveedor || ""} | ${categoria || ""}`.trim();
  if (!textoGasto || textoGasto === "| |") return null;

  const cacheKey = textoGasto.toUpperCase();
  if (iaClasificacionCache.has(cacheKey)) {
    return iaClasificacionCache.get(cacheKey);
  }

  const cuentasGasto = getPgcPymesCuentas()
    .filter(c => c.grupo === 6 && c.nivel === 3)
    .map(c => `${c.codigo} - ${c.nombre}`)
    .join("\n");

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      system: `Eres un catedrático contable español especializado en PGC PYMES (RD 1514/2007).
Tu ÚNICA tarea: clasificar gastos en la cuenta PGC correcta.

CUENTAS (Grupo 6 - Compras y gastos):
${cuentasGasto}

REGLAS: Autónomos/RETA/SS→642, Mutuas→649, Sueldos→640, Alquiler→621, Suministros(luz,agua,gas,tel)→628, Seguros→625, Gestoría/abogado de AUTÓNOMO→623, Gestoría/abogado de SOCIEDAD (S.L.,S.A.)→629, Publicidad→627, Comisiones bancarias→626, Transporte→624, IBI/IAE/tasas→631, Reparaciones→622, Material oficina→629, Compras mercaderías→600, Subcontratación→607, Intereses→662.

Responde SOLO: CODIGO|NOMBRE`,
      messages: [{
        role: "user",
        content: `Clasifica: "${textoGasto}"`,
      }],
    });

    const texto = response.content[0]?.text?.trim();
    if (!texto) return null;

    const partes = texto.split("|").map(p => p.trim());
    if (partes.length >= 2 && /^\d{3,4}$/.test(partes[0])) {
      const result = { codigo: partes[0], nombre: partes[1] };
      iaClasificacionCache.set(cacheKey, result);
      if (iaClasificacionCache.size > 500) {
        const firstKey = iaClasificacionCache.keys().next().value;
        iaClasificacionCache.delete(firstKey);
      }
      return result;
    }
    return null;
  } catch (err) {
    console.error("Error clasificarCuentaConIA:", err.message);
    return null;
  }
}

/**
 * CLASIFICACIÓN POR LOTES CON IA - "El Catedrático Contable CONTENDO"
 *
 * Clasifica TODOS los gastos y facturas de un periodo en UNA SOLA llamada a Claude.
 * Esto es lo que convierte a CONTENDO en un catedrático contable: cada asiento se emite
 * con la cuenta correcta desde el primer momento, sin necesidad de correcciones.
 *
 * @param {Array} items - [{id, tipo: 'gasto'|'factura', descripcion, proveedor?, cliente?, categoria?}]
 * @returns {Promise<Map<string, {codigo: string, nombre: string}>>} Map de id → cuenta PGC
 */
export async function clasificarLoteConIA(items) {
  const resultMap = new Map();

  if (!items || items.length === 0) return resultMap;
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.length < 10) {
    return resultMap;
  }

  // Separar por tipo para dar contexto adecuado
  const gastos = items.filter(i => i.tipo === "gasto");
  const facturas = items.filter(i => i.tipo === "factura");

  // Revisar cache primero para evitar clasificaciones innecesarias
  const pendientes = [];
  for (const item of items) {
    const cacheKey = `${item.tipo}:${item.descripcion || ""}|${item.proveedor || item.cliente || ""}|${item.categoria || ""}`.toUpperCase();
    if (iaClasificacionCache.has(cacheKey)) {
      resultMap.set(item.id, iaClasificacionCache.get(cacheKey));
    } else {
      pendientes.push(item);
    }
  }

  if (pendientes.length === 0) return resultMap;

  // Construir catálogo de cuentas para el prompt
  const pgc = getPgcPymesCuentas().filter(c => c.nivel === 3);
  const cuentasGasto = pgc.filter(c => c.grupo === 6).map(c => `${c.codigo} - ${c.nombre}`).join("\n");
  const cuentasIngreso = pgc.filter(c => c.grupo === 7 && c.subgrupo === 70).map(c => `${c.codigo} - ${c.nombre}`).join("\n");

  // Construir la lista numerada de items a clasificar
  const listaItems = pendientes.map((item, idx) => {
    if (item.tipo === "gasto") {
      return `${idx + 1}. [GASTO] ${item.descripcion || "sin descripción"} | Proveedor: ${item.proveedor || "desconocido"} | Cat: ${item.categoria || "ninguna"}`;
    } else {
      return `${idx + 1}. [FACTURA] ${item.descripcion || "sin descripción"} | Cliente: ${item.cliente || "desconocido"}`;
    }
  }).join("\n");

  // Procesar en lotes de 50 para no sobrecargar el contexto
  const BATCH_SIZE = 50;
  for (let batchStart = 0; batchStart < pendientes.length; batchStart += BATCH_SIZE) {
    const batch = pendientes.slice(batchStart, batchStart + BATCH_SIZE);
    const listaBatch = batch.map((item, idx) => {
      const num = idx + 1;
      if (item.tipo === "gasto") {
        return `${num}. [GASTO] ${item.descripcion || "sin descripción"} | Proveedor: ${item.proveedor || "desconocido"} | Cat: ${item.categoria || "ninguna"}`;
      } else {
        return `${num}. [FACTURA] ${item.descripcion || "sin descripción"} | Cliente: ${item.cliente || "desconocido"}`;
      }
    }).join("\n");

    try {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: batch.length * 30 + 100,
        system: `Eres un CATEDRÁTICO de contabilidad española. Clasificas operaciones en cuentas PGC PYMES (RD 1514/2007) con PRECISIÓN ABSOLUTA.

CUENTAS DE GASTO (Grupo 6) - Para items marcados [GASTO]:
${cuentasGasto}

CUENTAS DE INGRESO (Grupo 7) - Para items marcados [FACTURA]:
${cuentasIngreso}

REGLAS GASTOS: Autónomos/RETA/SS→642, Mutuas/prevención→649, Sueldos→640, Indemnización→641, Alquiler→621, Reparaciones→622, Gestoría/abogado/notario de AUTÓNOMO (persona física)→623, Gestoría/abogado/notario de SOCIEDAD (S.L., S.A.)→629, Transporte/envíos→624, Seguros→625, Comisiones bancarias→626, Publicidad/marketing→627, Suministros(luz,agua,gas,tel,internet)→628, Material oficina/limpieza/otros→629, Compras mercaderías→600, Materias primas→601, Subcontratación→607, IBI/IAE/tasas→631, Intereses préstamos→662, Amortización→681.

REGLAS FACTURAS (CLAVE):
- 700: Venta de PRODUCTOS FÍSICOS, mercaderías, bienes tangibles
- 701: Venta de productos fabricados por la empresa
- 705: Prestación de SERVICIOS (consultoría, desarrollo, diseño, asesoría, formación, alquiler, reparación, etc.)
- Si no queda claro si es producto o servicio → 705 (la mayoría de PYMES son servicios)

FORMATO DE RESPUESTA: Una línea por item, mismo número que la lista.
N. CODIGO|NOMBRE
Ejemplo:
1. 628|Suministros
2. 705|Prestaciones de servicios
3. 621|Arrendamientos y cánones`,
        messages: [{
          role: "user",
          content: `Clasifica estas ${batch.length} operaciones:\n${listaBatch}`,
        }],
      });

      const texto = response.content[0]?.text?.trim();
      if (!texto) continue;

      // Parsear respuestas línea por línea
      const lineas = texto.split("\n").map(l => l.trim()).filter(l => l);

      for (const linea of lineas) {
        // Formato: "N. CODIGO|NOMBRE" o "N CODIGO|NOMBRE" o "CODIGO|NOMBRE"
        const match = linea.match(/^(\d+)[\.\)\-\s]+(\d{3,4})\|(.+)$/);
        if (match) {
          const idx = parseInt(match[1]) - 1;
          if (idx >= 0 && idx < batch.length) {
            const result = { codigo: match[2].trim(), nombre: match[3].trim() };
            const item = batch[idx];
            resultMap.set(item.id, result);

            // Cache
            const cacheKey = `${item.tipo}:${item.descripcion || ""}|${item.proveedor || item.cliente || ""}|${item.categoria || ""}`.toUpperCase();
            iaClasificacionCache.set(cacheKey, result);
          }
        }
      }
    } catch (err) {
      console.error("Error clasificarLoteConIA batch:", err.message);
    }
  }

  // Limitar cache
  while (iaClasificacionCache.size > 500) {
    const firstKey = iaClasificacionCache.keys().next().value;
    iaClasificacionCache.delete(firstKey);
  }

  return resultMap;
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
  const resultado = { revisados: 0, corregidos: 0, sin_cambios: 0, omitidos_ia: 0, errores: [], cambios: [] };

  // Obtener asientos auto (gastos + facturas)
  // Si se pasan IDs específicos, se revisan todos. Si no, solo los NO revisados por IA.
  let asientos;
  if (asientoIds.length > 0) {
    asientos = await sql`
      SELECT a.id, a.concepto, a.referencia_id, a.tipo, a.estado, a.revisado_ia
      FROM asientos_180 a
      WHERE a.empresa_id = ${empresaId}
        AND a.id = ANY(${asientoIds})
        AND a.estado != 'anulado'
    `;
  } else {
    asientos = await sql`
      SELECT a.id, a.concepto, a.referencia_id, a.tipo, a.estado, a.revisado_ia
      FROM asientos_180 a
      WHERE a.empresa_id = ${empresaId}
        AND a.tipo IN ('auto_gasto', 'auto_factura')
        AND a.estado != 'anulado'
        AND a.revisado_ia = false
      ORDER BY a.fecha
    `;
  }

  // Recopilar todos los items para clasificación por lotes
  const itemsParaIA = [];
  const asientoDataMap = new Map();

  for (const asiento of asientos) {
    if (asiento.tipo === "auto_gasto" && asiento.referencia_id) {
      const [g] = await sql`
        SELECT id, descripcion, proveedor, categoria
        FROM purchases_180
        WHERE id = ${asiento.referencia_id}::uuid AND empresa_id = ${empresaId}
      `;
      if (g) {
        asientoDataMap.set(asiento.id, { tipo: "gasto", data: g });
        itemsParaIA.push({
          id: asiento.id,
          tipo: "gasto",
          descripcion: g.descripcion || "",
          proveedor: g.proveedor || "",
          categoria: g.categoria || "",
        });
      }
    } else if (asiento.tipo === "auto_factura" && asiento.referencia_id) {
      const [f] = await sql`
        SELECT f.id, f.numero, f.serie, c.nombre AS cliente_nombre
        FROM factura_180 f
        LEFT JOIN clients_180 c ON c.id = f.cliente_id
        WHERE f.id = ${asiento.referencia_id}::int AND f.empresa_id = ${empresaId}
      `;
      if (f) {
        // Obtener descripciones de líneas para mejor clasificación
        const lineasF = await sql`
          SELECT descripcion FROM lineafactura_180
          WHERE factura_id = ${f.id} LIMIT 3
        `;
        const lineaDescs = lineasF.map(l => l.descripcion).filter(Boolean);
        asientoDataMap.set(asiento.id, { tipo: "factura", data: f });
        itemsParaIA.push({
          id: asiento.id,
          tipo: "factura",
          descripcion: [f.numero, ...lineaDescs, f.cliente_nombre].filter(Boolean).join(" - ") || "Factura",
          cliente: f.cliente_nombre || "Cliente",
        });
      }
    }
  }

  // Clasificar todo con IA por lotes
  let clasificacionesIA = new Map();
  if (itemsParaIA.length > 0) {
    try {
      clasificacionesIA = await clasificarLoteConIA(itemsParaIA);
    } catch (err) {
      resultado.errores.push(`IA lote: ${err.message}`);
    }
  }

  for (const asiento of asientos) {
    resultado.revisados++;
    try {
      const info = asientoDataMap.get(asiento.id);
      const cuentaIA = clasificacionesIA.get(asiento.id) || null;

      let cuentaCorrecta = cuentaIA;

      // Si la IA no clasificó, usar fallbacks
      if (!cuentaCorrecta && info) {
        if (info.tipo === "gasto") {
          cuentaCorrecta = detectarCuentaPorDescripcion(info.data.descripcion, info.data.proveedor)
            || await clasificarCuentaConIA(info.data.descripcion, info.data.proveedor, info.data.categoria)
            || mapCategoriaToCuenta(info.data.categoria);
        } else {
          cuentaCorrecta = { codigo: "705", nombre: "Prestaciones de servicios" };
        }
      }

      if (!cuentaCorrecta) {
        resultado.sin_cambios++;
        continue;
      }

      const lineas = await sql`
        SELECT id, cuenta_codigo, cuenta_nombre, debe, haber
        FROM asiento_lineas_180
        WHERE asiento_id = ${asiento.id} AND empresa_id = ${empresaId}
        ORDER BY orden
      `;

      // Buscar la línea relevante: 6xx para gastos, 7xx para facturas
      let lineaTarget;
      if (info?.tipo === "gasto" || asiento.tipo === "auto_gasto") {
        lineaTarget = lineas.find(l => l.cuenta_codigo.startsWith("6") && Number(l.debe) > 0);
      } else {
        lineaTarget = lineas.find(l => l.cuenta_codigo.startsWith("7") && Number(l.haber) > 0);
      }

      if (!lineaTarget) {
        resultado.sin_cambios++;
        continue;
      }

      if (lineaTarget.cuenta_codigo === cuentaCorrecta.codigo) {
        resultado.sin_cambios++;
        continue;
      }

      resultado.cambios.push({
        asiento_id: asiento.id,
        concepto: asiento.concepto,
        estado: asiento.estado,
        linea_id: lineaTarget.id,
        cuenta_anterior: { codigo: lineaTarget.cuenta_codigo, nombre: lineaTarget.cuenta_nombre },
        cuenta_nueva: { codigo: cuentaCorrecta.codigo, nombre: cuentaCorrecta.nombre },
        importe: Number(lineaTarget.debe || lineaTarget.haber),
      });

      if (!soloSimular) {
        await sql`
          UPDATE asiento_lineas_180
          SET cuenta_codigo = ${cuentaCorrecta.codigo},
              cuenta_nombre = ${cuentaCorrecta.nombre}
          WHERE id = ${lineaTarget.id}
        `;
        // Mark asiento as IA-reviewed after correction
        await sql`
          UPDATE asientos_180 SET revisado_ia = true WHERE id = ${asiento.id}
        `;
        resultado.corregidos++;
      } else {
        resultado.corregidos++;
      }
    } catch (err) {
      resultado.errores.push(`Asiento ${asiento.id}: ${err.message}`);
    }
  }

  // Also mark sin_cambios asientos as reviewed (IA confirmed the account is correct)
  if (!soloSimular) {
    const sinCambioIds = asientos
      .filter(a => !resultado.cambios.some(c => c.asiento_id === a.id) && !resultado.errores.some(e => e.includes(a.id)))
      .map(a => a.id);
    if (sinCambioIds.length > 0) {
      await sql`UPDATE asientos_180 SET revisado_ia = true WHERE id = ANY(${sinCambioIds})`;
    }
  }

  resultado.sin_cambios = resultado.revisados - resultado.corregidos - resultado.errores.length;
  return resultado;
}
