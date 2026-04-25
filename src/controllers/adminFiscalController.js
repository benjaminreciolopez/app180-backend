
import { sql } from "../db.js";
import { aeatService } from "../services/aeatService.js";
import { FiscalRules } from "../services/fiscalRulesEngine.js";
import logger from "../utils/logger.js";

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
export async function calcularDatosModelos(empresaId, year, trimestre, opciones = {}) {
    const { startDate, endDate } = getTrimestreDates(year, trimestre);

    // Reglas fiscales del ejercicio (coeficientes, tipos, límites desde BD)
    const rules = await FiscalRules.forYear(parseInt(year));

    // =========================================================================
    // MODELO 303: Lee IVA desde ASIENTOS CONTABLES (cuentas 472/477)
    // Esto refleja los importes reales contabilizados (con deducciones parciales)
    // =========================================================================

    // 1. IVA DEVENGADO - Cuenta 477 (Haber) en asientos del trimestre
    // Desglosamos por tipo de IVA usando las líneas de factura como referencia.
    //
    // Art. 89 LIVA: una factura anulada por rectificativa sigue declarándose
    // en el periodo en que se emitió la original; la rectificativa (con
    // importes negativos) se declara en el periodo en que se emite. Por eso
    // incluimos también ANULADAs que tengan factura_rectificativa_id
    // (anuladas por rectificativa, no por borrado manual).
    const ventasPorTipo = await sql`
        SELECT
            COALESCE(lf.iva_percent, 21) as tipo_iva,
            COALESCE(SUM(lf.cantidad * lf.precio_unitario), 0) as base_imponible,
            COALESCE(SUM(lf.cantidad * lf.precio_unitario * lf.iva_percent / 100), 0) as cuota_iva
        FROM factura_180 f
        JOIN lineafactura_180 lf ON lf.factura_id = f.id
        WHERE f.empresa_id = ${empresaId}
        AND (
            f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            OR (f.estado = 'ANULADA' AND f.factura_rectificativa_id IS NOT NULL)
        )
        AND f.fecha BETWEEN ${startDate} AND ${endDate}
        AND (f.es_test IS NOT TRUE)
        GROUP BY COALESCE(lf.iva_percent, 21)
        ORDER BY tipo_iva
    `;

    // Desglose adicional: solo rectificativas del periodo (informativo para
    // el frontend y para el casillado del modelo 303 cuando AEAT pida
    // separar correcciones de cuotas devengadas).
    const rectificativasPorTipo = await sql`
        SELECT
            COALESCE(lf.iva_percent, 21) as tipo_iva,
            COALESCE(SUM(lf.cantidad * lf.precio_unitario), 0) as base_imponible,
            COALESCE(SUM(lf.cantidad * lf.precio_unitario * lf.iva_percent / 100), 0) as cuota_iva
        FROM factura_180 f
        JOIN lineafactura_180 lf ON lf.factura_id = f.id
        WHERE f.empresa_id = ${empresaId}
        AND f.rectificativa = true
        AND f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND f.fecha BETWEEN ${startDate} AND ${endDate}
        AND (f.es_test IS NOT TRUE)
        GROUP BY COALESCE(lf.iva_percent, 21)
        ORDER BY tipo_iva
    `;

    // Total IVA repercutido desde contabilidad (cuenta 477)
    const [ivaRepercutidoContable] = await sql`
        SELECT COALESCE(SUM(al.haber), 0) as total
        FROM asiento_lineas_180 al
        JOIN asientos_180 a ON a.id = al.asiento_id
        WHERE a.empresa_id = ${empresaId}
        AND a.fecha BETWEEN ${startDate} AND ${endDate}
        AND a.deleted_at IS NULL
        AND al.cuenta_codigo LIKE '477%'
    `;

    // Total IVA soportado desde contabilidad (cuenta 472)
    const [ivaSoportadoContable] = await sql`
        SELECT COALESCE(SUM(al.debe), 0) as total
        FROM asiento_lineas_180 al
        JOIN asientos_180 a ON a.id = al.asiento_id
        WHERE a.empresa_id = ${empresaId}
        AND a.fecha BETWEEN ${startDate} AND ${endDate}
        AND a.deleted_at IS NULL
        AND al.cuenta_codigo LIKE '472%'
    `;

    // Base deducible desde contabilidad (cuentas grupo 6)
    const [baseDeducibleContable] = await sql`
        SELECT COALESCE(SUM(al.debe), 0) as total
        FROM asiento_lineas_180 al
        JOIN asientos_180 a ON a.id = al.asiento_id
        WHERE a.empresa_id = ${empresaId}
        AND a.fecha BETWEEN ${startDate} AND ${endDate}
        AND a.deleted_at IS NULL
        AND al.cuenta_codigo LIKE '6%'
    `;

    // Usar IVA contable si hay asientos, sino fallback a facturas/compras
    const hayAsientosIVA = parseFloat(ivaRepercutidoContable.total) > 0 || parseFloat(ivaSoportadoContable.total) > 0;

    const ventas = {
        base_imponible: ventasPorTipo.reduce((s, r) => s + parseFloat(r.base_imponible), 0),
        iva_repercutido: hayAsientosIVA
            ? parseFloat(ivaRepercutidoContable.total)
            : ventasPorTipo.reduce((s, r) => s + parseFloat(r.cuota_iva), 0),
        count: ventasPorTipo.length
    };

    // 2. IVA DEDUCIBLE - Cuenta 472 (Debe) en asientos del trimestre
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

    const compras = {
        base_imponible: hayAsientosIVA
            ? parseFloat(baseDeducibleContable.total)
            : comprasPorTipo.reduce((s, r) => s + parseFloat(r.base_imponible), 0),
        iva_soportado: hayAsientosIVA
            ? parseFloat(ivaSoportadoContable.total)
            : comprasPorTipo.reduce((s, r) => s + parseFloat(r.cuota_iva), 0),
        count: comprasPorTipo.length
    };

    // =========================================================================
    // MODELO 130: Lee ingresos/gastos desde ASIENTOS CONTABLES (grupo 6/7)
    // =========================================================================
    const startYear = `${year}-01-01`;

    // Ingresos acumulados: Haber de cuentas grupo 7 (Ventas/Ingresos)
    const [ingresosContables] = await sql`
        SELECT COALESCE(SUM(al.haber), 0) as total
        FROM asiento_lineas_180 al
        JOIN asientos_180 a ON a.id = al.asiento_id
        WHERE a.empresa_id = ${empresaId}
        AND a.fecha BETWEEN ${startYear} AND ${endDate}
        AND a.deleted_at IS NULL
        AND al.cuenta_codigo LIKE '7%'
    `;

    // Gastos acumulados: Debe de cuentas grupo 6 (Compras/Gastos)
    // Para IRPF, los gastos de vehículo (pct_deduccion_iva < 100) se deducen proporcionalmente
    const [gastosContables] = await sql`
        SELECT COALESCE(SUM(al.debe), 0) as total,
               COALESCE(SUM(
                   CASE WHEN a.referencia_tipo = 'gasto' AND p.pct_deduccion_iva IS NOT NULL AND p.pct_deduccion_iva < 100
                        THEN al.debe * (1 - p.pct_deduccion_iva / 100.0)
                        ELSE 0
                   END
               ), 0) as ajuste_vehiculo_irpf
        FROM asiento_lineas_180 al
        JOIN asientos_180 a ON a.id = al.asiento_id
        LEFT JOIN purchases_180 p ON a.referencia_tipo = 'gasto' AND a.referencia_id = p.id::text
        WHERE a.empresa_id = ${empresaId}
        AND a.fecha BETWEEN ${startYear} AND ${endDate}
        AND a.deleted_at IS NULL
        AND al.cuenta_codigo LIKE '6%'
    `;

    // Nóminas acumuladas (se leen de asientos si existen, sino de tabla directa)
    const [nominasContables] = await sql`
        SELECT COALESCE(SUM(al.debe), 0) as total
        FROM asiento_lineas_180 al
        JOIN asientos_180 a ON a.id = al.asiento_id
        WHERE a.empresa_id = ${empresaId}
        AND a.fecha BETWEEN ${startYear} AND ${endDate}
        AND a.deleted_at IS NULL
        AND al.cuenta_codigo IN ('640', '642')
    `;

    // Fallback: datos directos si no hay asientos
    const hayAsientosIngresos = parseFloat(ingresosContables.total) > 0;

    let acumuladoVentas, acumuladoCompras, acumuladoNominas;

    if (hayAsientosIngresos) {
        // FUENTE: Contabilidad (asientos)
        acumuladoVentas = { ingresos: parseFloat(ingresosContables.total) };
        // Los gastos del grupo 6 ya incluyen las nóminas (640, 642), así que no sumar doble
        // Restamos el ajuste de vehículo para IRPF (Art. 22 RIRPF: misma afectación que IVA)
        const gastosGrupo6 = parseFloat(gastosContables.total);
        const ajusteVehiculoIrpf = parseFloat(gastosContables.ajuste_vehiculo_irpf);
        acumuladoCompras = { gastos: gastosGrupo6 - ajusteVehiculoIrpf, ajuste_vehiculo_irpf: ajusteVehiculoIrpf };
        acumuladoNominas = { total_coste: 0 }; // Ya incluido en grupo 6
    } else {
        // FALLBACK: Tablas directas (sin asientos)
        const [v] = await sql`
            SELECT COALESCE(SUM(subtotal), 0) as ingresos
            FROM factura_180
            WHERE empresa_id = ${empresaId}
            AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND fecha BETWEEN ${startYear} AND ${endDate}
            AND (es_test IS NOT TRUE)
        `;
        const [c] = await sql`
            SELECT COALESCE(SUM(base_imponible), 0) as gastos,
                   COALESCE(SUM(
                       CASE WHEN pct_deduccion_iva IS NOT NULL AND pct_deduccion_iva < 100
                            THEN base_imponible * (1 - pct_deduccion_iva / 100.0)
                            ELSE 0
                       END
                   ), 0) as ajuste_vehiculo_irpf
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND fecha_compra BETWEEN ${startYear} AND ${endDate}
        `;
        const [n] = await sql`
            SELECT
                COALESCE(SUM(bruto), 0) + COALESCE(SUM(seguridad_social_empresa), 0) as total_coste
            FROM nominas_180
            WHERE empresa_id = ${empresaId}
            AND anio = ${year}
            AND mes <= ${(parseInt(trimestre) * 3)}
        `;
        acumuladoVentas = v;
        const ajusteIrpf = parseFloat(c.ajuste_vehiculo_irpf);
        acumuladoCompras = { gastos: parseFloat(c.gastos) - ajusteIrpf, ajuste_vehiculo_irpf: ajusteIrpf };
        acumuladoNominas = n;
    }

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

    const [emisor] = await sql`
        SELECT nif, nombre,
               COALESCE(prorrata_iva_pct, 100)::numeric as prorrata_iva_pct,
               prorrata_iva_definitivo
        FROM emisor_180 WHERE empresa_id = ${empresaId}
    `;

    // Helper para extraer base+cuota de un tipo de IVA concreto
    const getDevengadoPorTipo = (tipo) => {
        const row = ventasPorTipo.find(r => parseFloat(r.tipo_iva) === tipo);
        return { base: row ? parseFloat(row.base_imponible) : 0, cuota: row ? parseFloat(row.cuota_iva) : 0 };
    };
    const getDeduciblePorTipo = (tipo) => {
        const row = comprasPorTipo.find(r => parseFloat(r.tipo_iva) === tipo);
        return { base: row ? parseFloat(row.base_imponible) : 0, cuota: row ? parseFloat(row.cuota_iva) : 0 };
    };

    // Pro-rata IVA general (Art. 102 LIVA): si la empresa realiza operaciones
    // con y sin derecho a deducción, solo es deducible la fracción del IVA
    // soportado correspondiente al porcentaje provisional configurado.
    const prorrataPct = emisor?.prorrata_iva_pct !== undefined && emisor?.prorrata_iva_pct !== null
        ? parseFloat(emisor.prorrata_iva_pct) : 100;
    const aplicaProrrata = prorrataPct < 100;
    const ivaSoportadoBruto = parseFloat(compras.iva_soportado);
    const ivaSoportadoDeducible = aplicaProrrata
        ? ivaSoportadoBruto * (prorrataPct / 100)
        : ivaSoportadoBruto;
    const ivaSoportadoNoDeducible = ivaSoportadoBruto - ivaSoportadoDeducible;

    // Casilla 44: Regularización por aplicación del porcentaje definitivo de
    // pro-rata. Solo aplica en 4T cuando emisor tiene prorrata_iva_definitivo
    // distinta de la provisional. Diferencia se aplica como ajuste positivo
    // (si definitivo > provisional → más deducible) o negativo.
    let regularizacionProrrata = 0;
    if (parseInt(trimestre) === 4 && emisor?.prorrata_iva_definitivo !== null && emisor?.prorrata_iva_definitivo !== undefined) {
        const definitivo = parseFloat(emisor.prorrata_iva_definitivo);
        if (!Number.isNaN(definitivo) && Math.abs(definitivo - prorrataPct) > 0.01) {
            // Regularización sobre el IVA soportado anual.
            const [ivaSoportadoAnual] = await sql`
                SELECT COALESCE(SUM(COALESCE(cuota_iva, iva_importe, 0)), 0) as total
                FROM purchases_180
                WHERE empresa_id = ${empresaId}
                AND activo = true
                AND fecha_compra BETWEEN ${`${year}-01-01`} AND ${endDate}
            `;
            const totalAnual = parseFloat(ivaSoportadoAnual.total);
            const deducibleConProvisional = totalAnual * (prorrataPct / 100);
            const deducibleConDefinitivo = totalAnual * (definitivo / 100);
            regularizacionProrrata = deducibleConDefinitivo - deducibleConProvisional;
        }
    }

    const resultadoRegimenGeneral = parseFloat(ventas.iva_repercutido) - ivaSoportadoDeducible + regularizacionProrrata;

    // Cuotas a compensar de periodos anteriores (casillas 110, 78, 87)
    // Se buscan saldos negativos pendientes de trimestres anteriores del mismo año
    // y del 4T del año anterior si es 1T
    let cuotasCompensarPendientes = 0;
    const q = parseInt(trimestre);

    // Buscar saldo pendiente de compensar del trimestre anterior
    // Para 1T: buscar 4T del año anterior
    // Para 2T-4T: buscar el trimestre anterior del mismo año
    const prevPeriodo = q === 1 ? '4T' : `${q - 1}T`;
    const prevYear = q === 1 ? parseInt(year) - 1 : parseInt(year);

    const [prevModel303] = await sql`
        SELECT datos_json
        FROM fiscal_models_180
        WHERE empresa_id = ${empresaId}
        AND modelo = '303'
        AND ejercicio = ${prevYear}
        AND periodo = ${prevPeriodo}
        AND estado IN ('GENERADO', 'PRESENTADO')
        ORDER BY updated_at DESC
        LIMIT 1
    `;

    if (prevModel303?.datos_json?.cuotas_compensar_pendientes_posterior > 0) {
        cuotasCompensarPendientes = parseFloat(prevModel303.datos_json.cuotas_compensar_pendientes_posterior);
    }

    // Override manual: permite al usuario introducir cuotas a compensar si no hay registro previo
    if (opciones.cuotasCompensarManual !== undefined && opciones.cuotasCompensarManual > 0) {
        cuotasCompensarPendientes = parseFloat(opciones.cuotasCompensarManual);
    }

    // Casilla 78: Solo se aplican si el resultado es positivo
    const cuotasAplicadas = resultadoRegimenGeneral > 0
        ? Math.min(cuotasCompensarPendientes, resultadoRegimenGeneral)
        : 0;

    // Casilla 87: Pendientes para periodos posteriores
    const cuotasPendientesPosterior = cuotasCompensarPendientes - cuotasAplicadas;

    // Si el resultado de este periodo es negativo, se acumula para compensar en el futuro
    const resultadoAutoliquidacion = resultadoRegimenGeneral - cuotasAplicadas;
    const nuevasCuotasCompensar = resultadoAutoliquidacion < 0
        ? cuotasPendientesPosterior + Math.abs(resultadoAutoliquidacion)
        : cuotasPendientesPosterior;

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
            cuota: ivaSoportadoDeducible,
            cuota_bruta: ivaSoportadoBruto,
            cuota_no_deducible: ivaSoportadoNoDeducible,
            por_tipo: {
                al_4:  getDeduciblePorTipo(4),
                al_10: getDeduciblePorTipo(10),
                al_21: getDeduciblePorTipo(21),
            }
        },
        prorrata: {
            aplica: aplicaProrrata,
            pct_provisional: prorrataPct,
            pct_definitivo: emisor?.prorrata_iva_definitivo !== null && emisor?.prorrata_iva_definitivo !== undefined
                ? parseFloat(emisor.prorrata_iva_definitivo) : null,
            regularizacion_casilla_44: regularizacionProrrata
        },
        resultado_regimen_general: resultadoRegimenGeneral,
        cuotas_compensar_pendientes: cuotasCompensarPendientes,       // Casilla 110
        cuotas_compensar_aplicadas: cuotasAplicadas,                   // Casilla 78
        cuotas_compensar_pendientes_posterior: nuevasCuotasCompensar,  // Casilla 87
        resultado: resultadoAutoliquidacion,                           // Casilla 69/71
        rectificativas: {
            base: rectificativasPorTipo.reduce((s, r) => s + parseFloat(r.base_imponible), 0),
            cuota: rectificativasPorTipo.reduce((s, r) => s + parseFloat(r.cuota_iva), 0),
            por_tipo: {
                al_4:  (() => { const r = rectificativasPorTipo.find(x => parseFloat(x.tipo_iva) === 4);  return { base: r ? parseFloat(r.base_imponible) : 0, cuota: r ? parseFloat(r.cuota_iva) : 0 }; })(),
                al_10: (() => { const r = rectificativasPorTipo.find(x => parseFloat(x.tipo_iva) === 10); return { base: r ? parseFloat(r.base_imponible) : 0, cuota: r ? parseFloat(r.cuota_iva) : 0 }; })(),
                al_21: (() => { const r = rectificativasPorTipo.find(x => parseFloat(x.tipo_iva) === 21); return { base: r ? parseFloat(r.base_imponible) : 0, cuota: r ? parseFloat(r.cuota_iva) : 0 }; })(),
            }
        }
    };

    const totalGastosDirectos = parseFloat(acumuladoCompras.gastos) + parseFloat(acumuladoNominas.total_coste);
    const rendimientoPrevio = parseFloat(acumuladoVentas.ingresos) - totalGastosDirectos;

    // Gastos de difícil justificación: % del rendimiento neto previo
    // (Art. 30 Reglamento IRPF - Estimación Directa Simplificada)
    // Coeficiente y tope cargados desde fiscal_reglas_180 (modelo_130).
    const COEF_GASTOS_DIFICIL_JUSTIFICACION = rules.getNum('modelo_130', 'coef_gastos_dificil_justificacion', 0.05);
    const LIMITE_GASTOS_DIFICIL_JUSTIFICACION = rules.getNum('modelo_130', 'limite_gastos_dificil_justificacion', 2000);
    const gastosDificilJustificacion = rendimientoPrevio > 0
        ? Math.min(rendimientoPrevio * COEF_GASTOS_DIFICIL_JUSTIFICACION, LIMITE_GASTOS_DIFICIL_JUSTIFICACION)
        : 0;

    const totalGastos = totalGastosDirectos + gastosDificilJustificacion;
    const rendimientoNeto = parseFloat(acumuladoVentas.ingresos) - totalGastos;

    const trimestreActual = parseInt(trimestre);
    const yearInt = parseInt(year);

    // Bases negativas de ejercicios anteriores (Art. 25 / 31 LIRPF):
    // un autónomo en estimación directa puede compensar resultados negativos
    // de los N ejercicios anteriores (configurable; por defecto 4). En el
    // modelo 130 esto reduce el rendimiento neto antes del pago fraccionado.
    const ANIOS_COMPENSACION = rules.getNum('modelo_130', 'anios_compensacion_bases_negativas', 4);
    let basesNegativasPool = 0;          // Total disponible de los N ejercicios anteriores
    let basesNegativasYaAplicadas = 0;   // Ya consumido en trimestres anteriores del año actual
    if (rendimientoNeto > 0) {
        const yearsAtras = Array.from({ length: ANIOS_COMPENSACION }, (_, i) => yearInt - 1 - i);
        const prioresEjercicios = await sql`
            SELECT ejercicio, datos_json
            FROM fiscal_models_180
            WHERE empresa_id = ${empresaId}
            AND modelo = '130'
            AND periodo = '4T'
            AND ejercicio IN ${sql(yearsAtras)}
            AND estado IN ('GENERADO', 'PRESENTADO')
        `;
        for (const e of prioresEjercicios) {
            const rend = parseFloat(e.datos_json?.rendimiento || 0);
            if (rend < 0) basesNegativasPool += Math.abs(rend);
        }

        if (trimestreActual > 1) {
            const previousQuarters = Array.from({ length: trimestreActual - 1 }, (_, i) => `${i + 1}T`);
            const [yaAplicado] = await sql`
                SELECT COALESCE(SUM((datos_json->>'bases_negativas_aplicadas')::numeric), 0) as total
                FROM fiscal_models_180
                WHERE empresa_id = ${empresaId}
                AND modelo = '130'
                AND ejercicio = ${yearInt}
                AND periodo IN ${sql(previousQuarters)}
                AND estado IN ('GENERADO', 'PRESENTADO')
            `;
            basesNegativasYaAplicadas = parseFloat(yaAplicado.total);
        }
    }
    const basesNegativasDisponibles = Math.max(0, basesNegativasPool - basesNegativasYaAplicadas);
    const basesNegativasAplicadas = Math.min(basesNegativasDisponibles, Math.max(0, rendimientoNeto));
    const rendimientoTrasCompensar = rendimientoNeto - basesNegativasAplicadas;
    const TIPO_PAGO_FRACCIONADO = rules.getNum('modelo_130', 'tipo_pago_fraccionado', 20) / 100;
    const pagoFraccionado = rendimientoTrasCompensar > 0 ? rendimientoTrasCompensar * TIPO_PAGO_FRACCIONADO : 0;

    // Cargar pagos fraccionados de trimestres anteriores del mismo año
    let pagosAnteriores = 0;
    if (trimestreActual > 1) {
        const previousQuarters = Array.from({ length: trimestreActual - 1 }, (_, i) => `${i + 1}T`);
        const [prev] = await sql`
            SELECT COALESCE(SUM(resultado_importe), 0) as total_pagado
            FROM fiscal_models_180
            WHERE empresa_id = ${empresaId}
            AND modelo = '130'
            AND ejercicio = ${yearInt}
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
            nominas: parseFloat(acumuladoNominas.total_coste),
            ajuste_vehiculo_irpf: acumuladoCompras.ajuste_vehiculo_irpf || 0,
            gastos_dificil_justificacion: gastosDificilJustificacion
        },
        rendimiento_previo: rendimientoPrevio,
        coef_gastos_dificil_justificacion: COEF_GASTOS_DIFICIL_JUSTIFICACION,
        rendimiento: rendimientoNeto,
        // Casilla 13 / 15 del modelo 130: compensación bases negativas
        bases_negativas_pool: basesNegativasPool,
        bases_negativas_ya_aplicadas: basesNegativasYaAplicadas,
        bases_negativas_disponibles: basesNegativasDisponibles,
        bases_negativas_aplicadas: basesNegativasAplicadas,
        rendimiento_tras_compensar: rendimientoTrasCompensar,
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
        fuente_datos: hayAsientosIVA ? 'contabilidad' : 'facturas_gastos',
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
    // Incluye facturas rectificadas (ANULADA con factura_rectificativa_id)
    // por Art. 89 LIVA: deben seguir declarándose en su periodo original.
    const ventasPorTipo = await sql`
        SELECT
            COALESCE(lf.iva_percent, 21) as tipo_iva,
            COALESCE(SUM(lf.cantidad * lf.precio_unitario), 0) as base_imponible,
            COALESCE(SUM(lf.cantidad * lf.precio_unitario * lf.iva_percent / 100), 0) as cuota_iva
        FROM factura_180 f
        JOIN lineafactura_180 lf ON lf.factura_id = f.id
        WHERE f.empresa_id = ${empresaId}
        AND (
            f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            OR (f.estado = 'ANULADA' AND f.factura_rectificativa_id IS NOT NULL)
        )
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
            COALESCE(e.nombre, 'Sin asignar') as nombre,
            COALESCE(e.dni_nif, '') as nif,
            SUM(n.bruto) as retribuciones_integras,
            SUM(n.irpf_retencion) as retenciones,
            SUM(COALESCE(n.seguridad_social_empleado, 0)) as ss_empleado,
            COUNT(*) as num_nominas
        FROM nominas_180 n
        LEFT JOIN employees_180 e ON e.id = n.empleado_id
        WHERE n.empresa_id = ${empresaId}
        AND n.anio = ${parseInt(year)}
        GROUP BY e.id, e.nombre, e.dni_nif
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
        logger.error("getModelo390 failed", { message: error.message });
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
        logger.error("getModelo190 failed", { message: error.message });
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
        logger.error("getModelo180 failed", { message: error.message });
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
        logger.error("getModelo347 failed", { message: error.message });
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

        // Autoliquidaciones: .ses | Informativas: .NNN | Sociedades: .xml
        const AUTOLIQUIDACIONES_ANUALES = ['390', '100'];

        switch (modelo) {
            case '390':
                data = await calcularModelo390(empresaId, year);
                boe = aeatService.generarBOE390(data);
                break;
            case '190':
                data = await calcularModelo190(empresaId, year);
                boe = aeatService.generarBOE190(data);
                break;
            case '180':
                data = await calcularModelo180(empresaId, year);
                boe = aeatService.generarBOE180(data);
                break;
            case '347':
                data = await calcularModelo347(empresaId, year);
                boe = aeatService.generarBOE347(data);
                break;
            case '100': {
                // Renta IRPF - cargar datos de renta_irpf_180
                const [rentaData] = await sql`
                    SELECT r.*, e.nif, e.nombre
                    FROM renta_irpf_180 r
                    LEFT JOIN emisor_180 e ON e.empresa_id = r.empresa_id
                    WHERE r.empresa_id = ${empresaId} AND r.ejercicio = ${parseInt(year)}
                `;
                if (!rentaData) {
                    return res.status(404).json({ error: "No hay datos de Renta IRPF calculados para este ejercicio. Calcule primero la renta." });
                }
                data = rentaData;
                boe = aeatService.generarBOE100(data);
                break;
            }
            case '200': {
                // Impuesto Sociedades - cargar datos de impuesto_sociedades_180
                const [isData] = await sql`
                    SELECT s.*, e.nif, e.nombre
                    FROM impuesto_sociedades_180 s
                    LEFT JOIN emisor_180 e ON e.empresa_id = s.empresa_id
                    WHERE s.empresa_id = ${empresaId} AND s.ejercicio = ${parseInt(year)}
                `;
                if (!isData) {
                    return res.status(404).json({ error: "No hay datos de Impuesto de Sociedades calculados para este ejercicio." });
                }
                data = isData;
                boe = aeatService.generarXML200(data);
                break;
            }
            default:
                return res.status(400).json({ error: "Modelo anual no soportado" });
        }

        const esAutoliquidacion = AUTOLIQUIDACIONES_ANUALES.includes(modelo);
        const esXml = modelo === '200';
        const nif = data.nif || 'SINNI';

        let extension, filename, contentType;
        if (esXml) {
            extension = 'xml';
            filename = `${nif}-${modelo}-${year}.xml`;
            contentType = 'application/xml; charset=iso-8859-1';
        } else if (esAutoliquidacion) {
            extension = 'ses';
            filename = `${nif}-${modelo}-${year}.ses`;
            contentType = 'text/plain; charset=iso-8859-1';
        } else {
            extension = modelo;
            filename = `${nif}${year}.${modelo}`;
            contentType = 'text/plain; charset=iso-8859-1';
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.send(boe);

    } catch (error) {
        logger.error("downloadBOEAnual failed", { message: error.message });
        res.status(500).json({ success: false, error: "Error generando fichero descarga anual" });
    }
}

