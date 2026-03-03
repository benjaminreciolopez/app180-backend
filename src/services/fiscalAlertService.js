/**
 * Fiscal Intelligence / Hacienda Alert Prevention Service
 *
 * Analiza los ratios fiscales de una empresa y detecta patrones
 * que podrían disparar alertas en los algoritmos de la AEAT.
 *
 * Reutiliza calcularDatosModelos() del controlador fiscal existente.
 */

import { sql } from "../db.js";
import { calcularDatosModelos } from "../controllers/adminFiscalController.js";
import { crearNotificacionSistema } from "../controllers/notificacionesController.js";

// ──────────────────────────────────────────────
// Medias sectoriales de referencia (AEAT)
// ──────────────────────────────────────────────

const SECTOR_DEFAULTS = {
    servicios_profesionales: { gastos_ingresos_ratio: 0.65, iva_ratio_max: 1.2, cash_pct_max: 0.15 },
    comercio_minorista: { gastos_ingresos_ratio: 0.75, iva_ratio_max: 1.5, cash_pct_max: 0.40 },
    hosteleria: { gastos_ingresos_ratio: 0.70, iva_ratio_max: 1.3, cash_pct_max: 0.50 },
    construccion: { gastos_ingresos_ratio: 0.80, iva_ratio_max: 1.8, cash_pct_max: 0.25 },
    transporte: { gastos_ingresos_ratio: 0.75, iva_ratio_max: 2.0, cash_pct_max: 0.20 },
    tecnologia: { gastos_ingresos_ratio: 0.55, iva_ratio_max: 1.0, cash_pct_max: 0.10 },
    sanitario: { gastos_ingresos_ratio: 0.60, iva_ratio_max: 0.8, cash_pct_max: 0.15 },
    formacion: { gastos_ingresos_ratio: 0.50, iva_ratio_max: 0.7, cash_pct_max: 0.15 },
    default: { gastos_ingresos_ratio: 0.70, iva_ratio_max: 1.3, cash_pct_max: 0.25 },
};

export const SECTOR_LIST = Object.keys(SECTOR_DEFAULTS).filter(s => s !== 'default');

const DEFAULT_THRESHOLDS = {
    gastos_ingresos_ratio_max: null,
    iva_deducible_devengado_ratio_max: null,
    max_consecutive_loss_quarters: 3,
    pattern_change_pct: 40,
    cash_payment_pct_max: null,
};

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function getTrimestreDates(year, quarter) {
    const y = parseInt(year);
    const q = parseInt(quarter);
    const startMonth = (q - 1) * 3;
    const startDate = new Date(y, startMonth, 1);
    const endDate = new Date(y, startMonth + 3, 0);
    return {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
    };
}

function prevQuarter(year, quarter) {
    const q = parseInt(quarter);
    const y = parseInt(year);
    if (q === 1) return { year: y - 1, quarter: 4 };
    return { year: y, quarter: q - 1 };
}

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────

export async function getAlertConfig(empresaId) {
    const [config] = await sql`
        SELECT fiscal_alert_config
        FROM empresa_config_180
        WHERE empresa_id = ${empresaId}
    `;

    const stored = config?.fiscal_alert_config || {};
    const sector = stored.sector || 'default';
    const sectorDefaults = SECTOR_DEFAULTS[sector] || SECTOR_DEFAULTS.default;

    return {
        iae_code: stored.iae_code || null,
        sector,
        enabled: stored.enabled !== false,
        last_scan_at: stored.last_scan_at || null,
        thresholds: {
            ...DEFAULT_THRESHOLDS,
            gastos_ingresos_ratio_max: sectorDefaults.gastos_ingresos_ratio,
            iva_deducible_devengado_ratio_max: sectorDefaults.iva_ratio_max,
            cash_payment_pct_max: sectorDefaults.cash_pct_max,
            ...(stored.thresholds || {}),
        },
        sectorDefaults,
    };
}

