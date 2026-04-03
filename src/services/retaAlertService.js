/**
 * RETA Alert Service - Monitoreo y alertas para autonomos
 *
 * Detecta situaciones de riesgo y genera alertas:
 * - Desviacion de tramo
 * - Ventana de cambio de base proxima
 * - Tarifa plana por vencer
 * - Datos insuficientes
 * - Riesgo de regularizacion alto
 */

import { sql } from "../db.js";
import { RetaEngine } from "./retaEstimationEngine.js";
import logger from "../utils/logger.js";

// Umbral configurable para riesgo de regularizacion (EUR)
const UMBRAL_REGULARIZACION = 500;
const UMBRAL_DIAS_VENTANA = 7;
const UMBRAL_DIAS_TARIFA_PLANA = 30;
const UMBRAL_MESES_SIN_DATOS = 2;

/**
 * Escaneo completo de alertas RETA para todas las empresas autonomas
 * vinculadas a una asesoria. Se ejecuta via cron diariamente.
 */
export async function runRetaAlertScan() {
    try {
        logger.info("[RETA Alert] Iniciando escaneo de alertas RETA...");

        // Obtener todas las empresas autonomas vinculadas a asesorias
        const empresas = await sql`
            SELECT e.id, e.nombre
            FROM empresa_180 e
            JOIN asesoria_clientes_180 v ON v.empresa_id = e.id AND v.estado = 'activo'
            WHERE e.activo = true
        `;

        if (empresas.length === 0) {
            logger.info("[RETA Alert] No hay empresas vinculadas.");
            return;
        }

        const ejercicio = new Date().getFullYear();
        let alertasGeneradas = 0;

        for (const empresa of empresas) {
            try {
                const nuevas = await checkAlertasEmpresa(empresa.id, ejercicio);
                alertasGeneradas += nuevas;
            } catch (err) {
                logger.warn(`[RETA Alert] Error en empresa ${empresa.id}: ${err.message}`);
            }
        }

        logger.info(`[RETA Alert] Escaneo completado: ${alertasGeneradas} alertas generadas para ${empresas.length} empresas.`);
    } catch (err) {
        logger.error("[RETA Alert] Error en escaneo:", { error: err.message });
    }
}

/**
 * Escaneo de estimaciones RETA bimensual (1 y 15 de cada mes)
 */
export async function runRetaEstimationScan() {
    try {
        logger.info("[RETA Estimation] Iniciando recalculo de estimaciones...");

        const empresas = await sql`
            SELECT e.id, e.nombre
            FROM empresa_180 e
            JOIN asesoria_clientes_180 v ON v.empresa_id = e.id AND v.estado = 'activo'
            WHERE e.activo = true
        `;

        const ejercicio = new Date().getFullYear();
        let recalculadas = 0;

        for (const empresa of empresas) {
            try {
                await RetaEngine.generateFullEstimation(empresa.id, ejercicio, {
                    metodo: 'auto',
                    tipoCreador: 'system',
                });
                recalculadas++;
            } catch (err) {
                logger.warn(`[RETA Estimation] Error recalculando ${empresa.id}: ${err.message}`);
            }
        }

        logger.info(`[RETA Estimation] Recalculo completado: ${recalculadas}/${empresas.length} empresas.`);
    } catch (err) {
        logger.error("[RETA Estimation] Error en recalculo:", { error: err.message });
    }
}

/**
 * Chequea todas las alertas posibles para una empresa
 */
async function checkAlertasEmpresa(empresaId, ejercicio) {
    let alertas = 0;

    const perfil = await RetaEngine.getPerfil(empresaId, ejercicio);

    // 1. Desviacion de tramo + riesgo regularizacion
    alertas += await checkDesviacionTramo(empresaId, ejercicio, perfil);

    // 2. Ventana de cambio de base proxima
    alertas += await checkVentanaCambio(empresaId, ejercicio);

    // 3. Tarifa plana por vencer
    alertas += await checkTarifaPlana(empresaId, ejercicio, perfil);

    // 4. Datos insuficientes
    alertas += await checkDatosInsuficientes(empresaId, ejercicio);

    return alertas;
}

