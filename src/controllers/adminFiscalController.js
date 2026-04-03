
import { sql } from "../db.js";
import { aeatService } from "../services/aeatService.js";

/**
 * Helper para obtener rango de fechas de un trimestre
 */
function getTrimestreDates(year, quarter) {
    const y = parseInt(year);
    const q = parseInt(quarter);

    // T1: Ene-Mar, T2: Abr-Jun, T3: Jul-Sep, T4: Oct-Dic
    const startMonth = (q - 1) * 3; // 0, 3, 6, 9
    const endMonth = startMonth + 3; // 3, 6, 9, 12 (exclusivo para Date, que usa 0-indexed months)

    const startDate = new Date(y, startMonth, 1);
    const endDate = new Date(y, endMonth, 0); // Último día del mes anterior a endMonth (es decir, fin del trimestre)

    // Formato YYYY-MM-DD
    const isoStart = startDate.toISOString().split('T')[0];
    const isoEnd = endDate.toISOString().split('T')[0];

    return { startDate: isoStart, endDate: isoEnd };
}

/**
 * Lógica compartida para calcular datos de modelos
 */
export async function calcularDatosModelos(empresaId, year, trimestre) {
    const { startDate, endDate } = getTrimestreDates(year, trimestre);

    // 1. IVA DEVENGADO (VENTAS) - Desglosado por tipo de IVA
    const ventasPorTipo = await sql`
        SELECT
            COALESCE(lf.iva_percent, 21) as tipo_iva,
            COALESCE(SUM(lf.cantidad * lf.precio_unitario), 0) as base_imponible,
            COALESCE(SUM(lf.cantidad * lf.precio_unitario * lf.iva_percent / 100), 0) as cuota_iva
        FROM factura_180 f
        JOIN lineafactura_180 lf ON lf.factura_id = f.id
        WHERE f.empresa_id = ${empresaId}
        AND f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND f.fecha BETWEEN ${startDate} AND ${endDate}
        AND (f.es_test IS NOT TRUE)
        GROUP BY COALESCE(lf.iva_percent, 21)
        ORDER BY tipo_iva
    `;

    // Totales globales de ventas (compatibilidad)
    const ventas = {
        base_imponible: ventasPorTipo.reduce((s, r) => s + parseFloat(r.base_imponible), 0),
        iva_repercutido: ventasPorTipo.reduce((s, r) => s + parseFloat(r.cuota_iva), 0),
        count: ventasPorTipo.length
    };

    // 2. IVA DEDUCIBLE (GASTOS) - Desglosado por tipo de IVA
    // NOTA: Se usa COALESCE(cuota_iva, iva_importe, 0) porque los gastos nuevos
    // guardan el IVA en iva_importe pero no en cuota_iva
    const comprasPorTipo = await sql`
        SELECT
            COALESCE(iva_porcentaje, 21) as tipo_iva,
            COALESCE(SUM(base_imponible), 0) as base_imponible,
            COALESCE(SUM(COALESCE(cuota_iva, iva_importe, 0)), 0) as cuota_iva
        FROM purchases_180
        WHERE empresa_id = ${empresaId}
        AND activo = true
        AND fecha_compra BETWEEN ${startDate} AND ${endDate}
        GROUP BY COALESCE(iva_porcentaje, 21)
        ORDER BY tipo_iva
    `;

    // Totales globales de compras (compatibilidad)
    const compras = {
        base_imponible: comprasPorTipo.reduce((s, r) => s + parseFloat(r.base_imponible), 0),
        iva_soportado: comprasPorTipo.reduce((s, r) => s + parseFloat(r.cuota_iva), 0),
        count: comprasPorTipo.length
    };

    // 3. DATOS ACUMULADOS AÑO (Modelo 130)
    const startYear = `${year}-01-01`;
    const [acumuladoVentas] = await sql`
        SELECT COALESCE(SUM(subtotal), 0) as ingresos
        FROM factura_180
        WHERE empresa_id = ${empresaId}
        AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND fecha BETWEEN ${startYear} AND ${endDate}
        AND (es_test IS NOT TRUE)
    `;
    const [acumuladoCompras] = await sql`
        SELECT COALESCE(SUM(base_imponible), 0) as gastos
        FROM purchases_180
        WHERE empresa_id = ${empresaId}
        AND activo = true
        AND fecha_compra BETWEEN ${startYear} AND ${endDate}
    `;
    const [acumuladoNominas] = await sql`
        SELECT 
            COALESCE(SUM(bruto), 0) + COALESCE(SUM(seguridad_social_empresa), 0) as total_coste
        FROM nominas_180
        WHERE empresa_id = ${empresaId}
        AND anio = ${year}
        AND mes <= ${(parseInt(trimestre) * 3)}
    `;

    // 4. DATOS MODELO 111 (Retenciones IRPF)
    const [nominas111] = await sql`
        SELECT 
            COUNT(*) as perceptores,
            COALESCE(SUM(bruto), 0) as rendimientos,
            COALESCE(SUM(irpf_retencion), 0) as retenciones
        FROM nominas_180
        WHERE empresa_id = ${empresaId}
        AND anio = ${year}
        AND mes BETWEEN ${(parseInt(trimestre) - 1) * 3 + 1} AND ${parseInt(trimestre) * 3}
    `;
    const [actividades111] = await sql`
        SELECT 
            COUNT(DISTINCT proveedor) as perceptores,
            COALESCE(SUM(base_imponible), 0) as rendimientos,
            COALESCE(SUM(retencion_importe), 0) as retenciones
        FROM purchases_180
        WHERE empresa_id = ${empresaId}
        AND activo = true
        AND retencion_importe > 0
        AND fecha_compra BETWEEN ${startDate} AND ${endDate}
    `;

    // 5. DATOS MODELO 115 (Retenciones alquileres)
    const [alquileres115] = await sql`
        SELECT
            COALESCE(SUM(total), 0) as total_alquileres,
            COALESCE(SUM(retencion_importe), 0) as total_retenciones,
            COUNT(*) as num_gastos
        FROM purchases_180
        WHERE empresa_id = ${empresaId}
        AND activo = true
        AND (
            LOWER(categoria) LIKE '%alquiler%'
            OR LOWER(categoria) LIKE '%arrendamiento%'
            OR LOWER(categoria) LIKE '%local%'
            OR LOWER(categoria) LIKE '%oficina%'
            OR LOWER(tipo_gasto) = 'alquiler'
        )
        AND fecha_compra BETWEEN ${startDate} AND ${endDate}
    `;

    // 6. DATOS MODELO 349 (Operaciones intracomunitarias - solo países UE)
    const PAISES_UE = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','SE'];
    const operaciones349 = await sql`
        SELECT c.nombre as cliente, c.nif_cif, COALESCE(SUM(f.total), 0)::numeric(12,2) as total
        FROM factura_180 f
        LEFT JOIN clients_180 c ON f.cliente_id = c.id
        LEFT JOIN client_fiscal_data_180 cfd ON cfd.cliente_id = c.id
        WHERE f.empresa_id = ${empresaId} AND f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND f.fecha BETWEEN ${startDate} AND ${endDate}
        AND (f.es_test IS NOT TRUE)
        AND (
            UPPER(COALESCE(cfd.pais, c.pais, '')) IN ${sql(PAISES_UE)}
        )
        GROUP BY c.id, c.nombre, c.nif_cif
    `;
    const total349 = operaciones349.reduce((sum, op) => sum + parseFloat(op.total), 0);

    const [emisor] = await sql`SELECT nif, nombre FROM emisor_180 WHERE empresa_id = ${empresaId}`;

    // Helper para extraer base+cuota de un tipo de IVA concreto
    const getDevengadoPorTipo = (tipo) => {
        const row = ventasPorTipo.find(r => parseFloat(r.tipo_iva) === tipo);
        return { base: row ? parseFloat(row.base_imponible) : 0, cuota: row ? parseFloat(row.cuota_iva) : 0 };
    };
    const getDeduciblePorTipo = (tipo) => {
        const row = comprasPorTipo.find(r => parseFloat(r.tipo_iva) === tipo);
        return { base: row ? parseFloat(row.base_imponible) : 0, cuota: row ? parseFloat(row.cuota_iva) : 0 };
    };

    const modelo303 = {
        devengado: {
            base: parseFloat(ventas.base_imponible),
            cuota: parseFloat(ventas.iva_repercutido),
            por_tipo: {
                al_4:  getDevengadoPorTipo(4),
                al_10: getDevengadoPorTipo(10),
                al_21: getDevengadoPorTipo(21),
            }
        },
        deducible: {
            base: parseFloat(compras.base_imponible),
            cuota: parseFloat(compras.iva_soportado),
            por_tipo: {
                al_4:  getDeduciblePorTipo(4),
                al_10: getDeduciblePorTipo(10),
                al_21: getDeduciblePorTipo(21),
            }
        },
        resultado: parseFloat(ventas.iva_repercutido) - parseFloat(compras.iva_soportado)
    };

    const totalGastos = parseFloat(acumuladoCompras.gastos) + parseFloat(acumuladoNominas.total_coste);
    const rendimientoNeto = parseFloat(acumuladoVentas.ingresos) - totalGastos;
    const pagoFraccionado = rendimientoNeto > 0 ? rendimientoNeto * 0.20 : 0;

    // Cargar pagos fraccionados de trimestres anteriores del mismo año
    let pagosAnteriores = 0;
    const trimestreActual = parseInt(trimestre);
    if (trimestreActual > 1) {
        const previousQuarters = Array.from({ length: trimestreActual - 1 }, (_, i) => `${i + 1}T`);
        const [prev] = await sql`
            SELECT COALESCE(SUM(resultado_importe), 0) as total_pagado
            FROM fiscal_models_180
            WHERE empresa_id = ${empresaId}
            AND modelo = '130'
            AND ejercicio = ${parseInt(year)}
            AND periodo IN ${sql(previousQuarters)}
            AND estado IN ('GENERADO', 'PRESENTADO')
        `;
        pagosAnteriores = parseFloat(prev.total_pagado);
    }

    const modelo130 = {
        ingresos: parseFloat(acumuladoVentas.ingresos),
        gastos: totalGastos,
        gastos_detalle: {
            compras: parseFloat(acumuladoCompras.gastos),
            nominas: parseFloat(acumuladoNominas.total_coste)
        },
        rendimiento: rendimientoNeto,
        pago_fraccionado: pagoFraccionado,
        a_ingresar: pagoFraccionado - pagosAnteriores
    };

    const modelo111 = {
        trabajo: {
            perceptores: parseInt(nominas111.perceptores),
            rendimientos: parseFloat(nominas111.rendimientos),
            retenciones: parseFloat(nominas111.retenciones)
        },
        actividades: {
            perceptores: parseInt(actividades111.perceptores),
            rendimientos: parseFloat(actividades111.rendimientos),
            retenciones: parseFloat(actividades111.retenciones)
        },
        total_retenciones: parseFloat(nominas111.retenciones) + parseFloat(actividades111.retenciones)
    };

    const modelo115 = {
        total_alquileres: parseFloat(alquileres115.total_alquileres),
        total_retenciones: parseFloat(alquileres115.total_retenciones),
        num_gastos: parseInt(alquileres115.num_gastos),
        a_ingresar: parseFloat(alquileres115.total_retenciones)
    };

    const modelo349 = {
        total_intracomunitario: total349,
        operaciones: operaciones349,
        num_clientes: operaciones349.length
    };

    return {
        year, trimestre, startDate, endDate,
        nif: emisor?.nif || '',
        nombre: emisor?.nombre || '',
        modelo303, modelo130, modelo111, modelo115, modelo349
    };
}