// ──────────────────────────────────────────────
// CHECK 1: Ratio Gastos / Ingresos
// ──────────────────────────────────────────────

function checkGastosIngresosRatio(modelData, config) {
    const ingresos = modelData.modelo130.ingresos || 0;
    const gastos = modelData.modelo130.gastos || 0;
    const threshold = config.thresholds.gastos_ingresos_ratio_max;

    if (ingresos <= 0) {
        if (gastos > 0) {
            return {
                triggered: true,
                alert_type: 'gastos_sin_ingresos',
                severity: 'critical',
                current_value: null,
                threshold,
                message: 'Hay gastos registrados pero no hay ingresos declarados',
                recommendation: 'Registra las facturas emitidas. Declarar solo gastos sin ingresos es una de las principales alertas de Hacienda.',
            };
        }
        return { triggered: false };
    }

    const ratio = gastos / ingresos;

    if (ratio > threshold * 1.2) {
        return {
            triggered: true,
            alert_type: 'gastos_ingresos_ratio',
            severity: 'critical',
            current_value: ratio,
            threshold,
            message: `El ratio gastos/ingresos (${(ratio * 100).toFixed(1)}%) supera ampliamente la media del sector (${(threshold * 100).toFixed(0)}%)`,
            recommendation: `Necesitas aumentar la facturación o revisar los gastos deducidos. La media de tu sector está en ${(threshold * 100).toFixed(0)}%.`,
        };
    }

    if (ratio > threshold) {
        return {
            triggered: true,
            alert_type: 'gastos_ingresos_ratio',
            severity: 'warning',
            current_value: ratio,
            threshold,
            message: `El ratio gastos/ingresos (${(ratio * 100).toFixed(1)}%) supera la media del sector (${(threshold * 100).toFixed(0)}%)`,
            recommendation: 'Revisa que todos los gastos deducidos estén vinculados a la actividad profesional.',
        };
    }

    if (ratio > threshold * 0.85) {
        return {
            triggered: true,
            alert_type: 'gastos_ingresos_ratio',
            severity: 'info',
            current_value: ratio,
            threshold,
            message: `El ratio gastos/ingresos (${(ratio * 100).toFixed(1)}%) se acerca a la media del sector (${(threshold * 100).toFixed(0)}%)`,
            recommendation: 'De momento estás dentro de lo normal, pero vigila no aumentar mucho los gastos sin aumentar los ingresos.',
        };
    }

    return { triggered: false };
}

// ──────────────────────────────────────────────
// CHECK 2: Trimestres consecutivos con pérdidas
// ──────────────────────────────────────────────

async function checkConsecutiveLosses(empresaId, year, quarter) {
    let consecutiveLosses = 0;
    let currentYear = parseInt(year);
    let currentQuarter = parseInt(quarter);
    const maxLookback = 8; // hasta 2 años atrás

    for (let i = 0; i < maxLookback; i++) {
        try {
            const data = await calcularDatosModelos(empresaId, currentYear, currentQuarter);
            if (data.modelo130.rendimiento < 0) {
                consecutiveLosses++;
            } else {
                break;
            }
        } catch {
            break;
        }

        const prev = prevQuarter(currentYear, currentQuarter);
        currentYear = prev.year;
        currentQuarter = prev.quarter;
    }

    const threshold = 3;

    if (consecutiveLosses >= 4) {
        return {
            triggered: true,
            alert_type: 'consecutive_losses',
            severity: 'critical',
            current_value: consecutiveLosses,
            threshold,
            message: `Llevas ${consecutiveLosses} trimestres consecutivos declarando pérdidas`,
            recommendation: 'Declarar pérdidas durante mucho tiempo es una señal de alerta importante para Hacienda. Considera revisar la actividad o consultar con un asesor fiscal.',
        };
    }

    if (consecutiveLosses >= 3) {
        return {
            triggered: true,
            alert_type: 'consecutive_losses',
            severity: 'warning',
            current_value: consecutiveLosses,
            threshold,
            message: `Llevas ${consecutiveLosses} trimestres consecutivos con rendimiento negativo`,
            recommendation: 'Hacienda vigila actividades que declaran pérdidas sistemáticamente. Intenta equilibrar gastos e ingresos.',
        };
    }

    if (consecutiveLosses >= 2) {
        return {
            triggered: true,
            alert_type: 'consecutive_losses',
            severity: 'info',
            current_value: consecutiveLosses,
            threshold,
            message: `Llevas ${consecutiveLosses} trimestres con rendimiento negativo`,
            recommendation: 'Si la tendencia continúa un trimestre más, podrías entrar en zona de alerta.',
        };
    }

    return { triggered: false };
}