/**
 * Obtener datos para paneles de control
 */
export async function getFiscalData(req, res) {
    try {
        const { year, trimestre, cuotas_compensar_303 } = req.query;
        const empresaId = req.user.empresa_id;

        if (!year || !trimestre) return res.status(400).json({ error: "Año y Trimestre requeridos" });

        const opciones = {};
        if (cuotas_compensar_303) {
            opciones.cuotasCompensarManual = parseFloat(cuotas_compensar_303);
        }

        const data = await calcularDatosModelos(empresaId, year, trimestre, opciones);
        res.json({ success: true, data });

    } catch (error) {
        logger.error("getFiscalData failed", { message: error.message });
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
        logger.error("getLibroVentas failed", { message: error.message });
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
        logger.error("getLibroGastos failed", { message: error.message });
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
        logger.error("getLibroNominas failed", { message: error.message });
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
            SELECT modelo, periodo, ejercicio, estado, presentado_at as fecha_presentacion
            FROM fiscal_models_180
            WHERE empresa_id = ${empresaId}
            AND ejercicio = ${parseInt(year)}
            ORDER BY modelo, periodo
        `;

        res.json({ success: true, data: models });

    } catch (error) {
        logger.error("getCalendarioFiscal failed", { message: error.message });
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
        const { year, trimestre, modelo, cuotas_compensar_303 } = req.query;
        const empresaId = req.user.empresa_id;

        if (!year || !trimestre || !modelo) {
            return res.status(400).json({ error: "Año, trimestre y modelo requeridos" });
        }

        const opciones = {};
        if (cuotas_compensar_303) {
            opciones.cuotasCompensarManual = parseFloat(cuotas_compensar_303);
        }

        const data = await calcularDatosModelos(empresaId, year, trimestre, opciones);
        let boe = "";

        // Autoliquidaciones usan .ses, informativas usan .NNN (número modelo)
        const AUTOLIQUIDACIONES = ['303', '130', '111', '115'];
        const esAutoliquidacion = AUTOLIQUIDACIONES.includes(modelo);
        const nif = data.nif || 'SINNI';

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
                boe = aeatService.generarBOE115(data);
                break;
            case '349':
                boe = aeatService.generarBOE349(data);
                break;
            default:
                return res.status(400).json({ error: "Modelo no soportado para descarga" });
        }

        const extension = esAutoliquidacion ? 'ses' : modelo;
        const filename = esAutoliquidacion
            ? `${nif}-${modelo}-${year}${trimestre}T.${extension}`
            : `${nif}${year}${trimestre}T.${extension}`;

        res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.send(boe);

    } catch (error) {
        logger.error("downloadBOE failed", { message: error.message });
        res.status(500).json({ success: false, error: "Error generando fichero descarga" });
    }
}