/**
 * Modelo 390 — Resumen anual IVA
 * Agrega los 4 trimestres de datos 303
 */
export async function calcularModelo390(empresaId, year) {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    // IVA DEVENGADO (VENTAS) - Todo el año por tipo de IVA
    const ventasPorTipo = await sql`
        SELECT
            COALESCE(lf.iva_percent, 21) as tipo_iva,
            COALESCE(SUM(lf.cantidad * lf.precio_unitario), 0) as base_imponible,
            COALESCE(SUM(lf.cantidad * lf.precio_unitario * lf.iva_percent / 100), 0) as cuota_iva
        FROM factura_180 f
        JOIN lineafactura_180 lf ON lf.factura_id = f.id
        WHERE f.empresa_id = ${empresaId}
        AND f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND f.fecha BETWEEN ${startDate} AND ${endDate}
        AND (f.es_test IS NOT TRUE)
        GROUP BY COALESCE(lf.iva_percent, 21)
        ORDER BY tipo_iva
    `;

    // IVA DEDUCIBLE (GASTOS) - Todo el año por tipo
    const comprasPorTipo = await sql`
        SELECT
            COALESCE(iva_porcentaje, 21) as tipo_iva,
            COALESCE(SUM(base_imponible), 0) as base_imponible,
            COALESCE(SUM(COALESCE(cuota_iva, iva_importe, 0)), 0) as cuota_iva
        FROM purchases_180
        WHERE empresa_id = ${empresaId}
        AND activo = true
        AND fecha_compra BETWEEN ${startDate} AND ${endDate}
        GROUP BY COALESCE(iva_porcentaje, 21)
        ORDER BY tipo_iva
    `;

    // Operaciones exentas
    const [exentas] = await sql`
        SELECT COALESCE(SUM(lf.cantidad * lf.precio_unitario), 0) as total
        FROM factura_180 f
        JOIN lineafactura_180 lf ON lf.factura_id = f.id
        WHERE f.empresa_id = ${empresaId}
        AND f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND f.fecha BETWEEN ${startDate} AND ${endDate}
        AND (f.es_test IS NOT TRUE)
        AND COALESCE(lf.iva_percent, 21) = 0
    `;

    // Operaciones intracomunitarias
    const PAISES_UE = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','SE'];
    const [intracom] = await sql`
        SELECT COALESCE(SUM(f.total), 0) as total
        FROM factura_180 f
        LEFT JOIN clients_180 c ON f.cliente_id = c.id
        LEFT JOIN client_fiscal_data_180 cfd ON cfd.cliente_id = c.id
        WHERE f.empresa_id = ${empresaId}
        AND f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND f.fecha BETWEEN ${startDate} AND ${endDate}
        AND (f.es_test IS NOT TRUE)
        AND UPPER(COALESCE(cfd.pais, c.pais, '')) IN ${sql(PAISES_UE)}
    `;

    // Compensaciones de trimestres anteriores (303 con resultado negativo)
    const [compensaciones] = await sql`
        SELECT COALESCE(SUM(ABS(resultado_importe)), 0) as total
        FROM fiscal_models_180
        WHERE empresa_id = ${empresaId}
        AND modelo = '303'
        AND ejercicio = ${parseInt(year)}
        AND resultado_importe < 0
        AND estado IN ('GENERADO', 'PRESENTADO')
    `;

    const getByTipo = (arr, tipo) => {
        const row = arr.find(r => parseFloat(r.tipo_iva) === tipo);
        return { base: row ? parseFloat(row.base_imponible) : 0, cuota: row ? parseFloat(row.cuota_iva) : 0 };
    };

    const totalDevengadoBase = ventasPorTipo.reduce((s, r) => s + parseFloat(r.base_imponible), 0);
    const totalDevengadoCuota = ventasPorTipo.reduce((s, r) => s + parseFloat(r.cuota_iva), 0);
    const totalDeducibleBase = comprasPorTipo.reduce((s, r) => s + parseFloat(r.base_imponible), 0);
    const totalDeducibleCuota = comprasPorTipo.reduce((s, r) => s + parseFloat(r.cuota_iva), 0);
    const resultado = totalDevengadoCuota - totalDeducibleCuota;

    const [emisor] = await sql`SELECT nif, nombre FROM emisor_180 WHERE empresa_id = ${empresaId}`;

    // Volumen de operaciones = bases imponibles ventas + exentas + intracomunitarias
    const volumenOperaciones = totalDevengadoBase + parseFloat(exentas.total) + parseFloat(intracom.total);

    return {
        year,
        nif: emisor?.nif || '',
        nombre: emisor?.nombre || '',
        devengado: {
            base_total: totalDevengadoBase,
            cuota_total: totalDevengadoCuota,
            por_tipo: {
                al_4: getByTipo(ventasPorTipo, 4),
                al_10: getByTipo(ventasPorTipo, 10),
                al_21: getByTipo(ventasPorTipo, 21),
            }
        },
        deducible: {
            base_total: totalDeducibleBase,
            cuota_total: totalDeducibleCuota,
            por_tipo: {
                al_4: getByTipo(comprasPorTipo, 4),
                al_10: getByTipo(comprasPorTipo, 10),
                al_21: getByTipo(comprasPorTipo, 21),
            }
        },
        resultado,
        compensaciones: parseFloat(compensaciones.total),
        resultado_final: resultado - parseFloat(compensaciones.total),
        operaciones_exentas: parseFloat(exentas.total),
        operaciones_intracomunitarias: parseFloat(intracom.total),
        volumen_operaciones: volumenOperaciones
    };
}