// ──────────────────────────────────────────────
// CHECK 3: Ratio IVA Deducible / Devengado
// ──────────────────────────────────────────────

function checkIvaRatio(modelData, config) {
    const devengado = modelData.modelo303.devengado.cuota || 0;
    const deducible = modelData.modelo303.deducible.cuota || 0;
    const threshold = config.thresholds.iva_deducible_devengado_ratio_max;

    if (devengado <= 0 && deducible > 0) {
        return {
            triggered: true,
            alert_type: 'iva_sin_devengado',
            severity: 'critical',
            current_value: null,
            threshold,
            message: 'Estás deduciendo IVA sin haber devengado ninguno (sin ventas)',
            recommendation: 'Solicitar devolución de IVA sin facturación es una de las principales alertas. Asegúrate de tener facturas emitidas.',
        };
    }

    if (devengado <= 0) return { triggered: false };

    const ratio = deducible / devengado;

    if (ratio > threshold * 1.3) {
        return {
            triggered: true,
            alert_type: 'iva_ratio',
            severity: 'critical',
            current_value: ratio,
            threshold,
            message: `El IVA deducible es ${ratio.toFixed(2)}x el devengado (máximo normal: ${threshold.toFixed(1)}x)`,
            recommendation: 'Un IVA deducible muy superior al devengado genera solicitudes de devolución que Hacienda revisa con lupa.',
        };
    }

    if (ratio > threshold) {
        return {
            triggered: true,
            alert_type: 'iva_ratio',
            severity: 'warning',
            current_value: ratio,
            threshold,
            message: `El ratio IVA deducible/devengado (${ratio.toFixed(2)}x) supera el máximo habitual (${threshold.toFixed(1)}x)`,
            recommendation: 'Revisa que todos los gastos con IVA deducido estén correctamente vinculados a la actividad.',
        };
    }

    return { triggered: false };
}

// ──────────────────────────────────────────────
// CHECK 4: Cambios bruscos de patrón
// ──────────────────────────────────────────────

