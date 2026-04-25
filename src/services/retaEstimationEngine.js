/**
 * MOTOR DE ESTIMACION RETA - Base de Cotizacion para Autonomos
 *
 * Calcula la base de cotizacion optima segun rendimientos netos reales,
 * proyecta ingresos/gastos anuales, y determina riesgo de regularizacion.
 *
 * Sigue el patron de fiscalRulesEngine.js (cache en memoria, BD-driven).
 *
 * Uso:
 *   import { RetaEngine } from '../services/retaEstimationEngine.js';
 *   const estimacion = await RetaEngine.generateFullEstimation(empresaId, 2026);
 */

import { sql } from "../db.js";

// ============================================================
// CACHE EN MEMORIA (TTL 10 minutos)
// ============================================================
const CACHE_TTL_MS = 10 * 60 * 1000;
const tramosCache = new Map(); // Map<ejercicio, { data, timestamp }>

function isCacheValid(entry) {
    return entry && (Date.now() - entry.timestamp) < CACHE_TTL_MS;
}

// ============================================================
// VENTANAS DE CAMBIO DE BASE (6 por ano)
// ============================================================
const VENTANAS_CAMBIO = [
    { mes_efectivo: 3,  mes_limite: 2,  label: "1 de marzo" },
    { mes_efectivo: 5,  mes_limite: 4,  label: "1 de mayo" },
    { mes_efectivo: 7,  mes_limite: 6,  label: "1 de julio" },
    { mes_efectivo: 9,  mes_limite: 8,  label: "1 de septiembre" },
    { mes_efectivo: 11, mes_limite: 10, label: "1 de noviembre" },
    { mes_efectivo: 1,  mes_limite: 12, label: "1 de enero (sig.)" },
];