/**
 * Modelo 190 — Resumen anual retenciones e ingresos a cuenta
 */
export async function calcularModelo190(empresaId, year) {
    // Perceptores de nóminas (clave A - trabajo)
    const trabajadores = await sql`
        SELECT
            COALESCE(u.nombre, 'Sin asignar') as nombre,
            COALESCE(e.nif, u.dni, '') as nif,
            SUM(n.bruto) as retribuciones_integras,
            SUM(n.irpf_retencion) as retenciones,
            SUM(COALESCE(n.seguridad_social_empleado, 0)) as ss_empleado,
            COUNT(*) as num_nominas
        FROM nominas_180 n
        LEFT JOIN employees_180 e ON e.id = n.empleado_id
        LEFT JOIN users_180 u ON u.id = e.user_id
        WHERE n.empresa_id = ${empresaId}
        AND n.anio = ${parseInt(year)}
        GROUP BY e.id, u.nombre, e.nif, u.dni
    `;

    // Perceptores de profesionales (clave G - actividades profesionales)
    const profesionales = await sql`
        SELECT
            COALESCE(p.proveedor, 'Sin nombre') as nombre,
            '' as nif,
            SUM(p.base_imponible) as retribuciones_integras,
            SUM(COALESCE(p.retencion_importe, 0)) as retenciones,
            COUNT(*) as num_facturas
        FROM purchases_180 p
        WHERE p.empresa_id = ${empresaId}
        AND p.activo = true
        AND p.retencion_importe > 0
        AND p.fecha_compra BETWEEN ${year + '-01-01'} AND ${year + '-12-31'}
        GROUP BY p.proveedor
    `;

    const totalTrabajadores = {
        perceptores: trabajadores.length,
        rendimientos: trabajadores.reduce((s, r) => s + parseFloat(r.retribuciones_integras), 0),
        retenciones: trabajadores.reduce((s, r) => s + parseFloat(r.retenciones), 0)
    };

    const totalProfesionales = {
        perceptores: profesionales.length,
        rendimientos: profesionales.reduce((s, r) => s + parseFloat(r.retribuciones_integras), 0),
        retenciones: profesionales.reduce((s, r) => s + parseFloat(r.retenciones), 0)
    };

    const [emisor] = await sql`SELECT nif, nombre FROM emisor_180 WHERE empresa_id = ${empresaId}`;

    return {
        year,
        nif: emisor?.nif || '',
        nombre: emisor?.nombre || '',
        trabajadores: trabajadores.map(t => ({
            nombre: t.nombre,
            nif: t.nif,
            clave: 'A',
            subclave: '01',
            retribuciones_integras: parseFloat(t.retribuciones_integras),
            retenciones: parseFloat(t.retenciones),
            ss_empleado: parseFloat(t.ss_empleado),
            num_nominas: parseInt(t.num_nominas)
        })),
        profesionales: profesionales.map(p => ({
            nombre: p.nombre,
            nif: p.nif,
            clave: 'G',
            subclave: '01',
            retribuciones_integras: parseFloat(p.retribuciones_integras),
            retenciones: parseFloat(p.retenciones),
            num_facturas: parseInt(p.num_facturas)
        })),
        totales_trabajo: totalTrabajadores,
        totales_profesionales: totalProfesionales,
        total_perceptores: totalTrabajadores.perceptores + totalProfesionales.perceptores,
        total_rendimientos: totalTrabajadores.rendimientos + totalProfesionales.rendimientos,
        total_retenciones: totalTrabajadores.retenciones + totalProfesionales.retenciones
    };
}