async function checkPatternChanges(empresaId, year, quarter) {
    const alerts = [];
    const threshold = 40; // 40% cambio brusco

    // Comparar con trimestre anterior
    const prev = prevQuarter(year, quarter);
    let prevData;
    try {
        prevData = await calcularDatosModelos(empresaId, prev.year, prev.quarter);
    } catch {
        return alerts;
    }

    const currentData = await calcularDatosModelos(empresaId, year, quarter);

    // Extraer datos del trimestre actual (no acumulados) para comparar QoQ
    const { startDate: curStart, endDate: curEnd } = getTrimestreDates(year, quarter);
    const { startDate: prevStart, endDate: prevEnd } = getTrimestreDates(prev.year, prev.quarter);

    const [curVentas] = await sql`
        SELECT COALESCE(SUM(subtotal), 0) as total
        FROM factura_180
        WHERE empresa_id = ${empresaId}
        AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND fecha BETWEEN ${curStart} AND ${curEnd}
    `;
    const [prevVentas] = await sql`
        SELECT COALESCE(SUM(subtotal), 0) as total
        FROM factura_180
        WHERE empresa_id = ${empresaId}
        AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
        AND fecha BETWEEN ${prevStart} AND ${prevEnd}
    `;
    const [curGastos] = await sql`
        SELECT COALESCE(SUM(base_imponible), 0) as total
        FROM purchases_180
        WHERE empresa_id = ${empresaId} AND activo = true
        AND fecha_compra BETWEEN ${curStart} AND ${curEnd}
    `;
    const [prevGastos] = await sql`
        SELECT COALESCE(SUM(base_imponible), 0) as total
        FROM purchases_180
        WHERE empresa_id = ${empresaId} AND activo = true
        AND fecha_compra BETWEEN ${prevStart} AND ${prevEnd}
    `;

    const curV = parseFloat(curVentas.total);
    const prevV = parseFloat(prevVentas.total);
    const curG = parseFloat(curGastos.total);
    const prevG = parseFloat(prevGastos.total);

    // Spike de gastos
    if (prevG > 0) {
        const gastoChange = ((curG - prevG) / prevG) * 100;
        if (gastoChange > threshold) {
            alerts.push({
                triggered: true,
                alert_type: 'gasto_spike',
                severity: gastoChange > threshold * 2 ? 'critical' : 'warning',
                current_value: gastoChange,
                threshold,
                message: `Los gastos han aumentado un ${gastoChange.toFixed(0)}% respecto al trimestre anterior`,
                recommendation: 'Un aumento brusco de gastos sin aumento proporcional de ingresos genera alertas en los algoritmos de Hacienda.',
            });
        }
    }

    // Caída de ingresos
    if (prevV > 0) {
        const ventaChange = ((curV - prevV) / prevV) * 100;
        if (ventaChange < -threshold) {
            alerts.push({
                triggered: true,
                alert_type: 'ingreso_drop',
                severity: ventaChange < -threshold * 2 ? 'critical' : 'warning',
                current_value: ventaChange,
                threshold: -threshold,
                message: `Los ingresos han caído un ${Math.abs(ventaChange).toFixed(0)}% respecto al trimestre anterior`,
                recommendation: 'Una caída brusca de ingresos con gastos estables puede indicar irregularidades para Hacienda.',
            });
        }
    }

    return alerts;
}

// ──────────────────────────────────────────────
// CHECK 5: Pagos en efectivo excesivos
// ──────────────────────────────────────────────

async function checkCashPayments(empresaId, startDate, endDate, config) {
    const threshold = config.thresholds.cash_payment_pct_max;

    const [totalGastos] = await sql`
        SELECT COALESCE(SUM(total), 0) as total
        FROM purchases_180
        WHERE empresa_id = ${empresaId} AND activo = true
        AND fecha_compra BETWEEN ${startDate} AND ${endDate}
    `;
    const [cashGastos] = await sql`
        SELECT COALESCE(SUM(total), 0) as total
        FROM purchases_180
        WHERE empresa_id = ${empresaId} AND activo = true
        AND LOWER(COALESCE(metodo_pago, '')) IN ('efectivo', 'cash', 'metalico')
        AND fecha_compra BETWEEN ${startDate} AND ${endDate}
    `;

    const total = parseFloat(totalGastos.total);
    const cash = parseFloat(cashGastos.total);

    if (total <= 0) return { triggered: false };

    const cashPct = cash / total;

    if (cashPct > threshold * 1.5) {
        return {
            triggered: true,
            alert_type: 'cash_payments',
            severity: 'critical',
            current_value: cashPct,
            threshold,
            message: `El ${(cashPct * 100).toFixed(0)}% de los gastos son en efectivo (máximo recomendado: ${(threshold * 100).toFixed(0)}%)`,
            recommendation: 'Un uso excesivo de efectivo es una de las principales señales de economía sumergida para Hacienda. Usa medios de pago trazables.',
        };
    }

    if (cashPct > threshold) {
        return {
            triggered: true,
            alert_type: 'cash_payments',
            severity: 'warning',
            current_value: cashPct,
            threshold,
            message: `El ${(cashPct * 100).toFixed(0)}% de los pagos son en efectivo (por encima de la media del sector)`,
            recommendation: 'Intenta reducir los pagos en efectivo y usa transferencia o tarjeta cuando sea posible.',
        };
    }

    return { triggered: false };
}