/**
 * Alerta: desviacion de tramo y/o riesgo de regularizacion alto
 */
async function checkDesviacionTramo(empresaId, ejercicio, perfil) {
    let alertas = 0;

    // Obtener ultima estimacion
    const [estimacion] = await sql`
        SELECT * FROM reta_estimaciones_180
        WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio}
        ORDER BY fecha_calculo DESC LIMIT 1
    `;

    if (!estimacion) return 0;

    const tramoActual = perfil.tramo_actual;
    const tramoRecomendado = estimacion.tramo_recomendado;
    const riesgo = parseFloat(estimacion.riesgo_regularizacion_anual || 0);

    // Desviacion de tramo > 1 nivel
    if (tramoActual && Math.abs(tramoRecomendado - tramoActual) > 1) {
        const yaExiste = await alertaRecienteExiste(empresaId, ejercicio, 'desviacion_tramo', 7);
        if (!yaExiste) {
            await crearAlerta(empresaId, ejercicio, {
                tipo: 'desviacion_tramo',
                severidad: 'warning',
                titulo: `Desviacion de tramo RETA detectada`,
                mensaje: `El tramo actual (${tramoActual}) difiere del recomendado (${tramoRecomendado}) en mas de 1 nivel. Se recomienda revisar la base de cotizacion.`,
                datos: { tramoActual, tramoRecomendado, riesgo },
            });
            alertas++;
        }
    }

    // Riesgo de regularizacion alto
    if (Math.abs(riesgo) > UMBRAL_REGULARIZACION) {
        const yaExiste = await alertaRecienteExiste(empresaId, ejercicio, 'regularizacion_alta', 14);
        if (!yaExiste) {
            const tipo = riesgo > 0 ? 'a pagar' : 'a devolver';
            await crearAlerta(empresaId, ejercicio, {
                tipo: 'regularizacion_alta',
                severidad: riesgo > 0 ? 'critical' : 'info',
                titulo: `Riesgo de regularizacion: ${Math.abs(riesgo).toFixed(2)} EUR ${tipo}`,
                mensaje: riesgo > 0
                    ? `La estimacion actual indica una regularizacion de ${riesgo.toFixed(2)} EUR a pagar a fin de ano. Se recomienda ajustar la base de cotizacion.`
                    : `La estimacion actual indica una posible devolucion de ${Math.abs(riesgo).toFixed(2)} EUR. Puede considerar reducir la base para mejorar el flujo de caja.`,
                datos: { riesgo, baseActual: perfil.base_cotizacion_actual, baseRecomendada: estimacion.base_recomendada },
            });
            alertas++;
        }
    }

    return alertas;
}

/**
 * Alerta: ventana de cambio de base proxima (7 dias antes)
 */
async function checkVentanaCambio(empresaId, ejercicio) {
    const ventana = RetaEngine.getNextChangeWindow(ejercicio);

    if (ventana.diasRestantes <= UMBRAL_DIAS_VENTANA && ventana.diasRestantes > 0) {
        const yaExiste = await alertaRecienteExiste(empresaId, ejercicio, 'plazo_cambio_proximo', 7);
        if (!yaExiste) {
            await crearAlerta(empresaId, ejercicio, {
                tipo: 'plazo_cambio_proximo',
                severidad: 'warning',
                titulo: `Ventana de cambio de base: ${ventana.diasRestantes} dias restantes`,
                mensaje: `La proxima ventana para cambiar la base de cotizacion es el ${ventana.label}. El plazo para solicitar el cambio vence el ${ventana.fechaLimite}.`,
                datos: ventana,
            });
            return 1;
        }
    }

    return 0;
}

/**
 * Alerta: tarifa plana por vencer (30 dias antes)
 */