/**
 * Modelo 180 — Resumen anual retenciones arrendamiento
 */
export async function calcularModelo180(empresaId, year) {
    const arrendadores = await sql`
        SELECT
            COALESCE(p.proveedor, 'Sin nombre') as arrendador,
            SUM(p.base_imponible) as total_alquileres,
            SUM(COALESCE(p.retencion_importe, 0)) as total_retenciones,
            COUNT(*) as num_facturas
        FROM purchases_180 p
        WHERE p.empresa_id = ${empresaId}
        AND p.activo = true
        AND p.fecha_compra BETWEEN ${year + '-01-01'} AND ${year + '-12-31'}
        AND (LOWER(p.categoria) LIKE '%alquiler%' OR LOWER(p.categoria) LIKE '%arrendamiento%'
             OR LOWER(p.categoria) LIKE '%local%' OR LOWER(p.categoria) LIKE '%oficina%'
             OR LOWER(p.tipo_gasto) = 'alquiler')
        GROUP BY p.proveedor
    `;

    const [emisor] = await sql`SELECT nif, nombre FROM emisor_180 WHERE empresa_id = ${empresaId}`;

    const totalAlquileres = arrendadores.reduce((s, r) => s + parseFloat(r.total_alquileres), 0);
    const totalRetenciones = arrendadores.reduce((s, r) => s + parseFloat(r.total_retenciones), 0);

    return {
        year,
        nif: emisor?.nif || '',
        nombre: emisor?.nombre || '',
        arrendadores: arrendadores.map(a => ({
            arrendador: a.arrendador,
            total_alquileres: parseFloat(a.total_alquileres),
            total_retenciones: parseFloat(a.total_retenciones),
            num_facturas: parseInt(a.num_facturas)
        })),
        total_arrendadores: arrendadores.length,
        total_alquileres: totalAlquileres,
        total_retenciones: totalRetenciones
    };
}