// ──────────────────────────────────────────────
// CHECK 6: Retenciones faltantes en servicios profesionales
// ──────────────────────────────────────────────

async function checkMissingRetentions(empresaId, startDate, endDate) {
    // Keywords de servicios profesionales que deberían llevar retención IRPF
    // NO incluir 'autonomo' porque aparece en recibos de SS (TGSS) que no son servicios profesionales
    const keywords = ['profesional', 'asesoria', 'asesoría', 'legal', 'consultoria', 'consultoría',
        'notario', 'abogado', 'gestor', 'gestoria', 'gestoría', 'arquitecto', 'ingeniero',
        'diseñador', 'programador', 'freelance'];

    const keywordPattern = keywords.join('|');

    const suspects = await sql`
        SELECT id, proveedor, descripcion, base_imponible, total, categoria, fecha_compra
        FROM purchases_180
        WHERE empresa_id = ${empresaId}
        AND activo = true
        AND fecha_compra BETWEEN ${startDate} AND ${endDate}
        AND (COALESCE(retencion_importe, 0) = 0)
        AND (
            LOWER(COALESCE(categoria, '')) ~ ${keywordPattern}
            OR LOWER(COALESCE(proveedor, '')) ~ ${keywordPattern}
            OR LOWER(COALESCE(descripcion, '')) ~ ${keywordPattern}
        )
    `;

    // Excluir proveedores que son sociedades (S.L., S.A., etc.) — no necesitan retención IRPF
    const sociedadRegex = /\b(S\.?L\.?U?\.?|S\.?A\.?|S\.?C\.?|S\.?COOP\.?|SOCIEDAD|CORPORACION|CORP\.?)\b/i;
    // Excluir pagos a Seguridad Social, TGSS, cuotas de autónomo, hacienda, etc.
    const ssExcludeRegex = /\b(TGSS|SEGURIDAD\s*SOCIAL|TESORERIA\s*GENERAL|CUOTA\s*AUTONOMO|RECIBO\s*(DE\s*)?(EL\s*)?AUTONOMO|RETA\b|HACIENDA|AEAT|AGENCIA\s*TRIBUTARIA)\b/i;
    const realSuspects = suspects.filter(s => {
        if (s.proveedor && sociedadRegex.test(s.proveedor)) return false;
        // Excluir pagos a organismos públicos (SS, Hacienda)
        const textoCompleto = `${s.proveedor || ''} ${s.descripcion || ''} ${s.categoria || ''}`;
        if (ssExcludeRegex.test(textoCompleto)) return false;
        return true;
    });

    if (realSuspects.length > 0) {
        return {
            triggered: true,
            alert_type: 'missing_retentions',
            severity: realSuspects.length > 3 ? 'warning' : 'info',
            current_value: realSuspects.length,
            threshold: 0,
            message: `${realSuspects.length} gasto(s) de servicios profesionales sin retención IRPF`,
            recommendation: 'Las facturas de profesionales autónomos (personas físicas) deben incluir retención IRPF (normalmente 15%). Las sociedades (S.L., S.A.) no requieren retención.',
            details: realSuspects.map(s => ({
                id: s.id,
                proveedor: s.proveedor,
                descripcion: s.descripcion,
                total: parseFloat(s.total),
                categoria: s.categoria,
                fecha: s.fecha_compra,
            })),
        };
    }

    return { triggered: false };
}

// ──────────────────────────────────────────────
// CHECK 7: Gastos de vehículo excesivos
// ──────────────────────────────────────────────

