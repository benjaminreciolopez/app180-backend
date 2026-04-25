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

// ──────────────────────────────────────────────
// Catálogo de Epígrafes IAE por sector
// ──────────────────────────────────────────────

export const EPIGRAFES_IAE = {
    servicios_profesionales: [
        { codigo: "731", descripcion: "Abogados" },
        { codigo: "732", descripcion: "Procuradores" },
        { codigo: "733", descripcion: "Graduados sociales" },
        { codigo: "741", descripcion: "Economistas" },
        { codigo: "742", descripcion: "Asesores fiscales y contables" },
        { codigo: "743", descripcion: "Auditores de cuentas" },
        { codigo: "751", descripcion: "Agentes de la propiedad inmobiliaria" },
        { codigo: "761", descripcion: "Pintores, escultores, ceramistas y artesanos" },
        { codigo: "762", descripcion: "Restauradores de obras de arte" },
        { codigo: "764", descripcion: "Escritores y guionistas" },
        { codigo: "769", descripcion: "Otros profesionales relacionados con actividades artísticas" },
        { codigo: "771", descripcion: "Profesionales de la publicidad y relaciones públicas" },
        { codigo: "774", descripcion: "Traductores e intérpretes" },
        { codigo: "776", descripcion: "Profesionales de la gestión administrativa" },
        { codigo: "841", descripcion: "Notarios" },
        { codigo: "842", descripcion: "Registradores de la propiedad y mercantiles" },
        { codigo: "843", descripcion: "Corredores de comercio" },
        { codigo: "844", descripcion: "Diplomáticos y cónsules acreditados en España" },
        { codigo: "849", descripcion: "Otros profesionales del derecho" },
        { codigo: "899", descripcion: "Otros profesionales n.c.o.p." },
    ],
    comercio_minorista: [
        { codigo: "641", descripcion: "Comercio al por menor de frutas, verduras y hortalizas" },
        { codigo: "642", descripcion: "Comercio al por menor de carnes y despojos" },
        { codigo: "643", descripcion: "Comercio al por menor de pescados" },
        { codigo: "644", descripcion: "Comercio al por menor de pan, pastelería y confitería" },
        { codigo: "645", descripcion: "Comercio al por menor de vinos y bebidas" },
        { codigo: "646", descripcion: "Comercio al por menor de tabaco" },
        { codigo: "647", descripcion: "Comercio al por menor de productos alimenticios y bebidas" },
        { codigo: "651", descripcion: "Comercio al por menor de productos textiles" },
        { codigo: "652", descripcion: "Comercio al por menor de prendas de vestir y tocado" },
        { codigo: "653", descripcion: "Comercio al por menor de calzado, artículos de piel" },
        { codigo: "654", descripcion: "Comercio al por menor de artículos de droguería y limpieza" },
        { codigo: "656", descripcion: "Comercio al por menor de bienes usados" },
        { codigo: "659", descripcion: "Otro comercio al por menor" },
        { codigo: "661", descripcion: "Comercio mixto o integrado al por menor" },
        { codigo: "662", descripcion: "Comercio mixto o integrado al por menor" },
        { codigo: "663", descripcion: "Comercio al por menor fuera de establecimiento" },
        { codigo: "664", descripcion: "Comercio en máquinas automáticas" },
        { codigo: "665", descripcion: "Comercio al por menor por correo o catálogo" },
    ],
    hosteleria: [
        { codigo: "671", descripcion: "Servicios en restaurantes" },
        { codigo: "672", descripcion: "Servicios en cafeterías" },
        { codigo: "673", descripcion: "Servicios en cafés y bares" },
        { codigo: "674", descripcion: "Servicios especiales de restauración" },
        { codigo: "675", descripcion: "Servicios en quioscos, cajones, barracas y otros" },
        { codigo: "676", descripcion: "Servicios en chocolaterías, heladerías y horchaterías" },
        { codigo: "677", descripcion: "Servicios prestados por establecimientos de hospedaje" },
        { codigo: "681", descripcion: "Servicio de hospedaje en hoteles y moteles" },
        { codigo: "682", descripcion: "Servicio de hospedaje en hostales y pensiones" },
        { codigo: "683", descripcion: "Servicio de hospedaje en fondas y casas de huéspedes" },
        { codigo: "684", descripcion: "Servicio de hospedaje en hoteles-apartamento" },
        { codigo: "685", descripcion: "Alojamientos turísticos extrahoteleros" },
    ],
    construccion: [
        { codigo: "501", descripcion: "Edificación y obra civil" },
        { codigo: "502", descripcion: "Albañilería y pequeños trabajos de construcción" },
        { codigo: "503", descripcion: "Preparación de obras" },
        { codigo: "504", descripcion: "Instalaciones y montajes" },
        { codigo: "505", descripcion: "Acabado de obras" },
        { codigo: "506", descripcion: "Instalación de fontanería y climatización" },
        { codigo: "507", descripcion: "Instalaciones eléctricas" },
        { codigo: "508", descripcion: "Instalación de rótulos, aislamiento y otros" },
        { codigo: "722", descripcion: "Arquitectos" },
        { codigo: "723", descripcion: "Arquitectos técnicos y aparejadores" },
        { codigo: "724", descripcion: "Ingenieros" },
        { codigo: "725", descripcion: "Ingenieros técnicos" },
    ],
    transporte: [
        { codigo: "721", descripcion: "Transporte urbano colectivo" },
        { codigo: "722.1", descripcion: "Transporte por autotaxis" },
        { codigo: "722.2", descripcion: "Transporte por auto-turismos con conductor" },
        { codigo: "731.1", descripcion: "Transporte de mercancías por carretera" },
        { codigo: "731.2", descripcion: "Servicios de mudanzas" },
        { codigo: "741", descripcion: "Transporte marítimo" },
        { codigo: "742", descripcion: "Transporte de pasajeros fluvial" },
        { codigo: "751", descripcion: "Transporte aéreo regular" },
        { codigo: "755", descripcion: "Actividades anexas al transporte" },
        { codigo: "756", descripcion: "Agencias de viajes" },
        { codigo: "757", descripcion: "Servicios de almacenamiento y depósito" },
    ],
    tecnologia: [
        { codigo: "831", descripcion: "Servicios de consultoría en informática" },
        { codigo: "832", descripcion: "Servicios de programación" },
        { codigo: "833", descripcion: "Servicios de procesamiento de datos" },
        { codigo: "834", descripcion: "Servicios de bases de datos" },
        { codigo: "835", descripcion: "Servicios de mantenimiento y reparación de equipos informáticos" },
        { codigo: "836", descripcion: "Otros servicios informáticos" },
        { codigo: "761.1", descripcion: "Telecomunicaciones" },
        { codigo: "769.9", descripcion: "Otros servicios de telecomunicaciones" },
        { codigo: "844.1", descripcion: "Servicios técnicos de ingeniería (IT)" },
        { codigo: "849.7", descripcion: "Profesionales en protección de datos" },
    ],
    sanitario: [
        { codigo: "711", descripcion: "Médicos de medicina general" },
        { codigo: "712", descripcion: "Médicos especialistas (excepto odontólogos)" },
        { codigo: "713", descripcion: "Odontólogos y estomatólogos" },
        { codigo: "714", descripcion: "Farmacéuticos" },
        { codigo: "715", descripcion: "Veterinarios" },
        { codigo: "716", descripcion: "Psicólogos" },
        { codigo: "721", descripcion: "ATS/DUE, fisioterapeutas" },
        { codigo: "722.3", descripcion: "Ópticos y optometristas" },
        { codigo: "723.1", descripcion: "Protésicos dentales" },
        { codigo: "724.1", descripcion: "Podólogos" },
        { codigo: "725.1", descripcion: "Logopedas" },
        { codigo: "726", descripcion: "Dietistas y nutricionistas" },
    ],
    formacion: [
        { codigo: "821", descripcion: "Enseñanza de formación y perfeccionamiento profesional" },
        { codigo: "822", descripcion: "Enseñanza de educación infantil y primaria" },
        { codigo: "823", descripcion: "Enseñanza de educación superior" },
        { codigo: "824", descripcion: "Enseñanza de formación y perfeccionamiento" },
        { codigo: "825", descripcion: "Autoescuelas" },
        { codigo: "826", descripcion: "Academias de idiomas" },
        { codigo: "827", descripcion: "Academias de baile, danza, música y artes" },
        { codigo: "831.1", descripcion: "Profesores particulares" },
        { codigo: "833.1", descripcion: "Investigación científica y técnica" },
    ],
};

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

    let raw = config?.fiscal_alert_config;
    let stored = {};
    if (raw) {
        if (typeof raw === 'string') {
            try { stored = JSON.parse(raw); } catch { stored = {}; }
        } else if (Array.isArray(raw)) {
            // Resilencia: filas históricas donde el UPDATE rompió la columna
            // a un array (jsonb `||` con array hace append, no merge). Tomar
            // el primer objeto y descartar los strings/last_scan_at sueltos.
            const primero = raw.find((x) => x && typeof x === 'object' && !Array.isArray(x));
            stored = primero || {};
        } else if (typeof raw === 'object') {
            stored = raw;
        }
    }
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