/**
 * Modelo 347 — Declaración anual operaciones con terceros (>3.005,06 EUR)
 */
export async function calcularModelo347(empresaId, year) {
    // VENTAS - Clientes con operaciones > 3.005,06
    const clientes = await sql`
        SELECT
            c.nombre, COALESCE(c.nif, c.nif_cif, '') as nif,
            SUM(CASE WHEN EXTRACT(QUARTER FROM f.fecha) = 1 THEN f.total ELSE 0 END) as q1,
            SUM(CASE WHEN EXTRACT(QUARTER FROM f.fecha) = 2 THEN f.total ELSE 0 END) as q2,
            SUM(CASE WHEN EXTRACT(QUARTER FROM f.fecha) = 3 THEN f.total ELSE 0 END) as q3,
            SUM(CASE WHEN EXTRACT(QUARTER FROM f.fecha) = 4 THEN f.total ELSE 0 END) as q4,
            SUM(f.total) as total
        FROM factura_180 f
        JOIN clients_180 c ON c.id = f.cliente_id
        WHERE f.empresa_id = ${empresaId}
        AND (f.es_test IS NOT TRUE)
        AND f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND EXTRACT(YEAR FROM f.fecha) = ${parseInt(year)}
        GROUP BY c.id, c.nombre, c.nif, c.nif_cif
        HAVING SUM(f.total) > 3005.06
    `;

    // COMPRAS - Proveedores con operaciones > 3.005,06
    const proveedores = await sql`
        SELECT
            COALESCE(p.proveedor, 'Sin nombre') as nombre,
            '' as nif,
            SUM(CASE WHEN EXTRACT(QUARTER FROM p.fecha_compra) = 1 THEN p.total ELSE 0 END) as q1,
            SUM(CASE WHEN EXTRACT(QUARTER FROM p.fecha_compra) = 2 THEN p.total ELSE 0 END) as q2,
            SUM(CASE WHEN EXTRACT(QUARTER FROM p.fecha_compra) = 3 THEN p.total ELSE 0 END) as q3,
            SUM(CASE WHEN EXTRACT(QUARTER FROM p.fecha_compra) = 4 THEN p.total ELSE 0 END) as q4,
            SUM(p.total) as total
        FROM purchases_180 p
        WHERE p.empresa_id = ${empresaId}
        AND p.activo = true
        AND EXTRACT(YEAR FROM p.fecha_compra) = ${parseInt(year)}
        GROUP BY p.proveedor
        HAVING SUM(p.total) > 3005.06
    `;

    const [emisor] = await sql`SELECT nif, nombre FROM emisor_180 WHERE empresa_id = ${empresaId}`;

    const formatTercero = (r, tipo) => ({
        nombre: r.nombre,
        nif: r.nif,
        tipo,
        q1: parseFloat(r.q1),
        q2: parseFloat(r.q2),
        q3: parseFloat(r.q3),
        q4: parseFloat(r.q4),
        total: parseFloat(r.total)
    });

    const clientesList = clientes.map(c => formatTercero(c, 'cliente'));
    const proveedoresList = proveedores.map(p => formatTercero(p, 'proveedor'));
    const todos = [...clientesList, ...proveedoresList].sort((a, b) => b.total - a.total);

    return {
        year,
        nif: emisor?.nif || '',
        nombre: emisor?.nombre || '',
        clientes: clientesList,
        proveedores: proveedoresList,
        terceros: todos,
        total_clientes: clientesList.length,
        total_proveedores: proveedoresList.length,
        total_terceros: todos.length,
        importe_total_clientes: clientesList.reduce((s, c) => s + c.total, 0),
        importe_total_proveedores: proveedoresList.reduce((s, p) => s + p.total, 0),
        importe_total: todos.reduce((s, t) => s + t.total, 0)
    };
}