async function checkVehicleExpenseDeduction(empresaId, startDate, endDate, config) {
    // Sectores de transporte: no aplica esta alerta
    if (['transporte'].includes(config.sector)) return { triggered: false };

    const vehicleKeywords = 'vehiculo|vehículo|coche|gasolina|combustible|gasoil|diesel|parking|peaje|taller|reparacion|reparación|seguro auto|seguro coche|leasing auto|renting';

    const [vehicleTotal] = await sql`
        SELECT COALESCE(SUM(base_imponible), 0) as total
        FROM purchases_180
        WHERE empresa_id = ${empresaId} AND activo = true
        AND fecha_compra BETWEEN ${startDate} AND ${endDate}
        AND (
            LOWER(COALESCE(categoria, '')) ~ ${vehicleKeywords}
            OR LOWER(COALESCE(descripcion, '')) ~ ${vehicleKeywords}
        )
    `;
    const [totalGastos] = await sql`
        SELECT COALESCE(SUM(base_imponible), 0) as total
        FROM purchases_180
        WHERE empresa_id = ${empresaId} AND activo = true
        AND fecha_compra BETWEEN ${startDate} AND ${endDate}
    `;

    const vehicle = parseFloat(vehicleTotal.total);
    const total = parseFloat(totalGastos.total);

    if (total <= 0 || vehicle <= 0) return { triggered: false };

    const ratio = vehicle / total;

    if (ratio > 0.50) {
        return {
            triggered: true,
            alert_type: 'vehicle_expenses',
            severity: 'warning',
            current_value: ratio,
            threshold: 0.50,
            message: `Los gastos de vehículo representan el ${(ratio * 100).toFixed(0)}% del total de gastos`,
            recommendation: 'Hacienda rechaza la deducción del 100% de gastos de vehículo salvo en sectores de transporte. Solo puedes deducir el 50% del IVA y en IRPF se rechaza completamente.',
        };
    }

    if (ratio > 0.30) {
        return {
            triggered: true,
            alert_type: 'vehicle_expenses',
            severity: 'info',
            current_value: ratio,
            threshold: 0.30,
            message: `Los gastos de vehículo suponen el ${(ratio * 100).toFixed(0)}% de tus gastos totales`,
            recommendation: 'Asegúrate de poder justificar el uso profesional del vehículo. Hacienda es muy estricta con estas deducciones.',
        };
    }

    return { triggered: false };
}

// ──────────────────────────────────────────────
// Risk Score Computation
// ──────────────────────────────────────────────

function computeRiskScore(alerts) {
    if (!alerts || alerts.length === 0) return 0;

    const weights = { info: 8, warning: 20, critical: 35 };
    let score = 0;

    for (const alert of alerts) {
        score += weights[alert.severity] || 0;
    }

    return Math.min(100, score);
}

// ──────────────────────────────────────────────
// Simplified check runner on modified data (for simulator)
// ──────────────────────────────────────────────

function runChecksOnSimulatedData(modelData, config) {
    const alerts = [];
    const r1 = checkGastosIngresosRatio(modelData, config);
    if (r1.triggered) alerts.push(r1);

    const r3 = checkIvaRatio(modelData, config);
    if (r3.triggered) alerts.push(r3);

    return alerts;
}

// ──────────────────────────────────────────────
// MAIN: Analyze Current Quarter
// ──────────────────────────────────────────────