async function checkTarifaPlana(empresaId, ejercicio, perfil) {
    if (!perfil.tarifa_plana_activa || !perfil.tarifa_plana_fin) return 0;

    const fin = new Date(perfil.tarifa_plana_fin);
    const hoy = new Date();
    const diasRestantes = Math.ceil((fin - hoy) / (1000 * 60 * 60 * 24));

    if (diasRestantes <= UMBRAL_DIAS_TARIFA_PLANA && diasRestantes > 0) {
        const yaExiste = await alertaRecienteExiste(empresaId, ejercicio, 'tarifa_plana_vencimiento', 14);
        if (!yaExiste) {
            await crearAlerta(empresaId, ejercicio, {
                tipo: 'tarifa_plana_vencimiento',
                severidad: 'warning',
                titulo: `Tarifa plana vence en ${diasRestantes} dias`,
                mensaje: `La tarifa plana de ${perfil.tarifa_plana_importe} EUR/mes vence el ${perfil.tarifa_plana_fin}. A partir de esa fecha, la cuota se calculara segun los rendimientos netos reales.`,
                datos: { fechaFin: perfil.tarifa_plana_fin, diasRestantes, importeActual: perfil.tarifa_plana_importe },
            });
            return 1;
        }
    }

    return 0;
}

/**
 * Alerta: datos insuficientes (sin facturas/gastos en 2+ meses)
 */
async function checkDatosInsuficientes(empresaId, ejercicio) {
    const mesActual = new Date().getMonth() + 1;
    if (mesActual <= UMBRAL_MESES_SIN_DATOS) return 0; // Muy pronto para alertar

    // Contar meses con actividad (facturas o gastos) en el ejercicio actual
    const [result] = await sql`
        SELECT COUNT(DISTINCT mes) as meses_con_datos FROM (
            SELECT EXTRACT(MONTH FROM fecha)::integer as mes
            FROM factura_180
            WHERE empresa_id = ${empresaId}
            AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND EXTRACT(YEAR FROM fecha) = ${ejercicio}
            AND (es_test IS NOT TRUE)
            UNION
            SELECT EXTRACT(MONTH FROM fecha_compra)::integer as mes
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND EXTRACT(YEAR FROM fecha_compra) = ${ejercicio}
        ) sub
    `;

    const mesesConDatos = parseInt(result.meses_con_datos || 0);
    const mesesSinDatos = mesActual - mesesConDatos;

    if (mesesSinDatos >= UMBRAL_MESES_SIN_DATOS) {
        const yaExiste = await alertaRecienteExiste(empresaId, ejercicio, 'datos_insuficientes', 30);
        if (!yaExiste) {
            await crearAlerta(empresaId, ejercicio, {
                tipo: 'datos_insuficientes',
                severidad: 'info',
                titulo: `Datos insuficientes para estimacion fiable`,
                mensaje: `Solo hay datos de ${mesesConDatos} meses de los ${mesActual} transcurridos en ${ejercicio}. Las estimaciones RETA pueden ser poco fiables. Se recomienda solicitar al cliente que actualice sus facturas y gastos.`,
                datos: { mesesConDatos, mesesTranscurridos: mesActual, mesesSinDatos },
            });
            return 1;
        }
    }

    return 0;
}

// ============================================================
// UTILIDADES
// ============================================================

async function alertaRecienteExiste(empresaId, ejercicio, tipo, diasMinimos) {
    const [existe] = await sql`
        SELECT id FROM reta_alertas_180
        WHERE empresa_id = ${empresaId}
        AND ejercicio = ${ejercicio}
        AND tipo = ${tipo}
        AND descartada = false
        AND created_at > NOW() - INTERVAL '1 day' * ${diasMinimos}
        LIMIT 1
    `;
    return !!existe;
}

async function crearAlerta(empresaId, ejercicio, { tipo, severidad, titulo, mensaje, datos }) {
    await sql`
        INSERT INTO reta_alertas_180 (empresa_id, ejercicio, tipo, severidad, titulo, mensaje, datos)
        VALUES (${empresaId}, ${ejercicio}, ${tipo}, ${severidad}, ${titulo}, ${mensaje}, ${JSON.stringify(datos)})
    `;
}