/**
 * Endpoints para modelos anuales
 */
export async function getModelo390(req, res) {
    try {
        const { year } = req.query;
        const empresaId = req.user.empresa_id;
        if (!year) return res.status(400).json({ error: "Ano requerido" });
        const data = await calcularModelo390(empresaId, year);
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error getModelo390:", error);
        res.status(500).json({ success: false, error: "Error obteniendo datos modelo 390" });
    }
}

export async function getModelo190(req, res) {
    try {
        const { year } = req.query;
        const empresaId = req.user.empresa_id;
        if (!year) return res.status(400).json({ error: "Ano requerido" });
        const data = await calcularModelo190(empresaId, year);
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error getModelo190:", error);
        res.status(500).json({ success: false, error: "Error obteniendo datos modelo 190" });
    }
}

export async function getModelo180(req, res) {
    try {
        const { year } = req.query;
        const empresaId = req.user.empresa_id;
        if (!year) return res.status(400).json({ error: "Ano requerido" });
        const data = await calcularModelo180(empresaId, year);
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error getModelo180:", error);
        res.status(500).json({ success: false, error: "Error obteniendo datos modelo 180" });
    }
}

export async function getModelo347(req, res) {
    try {
        const { year } = req.query;
        const empresaId = req.user.empresa_id;
        if (!year) return res.status(400).json({ error: "Ano requerido" });
        const data = await calcularModelo347(empresaId, year);
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error getModelo347:", error);
        res.status(500).json({ success: false, error: "Error obteniendo datos modelo 347" });
    }
}