export async function analyzeCurrentQuarter(empresaId, year, quarter) {
    const config = await getAlertConfig(empresaId);
    const modelData = await calcularDatosModelos(empresaId, year, quarter);
    const { startDate, endDate } = getTrimestreDates(year, quarter);

    const alerts = [];

    // Run all 7 checks
    const checks = [
        checkGastosIngresosRatio(modelData, config),
        await checkConsecutiveLosses(empresaId, year, quarter),
        checkIvaRatio(modelData, config),
        await checkPatternChanges(empresaId, year, quarter),
        await checkCashPayments(empresaId, startDate, endDate, config),
        await checkMissingRetentions(empresaId, startDate, endDate),
        await checkVehicleExpenseDeduction(empresaId, startDate, endDate, config),
    ];

    for (const result of checks) {
        if (Array.isArray(result)) {
            alerts.push(...result.filter(r => r.triggered));
        } else if (result && result.triggered) {
            alerts.push(result);
        }
    }

    const riskScore = computeRiskScore(alerts);

    const ingresos = modelData.modelo130.ingresos || 0;
    const gastos = modelData.modelo130.gastos || 0;

    const ratios = {
        gastos_ingresos: ingresos > 0 ? gastos / ingresos : 0,
        iva_deducible_devengado: modelData.modelo303.devengado.cuota > 0
            ? modelData.modelo303.deducible.cuota / modelData.modelo303.devengado.cuota
            : 0,
        rendimiento_neto: modelData.modelo130.rendimiento,
        resultado_iva: modelData.modelo303.resultado,
        ingresos_acumulados: ingresos,
        gastos_acumulados: gastos,
    };

    return { alerts, riskScore, ratios, modelData, config };
}

// ──────────────────────────────────────────────
// SIMULATOR: Impact of a hypothetical operation
// ──────────────────────────────────────────────

export async function simulateImpact(empresaId, year, quarter, operation) {
    const before = await analyzeCurrentQuarter(empresaId, year, quarter);

    // Clone model data
    const simModelData = JSON.parse(JSON.stringify(before.modelData));

    const base = parseFloat(operation.base_imponible) || 0;
    const ivaPct = parseFloat(operation.iva_pct) || 21;
    const ivaImporte = parseFloat(operation.iva_importe) || (base * ivaPct / 100);

    if (operation.type === 'gasto') {
        simModelData.modelo303.deducible.base += base;
        simModelData.modelo303.deducible.cuota += ivaImporte;
        simModelData.modelo303.resultado =
            simModelData.modelo303.devengado.cuota - simModelData.modelo303.deducible.cuota;

        simModelData.modelo130.gastos += base;
        simModelData.modelo130.rendimiento =
            simModelData.modelo130.ingresos - simModelData.modelo130.gastos;
        simModelData.modelo130.pago_fraccionado =
            simModelData.modelo130.rendimiento > 0 ? simModelData.modelo130.rendimiento * 0.20 : 0;
        simModelData.modelo130.a_ingresar = simModelData.modelo130.pago_fraccionado;
    } else if (operation.type === 'factura') {
        simModelData.modelo303.devengado.base += base;
        simModelData.modelo303.devengado.cuota += ivaImporte;
        simModelData.modelo303.resultado =
            simModelData.modelo303.devengado.cuota - simModelData.modelo303.deducible.cuota;

        simModelData.modelo130.ingresos += base;
        simModelData.modelo130.rendimiento =
            simModelData.modelo130.ingresos - simModelData.modelo130.gastos;
        simModelData.modelo130.pago_fraccionado =
            simModelData.modelo130.rendimiento > 0 ? simModelData.modelo130.rendimiento * 0.20 : 0;
        simModelData.modelo130.a_ingresar = simModelData.modelo130.pago_fraccionado;
    }

    // Run simplified checks on simulated data
    const afterAlerts = runChecksOnSimulatedData(simModelData, before.config);
    const afterRiskScore = computeRiskScore(afterAlerts);

    // Compute "safe threshold" - how much to invoice to stay safe
    let safeInvoicingThreshold = null;
    if (operation.type === 'gasto') {
        const totalGastosAfter = simModelData.modelo130.gastos;
        const safeRatio = before.config.thresholds.gastos_ingresos_ratio_max;
        if (safeRatio > 0) {
            const neededIngresos = totalGastosAfter / safeRatio;
            const currentIngresos = simModelData.modelo130.ingresos;
            safeInvoicingThreshold = Math.max(0, neededIngresos - currentIngresos);
        }
    }

    const afterRatios = {
        gastos_ingresos: simModelData.modelo130.ingresos > 0
            ? simModelData.modelo130.gastos / simModelData.modelo130.ingresos : 0,
        iva_deducible_devengado: simModelData.modelo303.devengado.cuota > 0
            ? simModelData.modelo303.deducible.cuota / simModelData.modelo303.devengado.cuota : 0,
        rendimiento_neto: simModelData.modelo130.rendimiento,
        resultado_iva: simModelData.modelo303.resultado,
    };

    return {
        before: {
            ratios: before.ratios,
            riskScore: before.riskScore,
            alertCount: before.alerts.length,
        },
        after: {
            ratios: afterRatios,
            riskScore: afterRiskScore,
            alertCount: afterAlerts.length,
            alerts: afterAlerts,
        },
        delta: {
            riskScore: afterRiskScore - before.riskScore,
            gastos_ingresos_ratio: afterRatios.gastos_ingresos - before.ratios.gastos_ingresos,
            rendimiento_neto: afterRatios.rendimiento_neto - before.ratios.rendimiento_neto,
            resultado_iva: afterRatios.resultado_iva - before.ratios.resultado_iva,
        },
        modeloImpact: {
            modelo303_resultado: simModelData.modelo303.resultado,
            modelo130_a_ingresar: simModelData.modelo130.a_ingresar,
        },
        safeInvoicingThreshold,
    };
}