// ============================================================
// API PUBLICA
// ============================================================
export const RetaEngine = {

    /**
     * Obtener tramos RETA para un ejercicio (con cache)
     */
    async getTramosForYear(ejercicio) {
        const cached = tramosCache.get(ejercicio);
        if (isCacheValid(cached)) return cached.data;

        const rows = await sql`
            SELECT tramo_num, rend_neto_mensual_min, rend_neto_mensual_max,
                   base_min, base_max, tipo_cotizacion
            FROM reta_tramos_180
            WHERE ejercicio = ${ejercicio} AND activo = true
            ORDER BY tramo_num
        `;

        const tramos = rows.map(r => ({
            tramo: r.tramo_num,
            rendMin: parseFloat(r.rend_neto_mensual_min),
            rendMax: r.rend_neto_mensual_max ? parseFloat(r.rend_neto_mensual_max) : Infinity,
            baseMin: parseFloat(r.base_min),
            baseMax: parseFloat(r.base_max),
            tipoCotizacion: parseFloat(r.tipo_cotizacion),
        }));

        // Si no hay tramos para ese ano, intentar con el mas reciente
        if (tramos.length === 0) {
            const [latest] = await sql`
                SELECT DISTINCT ejercicio FROM reta_tramos_180
                WHERE ejercicio <= ${ejercicio} AND activo = true
                ORDER BY ejercicio DESC LIMIT 1
            `;
            if (latest && latest.ejercicio !== ejercicio) {
                return this.getTramosForYear(latest.ejercicio);
            }
        }

        tramosCache.set(ejercicio, { data: tramos, timestamp: Date.now() });
        return tramos;
    },

    /**
     * Obtener perfil RETA de un autonomo (crea uno por defecto si no existe)
     */
    async getPerfil(empresaId, ejercicio, titularId = null) {
        const [perfil] = titularId
            ? await sql`
                SELECT * FROM reta_autonomo_perfil_180
                WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio} AND titular_id = ${titularId}
            `
            : await sql`
                SELECT * FROM reta_autonomo_perfil_180
                WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio} AND titular_id IS NULL
            `;

        if (perfil) return perfil;

        // Auto-crear perfil por defecto (con o sin titular)
        const [nuevo] = await sql`
            INSERT INTO reta_autonomo_perfil_180 (empresa_id, ejercicio, titular_id)
            VALUES (${empresaId}, ${ejercicio}, ${titularId})
            ON CONFLICT DO NOTHING
            RETURNING *
        `;

        if (nuevo) return nuevo;

        const [reload] = titularId
            ? await sql`
                SELECT * FROM reta_autonomo_perfil_180
                WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio} AND titular_id = ${titularId}
            `
            : await sql`
                SELECT * FROM reta_autonomo_perfil_180
                WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio} AND titular_id IS NULL
            `;
        return reload;
    },

    /**
     * Obtener rendimiento neto YTD desde datos reales (facturas + gastos + nominas)
     */
    async getRendimientoNetoYTD(empresaId, ejercicio, hastaFecha = null) {
        const startDate = `${ejercicio}-01-01`;
        const endDate = hastaFecha || new Date().toISOString().slice(0, 10);

        // Ingresos: facturas validadas/enviadas/cobradas
        const [ingresos] = await sql`
            SELECT COALESCE(SUM(subtotal), 0) as total
            FROM factura_180
            WHERE empresa_id = ${empresaId}
            AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND fecha BETWEEN ${startDate} AND ${endDate}
            AND (es_test IS NOT TRUE)
        `;

        // Gastos: compras activas
        const [gastos] = await sql`
            SELECT COALESCE(SUM(base_imponible), 0) as total
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND fecha_compra BETWEEN ${startDate} AND ${endDate}
        `;

        // Nominas: coste empleados (bruto + SS empresa)
        const mesActual = new Date().getMonth() + 1;
        const [nominas] = await sql`
            SELECT COALESCE(SUM(bruto), 0) + COALESCE(SUM(seguridad_social_empresa), 0) as total
            FROM nominas_180
            WHERE empresa_id = ${empresaId}
            AND anio = ${ejercicio}
            AND mes <= ${mesActual}
        `;

        // Ingresos mensuales desglosados (para proyeccion estacional)
        const ingresosMensuales = await sql`
            SELECT EXTRACT(MONTH FROM fecha)::integer as mes,
                   COALESCE(SUM(subtotal), 0) as total
            FROM factura_180
            WHERE empresa_id = ${empresaId}
            AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND fecha BETWEEN ${startDate} AND ${endDate}
            AND (es_test IS NOT TRUE)
            GROUP BY EXTRACT(MONTH FROM fecha)
            ORDER BY mes
        `;

        const gastosMensuales = await sql`
            SELECT EXTRACT(MONTH FROM fecha_compra)::integer as mes,
                   COALESCE(SUM(base_imponible), 0) as total
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND fecha_compra BETWEEN ${startDate} AND ${endDate}
            GROUP BY EXTRACT(MONTH FROM fecha_compra)
            ORDER BY mes
        `;

        const ingresosYTD = parseFloat(ingresos.total);
        const gastosYTD = parseFloat(gastos.total);
        const nominasYTD = parseFloat(nominas.total);

        return {
            ingresosYTD,
            gastosYTD,
            nominasYTD,
            rendimientoNetoYTD: ingresosYTD - gastosYTD - nominasYTD,
            ingresosMensuales: ingresosMensuales.map(r => ({ mes: r.mes, total: parseFloat(r.total) })),
            gastosMensuales: gastosMensuales.map(r => ({ mes: r.mes, total: parseFloat(r.total) })),
            mesesConDatos: ingresosMensuales.length,
        };
    },

    /**
     * Obtener datos del ejercicio anterior (para proyeccion estacional)
     */
    async getDatosEjercicioAnterior(empresaId, ejercicio) {
        const anoAnterior = ejercicio - 1;
        const [ingresos] = await sql`
            SELECT COALESCE(SUM(subtotal), 0) as total
            FROM factura_180
            WHERE empresa_id = ${empresaId}
            AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND EXTRACT(YEAR FROM fecha) = ${anoAnterior}
            AND (es_test IS NOT TRUE)
        `;
        const [gastos] = await sql`
            SELECT COALESCE(SUM(base_imponible), 0) as total
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND EXTRACT(YEAR FROM fecha_compra) = ${anoAnterior}
        `;

        const ingresosMensuales = await sql`
            SELECT EXTRACT(MONTH FROM fecha)::integer as mes,
                   COALESCE(SUM(subtotal), 0) as total
            FROM factura_180
            WHERE empresa_id = ${empresaId}
            AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND EXTRACT(YEAR FROM fecha) = ${anoAnterior}
            AND (es_test IS NOT TRUE)
            GROUP BY EXTRACT(MONTH FROM fecha)
            ORDER BY mes
        `;

        const totalAnual = parseFloat(ingresos.total);

        return {
            ingresosAnual: totalAnual,
            gastosAnual: parseFloat(gastos.total),
            ingresosMensuales: ingresosMensuales.map(r => ({ mes: r.mes, total: parseFloat(r.total) })),
            hayDatos: totalAnual > 0,
            // Pesos mensuales (que % del total anual representa cada mes)
            pesosMensuales: totalAnual > 0
                ? Object.fromEntries(ingresosMensuales.map(r => [r.mes, parseFloat(r.total) / totalAnual]))
                : null,
        };
    },

    /**
     * Obtener eventos RETA activos para un autonomo
     */
    async getEventos(empresaId, ejercicio, titularId = null) {
        if (titularId) {
            return await sql`
                SELECT * FROM reta_eventos_180
                WHERE empresa_id = ${empresaId}
                AND ejercicio = ${ejercicio}
                AND (titular_id = ${titularId} OR titular_id IS NULL)
                AND activo = true
                ORDER BY fecha_inicio
            `;
        }
        return await sql`
            SELECT * FROM reta_eventos_180
            WHERE empresa_id = ${empresaId}
            AND ejercicio = ${ejercicio}
            AND activo = true
            ORDER BY fecha_inicio
        `;
    },

    // ============================================================
    // METODOS DE PROYECCION
    // ============================================================

    /**
     * Proyeccion lineal: (YTD / meses transcurridos) * 12
     */
    projectLinear(datosYTD, mesActual) {
        if (mesActual <= 0) return { ingresos: 0, gastos: 0, confianza: 0 };

        // Pro-ratear mes actual por dia
        const hoy = new Date();
        const diasMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
        const fraccionMesActual = hoy.getDate() / diasMes;
        const mesesEfectivos = (mesActual - 1) + fraccionMesActual;

        if (mesesEfectivos <= 0) return { ingresos: 0, gastos: 0, confianza: 0 };

        const ingresosMensual = datosYTD.ingresosYTD / mesesEfectivos;
        const gastosMensual = (datosYTD.gastosYTD + datosYTD.nominasYTD) / mesesEfectivos;

        return {
            ingresos: Math.round(ingresosMensual * 12 * 100) / 100,
            gastos: Math.round(gastosMensual * 12 * 100) / 100,
            confianza: Math.min(Math.round(mesesEfectivos * 8.5), 90),
        };
    },

    /**
     * Proyeccion estacional: pondera con datos del ano anterior
     */
    projectSeasonal(datosYTD, datosAnterior, mesActual) {
        if (!datosAnterior.hayDatos || !datosAnterior.pesosMensuales) {
            return this.projectLinear(datosYTD, mesActual);
        }

        const pesos = datosAnterior.pesosMensuales;

        // Peso acumulado de los meses transcurridos
        let pesoTranscurrido = 0;
        for (let m = 1; m <= mesActual; m++) {
            pesoTranscurrido += (pesos[m] || 1 / 12);
        }

        if (pesoTranscurrido <= 0) return this.projectLinear(datosYTD, mesActual);

        // Escalar: si el YTD = X y esos meses representaban el Y% del total anual anterior,
        // entonces el total anual seria X / Y
        const ingresosProyectados = datosYTD.ingresosYTD / pesoTranscurrido;

        // Para gastos usamos proporcion lineal (gastos suelen ser mas estables)
        const gastosMensual = mesActual > 0
            ? (datosYTD.gastosYTD + datosYTD.nominasYTD) / mesActual
            : 0;

        return {
            ingresos: Math.round(ingresosProyectados * 100) / 100,
            gastos: Math.round(gastosMensual * 12 * 100) / 100,
            confianza: Math.min(75 + Math.round(mesActual * 2), 92),
        };
    },

    /**
     * Media ponderada: meses recientes pesan mas
     */
    projectWeightedAvg(datosYTD, mesActual) {
        const { ingresosMensuales, gastosMensuales } = datosYTD;
        if (ingresosMensuales.length === 0) return { ingresos: 0, gastos: 0, confianza: 0 };

        // Pesos: mes mas reciente pesa mas
        const weights = [0.4, 0.3, 0.2, 0.1];
        const sorted = [...ingresosMensuales].sort((a, b) => b.mes - a.mes);
        const gastosSorted = [...gastosMensuales].sort((a, b) => b.mes - a.mes);

        let sumIngresos = 0, sumGastos = 0, sumPesos = 0;
        for (let i = 0; i < Math.min(sorted.length, weights.length); i++) {
            sumIngresos += sorted[i].total * weights[i];
            sumPesos += weights[i];
        }
        for (let i = 0; i < Math.min(gastosSorted.length, weights.length); i++) {
            sumGastos += gastosSorted[i].total * weights[i];
        }

        const ingresoMensualPonderado = sumPesos > 0 ? sumIngresos / sumPesos : 0;
        const gastoMensualPonderado = sumPesos > 0 ? sumGastos / sumPesos : 0;

        // Anadir nominas prorrateadas
        const nominasMensual = mesActual > 0 ? datosYTD.nominasYTD / mesActual : 0;

        return {
            ingresos: Math.round(ingresoMensualPonderado * 12 * 100) / 100,
            gastos: Math.round((gastoMensualPonderado + nominasMensual) * 12 * 100) / 100,
            confianza: Math.min(70 + Math.round(ingresosMensuales.length * 3), 88),
        };
    },

    /**
     * Aplicar eventos (vacaciones, bajas, proyectos) a la proyeccion base
     */
    applyEvents(proyeccionAnual, eventos, mesActual) {
        if (!eventos || eventos.length === 0) return proyeccionAnual;

        let ajusteIngresos = 0;
        let ajusteGastos = 0;
        const ingresoMensualBase = proyeccionAnual.ingresos / 12;

        for (const evento of eventos) {
            const inicio = new Date(evento.fecha_inicio);
            const fin = evento.fecha_fin ? new Date(evento.fecha_fin) : inicio;
            const mesInicio = inicio.getMonth() + 1;
            const mesFin = fin.getMonth() + 1;

            // Solo aplicar ajustes a meses futuros (los pasados ya estan en datos reales)
            for (let m = Math.max(mesInicio, mesActual + 1); m <= mesFin; m++) {
                switch (evento.tipo) {
                    case 'vacaciones':
                        // Sin ingresos durante vacaciones (a menos que impacto_ingresos indique lo contrario)
                        ajusteIngresos += evento.impacto_ingresos !== 0
                            ? parseFloat(evento.impacto_ingresos)
                            : -ingresoMensualBase;
                        ajusteGastos += parseFloat(evento.impacto_gastos || 0);
                        break;
                    case 'baja_it':
                    case 'baja_maternidad':
                        // Sin ingresos, gastos fijos continuan
                        ajusteIngresos -= ingresoMensualBase;
                        break;
                    case 'proyecto_grande':
                        // Ingreso adicional
                        ajusteIngresos += parseFloat(evento.impacto_ingresos || 0);
                        ajusteGastos += parseFloat(evento.impacto_gastos || 0);
                        break;
                    case 'cese_temporal':
                        ajusteIngresos -= ingresoMensualBase;
                        ajusteGastos += parseFloat(evento.impacto_gastos || 0);
                        break;
                    case 'inicio_empleado':
                        ajusteGastos += parseFloat(evento.impacto_gastos || 0);
                        break;
                    case 'fin_empleado':
                        ajusteGastos += parseFloat(evento.impacto_gastos || 0); // negativo
                        break;
                    case 'inversion':
                        ajusteGastos += parseFloat(evento.impacto_gastos || 0);
                        break;
                    case 'estacionalidad':
                        ajusteIngresos += parseFloat(evento.impacto_ingresos || 0);
                        ajusteGastos += parseFloat(evento.impacto_gastos || 0);
                        break;
                }
            }
        }

        return {
            ingresos: Math.max(0, Math.round((proyeccionAnual.ingresos + ajusteIngresos) * 100) / 100),
            gastos: Math.max(0, Math.round((proyeccionAnual.gastos + ajusteGastos) * 100) / 100),
            confianza: Math.max(30, proyeccionAnual.confianza - 10), // Eventos manuales reducen confianza
        };
    },

    // ============================================================
    // CALCULO DE BASE OPTIMA
    // ============================================================

    /**
     * Determinar tramo y base optima segun rendimiento neto mensual
     */
    calculateOptimalBase(rendimientoNetoMensual, tramos) {
        if (!tramos || tramos.length === 0) {
            return { tramo: 1, baseMin: 0, baseMax: 0, baseRecomendada: 0, cuota: 0, tipoCotizacion: 31.20 };
        }

        // Encontrar tramo correspondiente
        let tramoSeleccionado = tramos[0]; // fallback al primero
        for (const tramo of tramos) {
            if (rendimientoNetoMensual >= tramo.rendMin &&
                (rendimientoNetoMensual < tramo.rendMax || tramo.rendMax === Infinity)) {
                tramoSeleccionado = tramo;
                break;
            }
        }

        // Sesgo conservador: recomendar base ligeramente por encima del minimo
        // para evitar sorpresas por regularizacion
        const rango = tramoSeleccionado.baseMax - tramoSeleccionado.baseMin;
        const baseRecomendada = Math.round(
            (tramoSeleccionado.baseMin + rango * 0.15) * 100
        ) / 100;

        const cuota = Math.round(baseRecomendada * tramoSeleccionado.tipoCotizacion / 100 * 100) / 100;

        return {
            tramo: tramoSeleccionado.tramo,
            baseMin: tramoSeleccionado.baseMin,
            baseMax: tramoSeleccionado.baseMax,
            baseRecomendada,
            cuota,
            tipoCotizacion: tramoSeleccionado.tipoCotizacion,
            rendimientoNetoMensual: Math.round(rendimientoNetoMensual * 100) / 100,
        };
    },

    /**
     * Calcular riesgo de regularizacion
     */
    calculateRegularizationRisk(baseActual, cuotaActual, baseRecomendada, cuotaRecomendada, mesActual) {
        if (!baseActual || !cuotaActual) {
            return { diferenciaMensual: 0, riesgoAnual: 0, tipo: 'sin_datos', mesesRestantes: 12 - mesActual };
        }

        const diferenciaMensual = Math.round((cuotaRecomendada - cuotaActual) * 100) / 100;
        const mesesYaPagados = mesActual;
        const mesesRestantes = 12 - mesActual;

        // Regularizacion retroactiva (meses ya pagados a base incorrecta)
        const retroactivo = Math.round(diferenciaMensual * mesesYaPagados * 100) / 100;
        // Regularizacion futura (si no cambia la base)
        const futuro = Math.round(diferenciaMensual * mesesRestantes * 100) / 100;
        const riesgoAnual = Math.round((retroactivo + futuro) * 100) / 100;

        return {
            diferenciaMensual,
            retroactivo,
            futuro,
            riesgoAnual,
            tipo: riesgoAnual > 0 ? 'a_pagar' : riesgoAnual < 0 ? 'a_devolver' : 'correcto',
            mesesYaPagados,
            mesesRestantes,
        };
    },

    /**
     * Encontrar proxima ventana de cambio de base
     */
    getNextChangeWindow(ejercicio) {
        const hoy = new Date();
        const mesActual = hoy.getMonth() + 1;
        const diaActual = hoy.getDate();

        for (const ventana of VENTANAS_CAMBIO) {
            // El deadline es el ultimo dia del mes_limite
            const ultimoDiaMesLimite = new Date(ejercicio, ventana.mes_limite, 0).getDate();

            if (ventana.mes_limite > mesActual ||
                (ventana.mes_limite === mesActual && diaActual <= ultimoDiaMesLimite)) {
                return {
                    mesEfectivo: ventana.mes_efectivo,
                    mesLimite: ventana.mes_limite,
                    label: ventana.label,
                    fechaEfectiva: `${ejercicio}-${String(ventana.mes_efectivo).padStart(2, '0')}-01`,
                    fechaLimite: `${ejercicio}-${String(ventana.mes_limite).padStart(2, '0')}-${ultimoDiaMesLimite}`,
                    diasRestantes: Math.ceil(
                        (new Date(ejercicio, ventana.mes_limite - 1, ultimoDiaMesLimite) - hoy) / (1000 * 60 * 60 * 24)
                    ),
                };
            }
        }

        // Si ya pasaron todas las ventanas del ano, la primera del siguiente
        const ultimoDiaEnero = new Date(ejercicio + 1, 1, 0).getDate();
        return {
            mesEfectivo: 1,
            mesLimite: 12,
            label: "1 de enero " + (ejercicio + 1),
            fechaEfectiva: `${ejercicio + 1}-01-01`,
            fechaLimite: `${ejercicio}-12-${ultimoDiaEnero}`,
            diasRestantes: Math.ceil(
                (new Date(ejercicio, 11, 31) - hoy) / (1000 * 60 * 60 * 24)
            ),
        };
    },

    /**
     * Recomendar si conviene cambiar la base
     */
    recommendBaseChange(estimacion, perfil, ejercicio) {
        const { tramo_recomendado, base_recomendada, cuota_recomendada } = estimacion;
        const baseActual = parseFloat(perfil.base_cotizacion_actual || 0);
        const tramoActual = perfil.tramo_actual;

        // Si tarifa plana activa, no recomendar cambio
        if (perfil.tarifa_plana_activa) {
            return { shouldChange: false, reason: 'tarifa_plana_activa' };
        }

        // Si no hay base actual, siempre recomendar
        if (!baseActual) {
            return {
                shouldChange: true,
                reason: 'sin_base_actual',
                nextWindow: this.getNextChangeWindow(ejercicio),
                baseRecomendada: base_recomendada,
                cuotaRecomendada: cuota_recomendada,
            };
        }

        // Si la diferencia es menor a 50 EUR/mes en cuota, no vale la pena
        const diferencia = Math.abs(cuota_recomendada - parseFloat(perfil.cuota_mensual_actual || 0));
        if (diferencia < 50) {
            return { shouldChange: false, reason: 'diferencia_insignificante', diferencia };
        }

        // Si el tramo cambio, recomendar
        if (tramoActual && tramo_recomendado !== tramoActual) {
            return {
                shouldChange: true,
                reason: 'cambio_tramo',
                tramoAnterior: tramoActual,
                tramoNuevo: tramo_recomendado,
                nextWindow: this.getNextChangeWindow(ejercicio),
                baseRecomendada: base_recomendada,
                cuotaRecomendada: cuota_recomendada,
                diferencia,
            };
        }

        return { shouldChange: false, reason: 'base_adecuada' };
    },

    // ============================================================
    // GENERADOR PRINCIPAL DE ESTIMACION
    // ============================================================

    /**
     * Genera una estimacion completa para un autonomo
     * @param {string} empresaId
     * @param {number} ejercicio
     * @param {Object} options - { metodo, ajustesManuales, forzarRecalculo, creadoPor, tipoCreador }
     */
    async generateFullEstimation(empresaId, ejercicio, options = {}) {
        const {
            metodo = 'auto',
            ajustesManuales = null,
            creadoPor = null,
            tipoCreador = 'system',
            titularId = null,
        } = options;

        const mesActual = new Date().getMonth() + 1;

        // 1. Obtener datos en paralelo
        const [tramos, perfil, datosYTD, datosAnterior, eventos] = await Promise.all([
            this.getTramosForYear(ejercicio),
            this.getPerfil(empresaId, ejercicio, titularId),
            this.getRendimientoNetoYTD(empresaId, ejercicio),
            this.getDatosEjercicioAnterior(empresaId, ejercicio),
            this.getEventos(empresaId, ejercicio, titularId),
        ]);

        // 2. Seleccionar metodo de proyeccion
        let metodoUsado = metodo;
        let proyeccion;

        if (metodo === 'auto') {
            // Auto-seleccion: estacional si hay datos anteriores, sino linear
            if (datosAnterior.hayDatos && mesActual <= 6) {
                metodoUsado = 'seasonal';
            } else if (datosYTD.mesesConDatos >= 3) {
                metodoUsado = 'weighted_avg';
            } else {
                metodoUsado = 'linear';
            }
        }

        switch (metodoUsado) {
            case 'seasonal':
                proyeccion = this.projectSeasonal(datosYTD, datosAnterior, mesActual);
                break;
            case 'weighted_avg':
                proyeccion = this.projectWeightedAvg(datosYTD, mesActual);
                break;
            case 'linear':
            default:
                proyeccion = this.projectLinear(datosYTD, mesActual);
                metodoUsado = 'linear';
                break;
        }

        // 3. Aplicar eventos
        const proyeccionAjustada = this.applyEvents(proyeccion, eventos, mesActual);

        // 4. Calcular rendimiento neto
        const rendimientoNetoAnual = proyeccionAjustada.ingresos - proyeccionAjustada.gastos;

        // Deduccion por gastos de dificil justificacion
        const pctDeduccion = perfil.es_societario ? 0.03 : 0.07;
        const regimen = perfil.regimen_estimacion || 'directa_simplificada';
        // Solo aplica en estimacion directa simplificada
        const deduccionAplicable = regimen === 'directa_simplificada' ? pctDeduccion : 0;
        const deduccionGastosDificil = Math.max(0, Math.round(rendimientoNetoAnual * deduccionAplicable * 100) / 100);
        const rendimientoNetoReducido = Math.max(0, rendimientoNetoAnual - deduccionGastosDificil);
        const rendimientoNetoMensual = rendimientoNetoReducido / 12;

        // 5. Determinar base optima
        const baseOptima = this.calculateOptimalBase(rendimientoNetoMensual, tramos);

        // 6. Calcular riesgo regularizacion
        const riesgo = this.calculateRegularizationRisk(
            parseFloat(perfil.base_cotizacion_actual || 0),
            parseFloat(perfil.cuota_mensual_actual || 0),
            baseOptima.baseRecomendada,
            baseOptima.cuota,
            mesActual
        );

        // 7. Generar escenarios (optimista/pesimista)
        const escenarioOptimista = this._generateScenario(
            proyeccionAjustada.ingresos * 1.15,
            proyeccionAjustada.gastos * 0.95,
            deduccionAplicable, tramos
        );
        const escenarioPesimista = this._generateScenario(
            proyeccionAjustada.ingresos * 0.80,
            proyeccionAjustada.gastos * 1.10,
            deduccionAplicable, tramos
        );

        // 8. Guardar snapshot
        const [estimacion] = await sql`
            INSERT INTO reta_estimaciones_180 (
                empresa_id, ejercicio, titular_id,
                ingresos_reales_ytd, gastos_reales_ytd, nominas_reales_ytd,
                metodo_proyeccion,
                ingresos_proyectados_anual, gastos_proyectados_anual,
                rendimiento_neto_anual, deduccion_gastos_dificil,
                rendimiento_neto_reducido, rendimiento_neto_mensual,
                tramo_recomendado, base_recomendada, cuota_recomendada,
                base_actual, cuota_actual,
                diferencia_mensual, riesgo_regularizacion_anual,
                confianza_pct, meses_datos_reales,
                escenario_optimista, escenario_pesimista,
                ajustes_manuales,
                creado_por, tipo_creador
            ) VALUES (
                ${empresaId}, ${ejercicio}, ${titularId},
                ${datosYTD.ingresosYTD}, ${datosYTD.gastosYTD}, ${datosYTD.nominasYTD},
                ${metodoUsado},
                ${proyeccionAjustada.ingresos}, ${proyeccionAjustada.gastos},
                ${rendimientoNetoAnual}, ${deduccionGastosDificil},
                ${rendimientoNetoReducido}, ${Math.round(rendimientoNetoMensual * 100) / 100},
                ${baseOptima.tramo}, ${baseOptima.baseRecomendada}, ${baseOptima.cuota},
                ${perfil.base_cotizacion_actual}, ${perfil.cuota_mensual_actual},
                ${riesgo.diferenciaMensual}, ${riesgo.riesgoAnual},
                ${proyeccionAjustada.confianza}, ${datosYTD.mesesConDatos},
                ${JSON.stringify(escenarioOptimista)}, ${JSON.stringify(escenarioPesimista)},
                ${ajustesManuales ? JSON.stringify(ajustesManuales) : null},
                ${creadoPor}, ${tipoCreador}
            )
            RETURNING *
        `;

        return {
            estimacion,
            perfil,
            baseOptima,
            riesgo,
            escenarioOptimista,
            escenarioPesimista,
            datosYTD,
            eventos,
            metodoUsado,
            proximaVentana: this.getNextChangeWindow(ejercicio),
            recomendacionCambio: this.recommendBaseChange(estimacion, perfil, ejercicio),
        };
    },

    /**
     * Genera un escenario (optimista o pesimista)
     */
    _generateScenario(ingresos, gastos, deduccionPct, tramos) {
        const rendNeto = ingresos - gastos;
        const deduccion = Math.max(0, rendNeto * deduccionPct);
        const rendReducido = Math.max(0, rendNeto - deduccion);
        const rendMensual = rendReducido / 12;
        const base = this.calculateOptimalBase(rendMensual, tramos);

        return {
            ingresos: Math.round(ingresos * 100) / 100,
            gastos: Math.round(gastos * 100) / 100,
            rendimientoNeto: Math.round(rendNeto * 100) / 100,
            rendimientoNetoMensual: Math.round(rendMensual * 100) / 100,
            tramo: base.tramo,
            base: base.baseRecomendada,
            cuota: base.cuota,
        };
    },

    /**
     * Simulacion what-if: que pasa si los ingresos/gastos cambian un %
     */
    async simulate(empresaId, ejercicio, { variacionIngresosPct = 0, variacionGastosPct = 0, titularId = null }) {
        const tramos = await this.getTramosForYear(ejercicio);
        const perfil = await this.getPerfil(empresaId, ejercicio, titularId);

        // Obtener ultima estimacion como base (filtrada por titular si aplica)
        const [ultimaEst] = titularId
            ? await sql`
                SELECT * FROM reta_estimaciones_180
                WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio} AND titular_id = ${titularId}
                ORDER BY fecha_calculo DESC LIMIT 1
            `
            : await sql`
                SELECT * FROM reta_estimaciones_180
                WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio} AND titular_id IS NULL
                ORDER BY fecha_calculo DESC LIMIT 1
            `;

        if (!ultimaEst) return null;

        const ingresos = parseFloat(ultimaEst.ingresos_proyectados_anual) * (1 + variacionIngresosPct / 100);
        const gastos = parseFloat(ultimaEst.gastos_proyectados_anual) * (1 + variacionGastosPct / 100);

        const deduccionPct = perfil.es_societario ? 0.03 :
            (perfil.regimen_estimacion === 'directa_simplificada' ? 0.07 : 0);

        const rendNeto = ingresos - gastos;
        const deduccion = Math.max(0, rendNeto * deduccionPct);
        const rendReducido = Math.max(0, rendNeto - deduccion);
        const rendMensual = rendReducido / 12;
        const baseOptima = this.calculateOptimalBase(rendMensual, tramos);
        const mesActual = new Date().getMonth() + 1;

        const riesgo = this.calculateRegularizationRisk(
            parseFloat(perfil.base_cotizacion_actual || 0),
            parseFloat(perfil.cuota_mensual_actual || 0),
            baseOptima.baseRecomendada,
            baseOptima.cuota,
            mesActual
        );

        return {
            ingresos: Math.round(ingresos * 100) / 100,
            gastos: Math.round(gastos * 100) / 100,
            rendimientoNeto: Math.round(rendNeto * 100) / 100,
            rendimientoNetoReducido: Math.round(rendReducido * 100) / 100,
            rendimientoNetoMensual: Math.round(rendMensual * 100) / 100,
            baseOptima,
            riesgo,
            variacionIngresosPct,
            variacionGastosPct,
        };
    },

    /**
     * Invalidar cache de tramos
     */
    invalidateCache(ejercicio = null) {
        if (ejercicio) {
            tramosCache.delete(ejercicio);
        } else {
            tramosCache.clear();
        }
    },
};
