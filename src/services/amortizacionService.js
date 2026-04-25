/**
 * Cálculo de amortizaciones lineales para inmovilizado.
 *
 * Estimación directa simplificada (Art. 28 RIRPF) — coeficientes máximos
 * de la tabla simplificada del Anexo del IS:
 *   edificios:               3 %
 *   instalaciones:          10 %
 *   maquinaria:             12 %
 *   mobiliario:             10 %
 *   equipos_informaticos:   26 %
 *   vehiculos:              16 %
 *   utiles_herramientas:    30 %
 *   otros:                  10 %
 *
 * Se calcula on-demand prorrateando por días desde fecha_alta hasta el final
 * del periodo solicitado, sin superar el valor amortizable
 * (valor_adquisicion - valor_residual) acumulado a lo largo de la vida.
 */

import { sql } from "../db.js";

export const COEFS_DEFECTO = {
    edificios: 3,
    instalaciones: 10,
    maquinaria: 12,
    mobiliario: 10,
    equipos_informaticos: 26,
    vehiculos: 16,
    utiles_herramientas: 30,
    otros: 10,
};

const DIAS_ANIO = 365;

/**
 * Amortización acumulada de un único bien entre dos fechas.
 *
 * @param {object} bien - fila de inmovilizado_180
 * @param {string|Date} desde - inicio del periodo (ISO YYYY-MM-DD)
 * @param {string|Date} hasta - fin del periodo (ISO YYYY-MM-DD)
 * @returns {number} importe amortizado en el periodo
 */
export function amortizacionEnPeriodo(bien, desde, hasta) {
    const valorAdq = parseFloat(bien.valor_adquisicion);
    const valorRes = parseFloat(bien.valor_residual || 0);
    const baseAmortizable = Math.max(0, valorAdq - valorRes);
    if (baseAmortizable === 0) return 0;

    const coef = parseFloat(bien.coef_amortizacion_pct) / 100;
    const cuotaAnual = baseAmortizable * coef;

    const fechaAlta = new Date(bien.fecha_alta);
    const fechaBaja = bien.fecha_baja ? new Date(bien.fecha_baja) : null;
    const desdeD = new Date(desde);
    const hastaD = new Date(hasta);

    // Recorte: solo se amortiza dentro de [fechaAlta, fechaBaja || ∞]
    const inicio = desdeD < fechaAlta ? fechaAlta : desdeD;
    const fin = fechaBaja && fechaBaja < hastaD ? fechaBaja : hastaD;
    if (fin < inicio) return 0;

    const dias = Math.floor((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;
    let amortizado = cuotaAnual * (dias / DIAS_ANIO);

    // Tope: nunca superar el total amortizable acumulado desde fecha_alta.
    // Calcula amortizado hasta `fin` y compara contra base.
    const diasTotal = Math.floor((fin - fechaAlta) / (1000 * 60 * 60 * 24)) + 1;
    const acumuladoTotal = cuotaAnual * (diasTotal / DIAS_ANIO);
    if (acumuladoTotal > baseAmortizable) {
        const exceso = acumuladoTotal - baseAmortizable;
        amortizado = Math.max(0, amortizado - exceso);
    }

    return Math.max(0, amortizado);
}

/**
 * Amortización acumulada agregada para una empresa entre dos fechas.
 * Útil para alimentar la casilla de "amortizaciones" del modelo 130.
 */
export async function calcularAmortizacionAcumulada(empresaId, desde, hasta) {
    const bienes = await sql`
        SELECT id, descripcion, fecha_alta, fecha_baja,
               valor_adquisicion, valor_residual,
               grupo, coef_amortizacion_pct, metodo
        FROM inmovilizado_180
        WHERE empresa_id = ${empresaId}
        AND deleted_at IS NULL
        AND fecha_alta <= ${hasta}
    `;

    let total = 0;
    const detalle = [];
    for (const bien of bienes) {
        const importe = amortizacionEnPeriodo(bien, desde, hasta);
        if (importe > 0) {
            total += importe;
            detalle.push({
                inmovilizado_id: bien.id,
                descripcion: bien.descripcion,
                grupo: bien.grupo,
                coef_pct: parseFloat(bien.coef_amortizacion_pct),
                importe: Math.round(importe * 100) / 100,
            });
        }
    }
    return { total: Math.round(total * 100) / 100, detalle };
}