async function checkPatternChanges(empresaId, year, quarter, config) {
    const alerts = [];
    const threshold = 40; // 40% cambio brusco
    // Sólo considerar el spike "sospechoso" si el ratio absoluto
    // gastos/ingresos del trimestre actual ya está cerca del umbral del sector
    // (>=70% del máximo). Crecimientos relativos sobre bases pequeñas con
    // ingresos muy superiores no son una señal real para Hacienda.
    const ratioThreshold = config?.thresholds?.gastos_ingresos_ratio_max || 0.7;
    const ratioGuard = ratioThreshold * 0.7;

    // Comparar con trimestre anterior
    const prev = prevQuarter(year, quarter);
    let prevData;
    try {
        prevData = await calcularDatosModelos(empresaId, prev.year, prev.quarter);
    } catch {
        return alerts;
    }

    const currentData = await calcularDatosModelos(empresaId, year, quarter);

    // Calcular días transcurridos del trimestre actual
    const { startDate: curStart, endDate: curEnd } = getTrimestreDates(year, quarter);
    const { startDate: prevStart, endDate: prevEnd } = getTrimestreDates(prev.year, prev.quarter);

    const hoy = new Date();
    const inicioTrimestre = new Date(curStart);
    const finTrimestre = new Date(curEnd);
    const diasTotalesTrimestre = Math.ceil((finTrimestre - inicioTrimestre) / (1000 * 60 * 60 * 24)) + 1;
    const diasTranscurridos = Math.ceil((hoy - inicioTrimestre) / (1000 * 60 * 60 * 24));

    // No comparar si han pasado menos de 15 días del trimestre
    if (diasTranscurridos < 15) {
        return alerts;
    }

    // Para comparación justa, solo usar los mismos días del trimestre anterior
    const prevStartDate = new Date(prevStart);
    const prevEndEquivalente = new Date(prevStartDate);
    prevEndEquivalente.setDate(prevEndEquivalente.getDate() + diasTranscurridos - 1);
    const prevEndProporcional = prevEndEquivalente.toISOString().split('T')[0];

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
        AND fecha BETWEEN ${prevStart} AND ${prevEndProporcional}
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
        AND fecha_compra BETWEEN ${prevStart} AND ${prevEndProporcional}
    `;

    const curV = parseFloat(curVentas.total);
    const prevV = parseFloat(prevVentas.total);
    const curG = parseFloat(curGastos.total);
    const prevG = parseFloat(prevGastos.total);

    const diasInfo = ` (comparando primeros ${diasTranscurridos} días de cada trimestre)`;

    // Spike de gastos: sólo es señal real si el ratio absoluto gastos/ingresos
    // ya está en zona de riesgo. Con ingresos varias veces superiores a los
    // gastos, un crecimiento relativo no representa un patrón sospechoso para
    // Hacienda — es simple actividad económica.
    if (prevG > 0 && curV > 0) {
        const gastoChange = ((curG - prevG) / prevG) * 100;
        const ratioActual = curG / curV;
        if (gastoChange > threshold && ratioActual >= ratioGuard) {
            alerts.push({
                triggered: true,
                alert_type: 'gasto_spike',
                severity: gastoChange > threshold * 2 ? 'critical' : 'warning',
                current_value: gastoChange,
                threshold,
                message: `Los gastos han aumentado un ${gastoChange.toFixed(0)}% respecto al trimestre anterior y el ratio gastos/ingresos (${(ratioActual * 100).toFixed(0)}%) se acerca al máximo del sector (${(ratioThreshold * 100).toFixed(0)}%)` + diasInfo,
                recommendation: 'Un aumento brusco de gastos cuando el ratio gastos/ingresos ya es elevado genera alertas en los algoritmos de Hacienda.',
            });
        }
    }

    // Caída de ingresos: sólo es preocupante si va acompañada de gastos
    // que se mantienen o aumentan. Una caída con gastos también a la baja
    // es coherente con menor actividad (vacaciones, estacionalidad), no una
    // anomalía. Hacienda lo cruza con la evolución de gastos.
    if (prevV > 0) {
        const ventaChange = ((curV - prevV) / prevV) * 100;
        const gastoChange = prevG > 0 ? ((curG - prevG) / prevG) * 100 : 0;
        const gastosNoBajan = gastoChange > -20;
        if (ventaChange < -threshold && gastosNoBajan) {
            alerts.push({
                triggered: true,
                alert_type: 'ingreso_drop',
                severity: ventaChange < -threshold * 2 ? 'critical' : 'warning',
                current_value: ventaChange,
                threshold: -threshold,
                message: `Los ingresos han caído un ${Math.abs(ventaChange).toFixed(0)}% mientras los gastos no han bajado proporcionalmente` + diasInfo,
                recommendation: 'Una caída brusca de ingresos con gastos estables o crecientes puede indicar irregularidades para Hacienda.',
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
    // Solo buscar en proveedor y categoría, NO en descripción (nombres de productos contienen "profesional", "ingeniero", etc.)
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
        )
    `;

    // Excluir proveedores que son sociedades (S.L., S.A., S.à r.l., etc.) — no necesitan retención IRPF
    const sociedadRegex = /\b(S\.?L\.?U?\.?|S\.?A\.?|S\.?C\.?|S\.?COOP\.?|SOCIEDAD|CORPORACION|CORP\.?|S\.?[àa]\.?\s*r\.?\s*l\.?)\b/i;
    // Excluir pagos a Seguridad Social, TGSS, cuotas de autónomo, hacienda, etc.
    const ssExcludeRegex = /\b(TGSS|SEGURIDAD\s*SOCIAL|TESORERIA\s*GENERAL|CUOTA\s*AUTONOMO|RECIBO\s*(DE\s*)?(EL\s*)?AUTONOMO|RETA\b|HACIENDA|AEAT|AGENCIA\s*TRIBUTARIA)\b/i;
    // Categorías que son compras de material/producto, no servicios profesionales
    const materialCategories = /^(herramientas|material|suministros|equipamiento|mobiliario|informatica|electronica|papeleria|limpieza|ferreteria|repuestos|consumibles|maquinaria)$/i;
    const realSuspects = suspects.filter(s => {
        if (s.proveedor && sociedadRegex.test(s.proveedor)) return false;
        // Excluir pagos a organismos públicos (SS, Hacienda)
        const textoCompleto = `${s.proveedor || ''} ${s.descripcion || ''} ${s.categoria || ''}`;
        if (ssExcludeRegex.test(textoCompleto)) return false;
        // Excluir compras de material — la palabra "profesional" en el nombre de un producto no implica servicio profesional
        if (s.categoria && materialCategories.test(s.categoria.trim())) return false;
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
        await checkPatternChanges(empresaId, year, quarter, config),
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

    // Update last scan timestamp.
    // Importante: si la columna terminó como array por bugs históricos,
    // `jsonb || jsonb` haría append en vez de merge. Forzamos un objeto base
    // antes de mergear para mantener el shape canónico.
    await sql`
        UPDATE empresa_config_180
        SET fiscal_alert_config =
            CASE
                WHEN jsonb_typeof(COALESCE(fiscal_alert_config, '{}'::jsonb)) = 'object'
                    THEN COALESCE(fiscal_alert_config, '{}'::jsonb)
                        || ${JSON.stringify({ last_scan_at: new Date().toISOString() })}::jsonb
                ELSE
                    COALESCE(
                        (SELECT v FROM jsonb_array_elements(fiscal_alert_config) v
                          WHERE jsonb_typeof(v) = 'object' LIMIT 1),
                        '{}'::jsonb
                    ) || ${JSON.stringify({ last_scan_at: new Date().toISOString() })}::jsonb
            END
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