// ──────────────────────────────────────────────
// CRON: Scan company and generate notifications
// ──────────────────────────────────────────────

export async function runAlertScanForCompany(empresaId) {
    const config = await getAlertConfig(empresaId);
    if (!config.enabled) return;

    const now = new Date();
    const year = now.getFullYear();
    const quarter = Math.ceil((now.getMonth() + 1) / 3);

    const { alerts } = await analyzeCurrentQuarter(empresaId, year, quarter);

    for (const alert of alerts) {
        // Deduplicate: check for existing unread alert of same type and period
        const [existing] = await sql`
            SELECT id FROM notificaciones_180
            WHERE empresa_id = ${empresaId}
            AND tipo = 'fiscal_alert'
            AND leida = false
            AND metadata->>'alert_type' = ${alert.alert_type}
            AND metadata->>'year' = ${String(year)}
            AND metadata->>'trimestre' = ${String(quarter)}
            LIMIT 1
        `;

        if (existing) continue;

        await crearNotificacionSistema({
            empresaId,
            tipo: 'fiscal_alert',
            titulo: `Alerta Fiscal: ${alert.message.substring(0, 80)}`,
            mensaje: alert.recommendation,
            accionUrl: '/admin/fiscal?tab=alertas',
            accionLabel: 'Ver detalles',
            metadata: {
                alert_type: alert.alert_type,
                severity: alert.severity,
                year: String(year),
                trimestre: String(quarter),
                current_value: alert.current_value,
                threshold: alert.threshold,
            },
        });
    }

    // Update last scan timestamp
    await sql`
        UPDATE empresa_config_180
        SET fiscal_alert_config = COALESCE(fiscal_alert_config, '{}'::jsonb) ||
            ${JSON.stringify({ last_scan_at: new Date().toISOString() })}::jsonb
        WHERE empresa_id = ${empresaId}
    `;
}

export async function runAlertScanAllCompanies() {
    const companies = await sql`
        SELECT empresa_id
        FROM empresa_config_180
        WHERE (fiscal_alert_config->>'enabled')::boolean IS NOT FALSE
    `;

    for (const { empresa_id } of companies) {
        try {
            await runAlertScanForCompany(empresa_id);
        } catch (err) {
            console.error(`[FiscalAlerts] Error scanning company ${empresa_id}:`, err.message);
        }
    }
}