/**
 * Descargar BOE para modelos anuales
 */
export async function downloadBOEAnual(req, res) {
    try {
        const { year, modelo } = req.query;
        const empresaId = req.user.empresa_id;

        if (!year || !modelo) {
            return res.status(400).json({ error: "Ano y modelo requeridos" });
        }

        let data;
        let boe = "";

        switch (modelo) {
            case '390':
                data = await calcularModelo390(empresaId, year);
                boe = aeatService.generarBOE390 ? aeatService.generarBOE390(data) : JSON.stringify(data, null, 2);
                break;
            case '190':
                data = await calcularModelo190(empresaId, year);
                boe = aeatService.generarBOE190 ? aeatService.generarBOE190(data) : JSON.stringify(data, null, 2);
                break;
            case '180':
                data = await calcularModelo180(empresaId, year);
                boe = aeatService.generarBOE180 ? aeatService.generarBOE180(data) : JSON.stringify(data, null, 2);
                break;
            case '347':
                data = await calcularModelo347(empresaId, year);
                boe = aeatService.generarBOE347 ? aeatService.generarBOE347(data) : JSON.stringify(data, null, 2);
                break;
            default:
                return res.status(400).json({ error: "Modelo anual no soportado" });
        }

        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename=Modelo_${modelo}_${year}_Anual.txt`);
        res.send(boe);

    } catch (error) {
        console.error("Error downloadBOEAnual:", error);
        res.status(500).json({ success: false, error: "Error generando fichero descarga anual" });
    }
}

/**
 * Obtener datos para paneles de control
 */
export async function getFiscalData(req, res) {
    try {
        const { year, trimestre } = req.query;
        const empresaId = req.user.empresa_id;

        if (!year || !trimestre) return res.status(400).json({ error: "Año y Trimestre requeridos" });

        const data = await calcularDatosModelos(empresaId, year, trimestre);
        res.json({ success: true, data });

    } catch (error) {
        console.error("Error getFiscalData:", error);
        res.status(500).json({ success: false, error: "Error obteniendo datos fiscales" });
    }
}

/**
 * Obtener Libro de Ventas (Facturas Emitidas)
 */
export async function getLibroVentas(req, res) {
    try {
        const year = req.query.year || new Date().getFullYear();
        const empresaId = req.user.empresa_id;

        const facturas = await sql`
            SELECT
                f.fecha, f.numero, f.cliente_id, f.total, f.subtotal as base, f.iva_total as cuota,
                f.retencion_importe as retencion,
                COALESCE(
                    (SELECT ROUND(AVG(lf.iva_percent), 0)
                     FROM lineafactura_180 lf
                     WHERE lf.factura_id = f.id AND lf.iva_percent > 0),
                    CASE WHEN f.subtotal > 0
                         THEN ROUND((f.iva_total / f.subtotal) * 100, 0)
                         ELSE 21 END
                )::integer as tipo,
                c.nombre as cliente_nombre
            FROM factura_180 f
            LEFT JOIN clients_180 c ON c.id = f.cliente_id
            WHERE f.empresa_id = ${empresaId}
            AND f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND EXTRACT(YEAR FROM f.fecha) = ${year}
            AND (f.es_test IS NOT TRUE)
            ORDER BY f.fecha ASC, f.numero ASC
        `;

        const facturasWithClientName = facturas;

        res.json({ success: true, data: facturasWithClientName });
    } catch (error) {
        console.error("Error getLibroVentas:", error);
        res.status(500).json({ success: false, error: "Error obteniendo libro ventas" });
    }
}

/**
 * Obtener Libro de Gastos (Facturas Recibidas)
 */
export async function getLibroGastos(req, res) {
    try {
        const year = req.query.year || new Date().getFullYear();
        const empresaId = req.user.empresa_id;

        const gastos = await sql`
            SELECT
                fecha_compra as fecha, proveedor, descripcion, total, base_imponible as base,
                COALESCE(cuota_iva, iva_importe, 0) as cuota,
                retencion_importe as retencion,
                iva_porcentaje as tipo
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND EXTRACT(YEAR FROM fecha_compra) = ${year}
            ORDER BY fecha_compra ASC
        `;

        res.json({ success: true, data: gastos });
    } catch (error) {
        console.error("Error getLibroGastos:", error);
        res.status(500).json({ success: false, error: "Error obteniendo libro gastos" });
    }
}

/**
 * Obtener Libro de Nóminas
 */
export async function getLibroNominas(req, res) {
    try {
        const { year } = req.query;
        const empresaId = req.user.empresa_id;

        if (!year) return res.status(400).json({ error: "Año requerido" });

        const nominasConNombres = await sql`
            SELECT
                n.*,
                COALESCE(u.nombre, 'Sin asignar') as nombre,
                COALESCE(u.apellidos, '') as apellidos
            FROM nominas_180 n
            LEFT JOIN employees_180 e ON e.id = n.empleado_id
            LEFT JOIN users_180 u ON u.id = e.user_id
            WHERE n.empresa_id = ${empresaId}
            AND n.anio = ${parseInt(year)}
            ORDER BY n.mes ASC
        `;

        res.json({ success: true, data: nominasConNombres });
    } catch (error) {
        console.error("Error getLibroNominas:", error);
        res.status(500).json({ success: false, error: "Error obteniendo libro nóminas" });
    }
}

/**
 * Obtener estado del calendario fiscal para un ejercicio
 * Devuelve el estado de cada modelo/periodo para comparar con los plazos
 */
export async function getCalendarioFiscal(req, res) {
    try {
        const { year } = req.params;
        const empresaId = req.user.empresa_id;

        if (!year) return res.status(400).json({ error: "Año requerido" });

        const models = await sql`
            SELECT modelo, periodo, ejercicio, estado, fecha_presentacion
            FROM fiscal_models_180
            WHERE empresa_id = ${empresaId}
            AND ejercicio = ${parseInt(year)}
            ORDER BY modelo, periodo
        `;

        res.json({ success: true, data: models });

    } catch (error) {
        console.error("Error getCalendarioFiscal:", error);
        // If table doesn't exist yet, return empty array gracefully
        if (error.code === '42P01') {
            return res.json({ success: true, data: [] });
        }
        res.status(500).json({ success: false, error: "Error obteniendo calendario fiscal" });
    }
}

/**
 * Descargar fichero BOE para un modelo
 */
export async function downloadBOE(req, res) {
    try {
        const { year, trimestre, modelo } = req.query;
        const empresaId = req.user.empresa_id;

        if (!year || !trimestre || !modelo) {
            return res.status(400).json({ error: "Año, trimestre y modelo requeridos" });
        }

        const data = await calcularDatosModelos(empresaId, year, trimestre);
        let boe = "";

        switch (modelo) {
            case '303':
                boe = aeatService.generarBOE303(data);
                break;
            case '130':
                boe = aeatService.generarBOE130(data);
                break;
            case '111':
                boe = aeatService.generarBOE111(data);
                break;
            case '115':
                boe = aeatService.generarBOE115 ? aeatService.generarBOE115(data) : JSON.stringify(data.modelo115, null, 2);
                break;
            case '349':
                boe = aeatService.generarBOE349 ? aeatService.generarBOE349(data) : JSON.stringify(data.modelo349, null, 2);
                break;
            default:
                return res.status(400).json({ error: "Modelo no soportado para descarga" });
        }

        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename=Modelo_${modelo}_${year}_T${trimestre}.txt`);
        res.send(boe);

    } catch (error) {
        console.error("Error downloadBOE:", error);
        res.status(500).json({ success: false, error: "Error generando fichero descarga" });
    }
}
