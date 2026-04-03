/**
 * RETA Pre-Onboarding Service
 *
 * Gestiona el cuestionario de pre-onboarding para prospectos/clientes nuevos.
 * Genera 3 escenarios (optimista, realista, pesimista) antes de que el
 * cliente empiece a facturar, para darle una estimacion inicial de su
 * base de cotizacion.
 */

import { sql } from "../db.js";
import { RetaEngine } from "./retaEstimationEngine.js";

export const RetaPreOnboarding = {

    /**
     * Crear una nueva estimacion pre-onboarding
     */
    async create(asesoriaId, data) {
        const {
            empresaId = null,
            nombreProspecto,
            nif = null,
            actividadTipo = 'profesional',
            sector = null,
            epigrafesIae = [],
            ingresosMensualesEstimados = 0,
            gastosFijosMensuales = 0,
            gastosPorcentajeVariable = 0,
            tieneEmpleados = false,
            costeEmpleadosMensual = 0,
            tieneLocal = false,
            alquilerMensual = 0,
            haSidoAutonomoAntes = false,
            fechaUltimoAlta = null,
            rendimientoNetoAnterior = null,
        } = data;

        // Calcular elegibilidad tarifa plana
        const elegibleTarifaPlana = checkElegibilidadTarifaPlana(
            haSidoAutonomoAntes, fechaUltimoAlta
        );

        // Calcular gastos totales mensuales
        const gastosVariables = ingresosMensualesEstimados * (gastosPorcentajeVariable / 100);
        const gastosTotalesMensuales = gastosFijosMensuales + gastosVariables
            + (tieneEmpleados ? costeEmpleadosMensual : 0)
            + (tieneLocal ? alquilerMensual : 0);

        // Generar 3 escenarios
        const ejercicio = new Date().getFullYear();
        const tramos = await RetaEngine.getTramosForYear(ejercicio);

        const realista = calculateScenario(ingresosMensualesEstimados, gastosTotalesMensuales, tramos, actividadTipo);
        const optimista = calculateScenario(
            ingresosMensualesEstimados * 1.25,
            gastosTotalesMensuales * 0.90,
            tramos, actividadTipo
        );
        const pesimista = calculateScenario(
            ingresosMensualesEstimados * 0.65,
            gastosTotalesMensuales * 1.15,
            tramos, actividadTipo
        );

        // Guardar
        const [resultado] = await sql`
            INSERT INTO reta_pre_onboarding_180 (
                empresa_id, asesoria_id, nombre_prospecto, nif,
                actividad_tipo, sector, epigrafes_iae,
                ingresos_mensuales_estimados, gastos_fijos_mensuales,
                gastos_variables_pct, tiene_empleados, coste_empleados_mensual,
                tiene_local, alquiler_mensual,
                ha_sido_autonomo_antes, fecha_ultimo_alta, rendimiento_neto_anterior,
                elegible_tarifa_plana,
                resultado_optimista, resultado_realista, resultado_pesimista,
                tramo_recomendado, base_recomendada, cuota_estimada,
                estado
            ) VALUES (
                ${empresaId}, ${asesoriaId}, ${nombreProspecto}, ${nif},
                ${actividadTipo}, ${sector}, ${epigrafesIae},
                ${ingresosMensualesEstimados}, ${gastosFijosMensuales},
                ${gastosPorcentajeVariable}, ${tieneEmpleados}, ${costeEmpleadosMensual},
                ${tieneLocal}, ${alquilerMensual},
                ${haSidoAutonomoAntes}, ${fechaUltimoAlta}, ${rendimientoNetoAnterior},
                ${elegibleTarifaPlana},
                ${JSON.stringify(optimista)}, ${JSON.stringify(realista)}, ${JSON.stringify(pesimista)},
                ${realista.tramo}, ${realista.baseRecomendada}, ${realista.cuota},
                'completado'
            )
            RETURNING *
        `;

        return {
            preOnboarding: resultado,
            escenarios: { optimista, realista, pesimista },
            elegibleTarifaPlana,
            tarifaPlana: elegibleTarifaPlana ? {
                importe: 80,
                duracion: 12,
                extensible: true,
                condicionExtension: "Rendimiento neto anual < SMI",
            } : null,
        };
    },

    /**
     * Actualizar datos de pre-onboarding y recalcular
     */
    async update(id, data) {
        // Leer actual
        const [actual] = await sql`SELECT * FROM reta_pre_onboarding_180 WHERE id = ${id}`;
        if (!actual) throw new Error("Pre-onboarding no encontrado");

        // Merge datos
        const merged = { ...actual, ...data };

        // Recalcular
        const ingresosMensuales = parseFloat(merged.ingresos_mensuales_estimados || 0);
        const gastosFijos = parseFloat(merged.gastos_fijos_mensuales || 0);
        const gastosVariablesPct = parseFloat(merged.gastos_variables_pct || 0);
        const gastosVariables = ingresosMensuales * (gastosVariablesPct / 100);
        const costeEmpleados = merged.tiene_empleados ? parseFloat(merged.coste_empleados_mensual || 0) : 0;
        const alquiler = merged.tiene_local ? parseFloat(merged.alquiler_mensual || 0) : 0;
        const gastosTotales = gastosFijos + gastosVariables + costeEmpleados + alquiler;

        const ejercicio = new Date().getFullYear();
        const tramos = await RetaEngine.getTramosForYear(ejercicio);
        const actividadTipo = merged.actividad_tipo || 'profesional';

        const realista = calculateScenario(ingresosMensuales, gastosTotales, tramos, actividadTipo);
        const optimista = calculateScenario(ingresosMensuales * 1.25, gastosTotales * 0.90, tramos, actividadTipo);
        const pesimista = calculateScenario(ingresosMensuales * 0.65, gastosTotales * 1.15, tramos, actividadTipo);

        const elegible = checkElegibilidadTarifaPlana(
            merged.ha_sido_autonomo_antes, merged.fecha_ultimo_alta
        );

        const [updated] = await sql`
            UPDATE reta_pre_onboarding_180 SET
                nombre_prospecto = ${merged.nombre_prospecto || actual.nombre_prospecto},
                nif = ${data.nif !== undefined ? data.nif : actual.nif},
                actividad_tipo = ${actividadTipo},
                sector = ${data.sector !== undefined ? data.sector : actual.sector},
                epigrafes_iae = ${data.epigrafes_iae || actual.epigrafes_iae},
                ingresos_mensuales_estimados = ${ingresosMensuales},
                gastos_fijos_mensuales = ${gastosFijos},
                gastos_variables_pct = ${gastosVariablesPct},
                tiene_empleados = ${merged.tiene_empleados},
                coste_empleados_mensual = ${costeEmpleados},
                tiene_local = ${merged.tiene_local},
                alquiler_mensual = ${alquiler},
                ha_sido_autonomo_antes = ${merged.ha_sido_autonomo_antes},
                fecha_ultimo_alta = ${merged.fecha_ultimo_alta},
                rendimiento_neto_anterior = ${merged.rendimiento_neto_anterior},
                elegible_tarifa_plana = ${elegible},
                resultado_optimista = ${JSON.stringify(optimista)},
                resultado_realista = ${JSON.stringify(realista)},
                resultado_pesimista = ${JSON.stringify(pesimista)},
                tramo_recomendado = ${realista.tramo},
                base_recomendada = ${realista.baseRecomendada},
                cuota_estimada = ${realista.cuota},
                estado = 'completado',
                updated_at = NOW()
            WHERE id = ${id}
            RETURNING *
        `;

        return {
            preOnboarding: updated,
            escenarios: { optimista, realista, pesimista },
            elegibleTarifaPlana: elegible,
        };
    },

    /**
     * Vincular pre-onboarding a una empresa real (cuando el prospecto se da de alta)
     */
    async vincular(id, empresaId) {
        const [updated] = await sql`
            UPDATE reta_pre_onboarding_180 SET
                empresa_id = ${empresaId},
                estado = 'vinculado_cliente',
                updated_at = NOW()
            WHERE id = ${id}
            RETURNING *
        `;

        if (!updated) throw new Error("Pre-onboarding no encontrado");

        // Crear perfil RETA inicial basado en el pre-onboarding
        const ejercicio = new Date().getFullYear();
        await sql`
            INSERT INTO reta_autonomo_perfil_180 (
                empresa_id, ejercicio,
                sector_actividad, epigrafes_iae,
                tarifa_plana_activa, tarifa_plana_inicio
            ) VALUES (
                ${empresaId}, ${ejercicio},
                ${updated.sector}, ${updated.epigrafes_iae},
                ${updated.elegible_tarifa_plana}, ${updated.elegible_tarifa_plana ? new Date().toISOString().slice(0, 10) : null}
            )
            ON CONFLICT (empresa_id, ejercicio) DO UPDATE SET
                sector_actividad = EXCLUDED.sector_actividad,
                epigrafes_iae = EXCLUDED.epigrafes_iae,
                updated_at = NOW()
        `;

        return updated;
    },

    /**
     * Obtener comparacion anonimizada con perfiles similares
     */
    async getComparacionSector(sector, ejercicio) {
        if (!sector) return null;

        const resultado = await sql`
            SELECT
                COUNT(*) as muestra,
                AVG(rendimiento_neto_mensual) as avg_rendimiento_mensual,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY rendimiento_neto_mensual) as p25,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY rendimiento_neto_mensual) as mediana,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY rendimiento_neto_mensual) as p75,
                AVG(cuota_recomendada) as avg_cuota,
                MODE() WITHIN GROUP (ORDER BY tramo_recomendado) as tramo_mas_comun
            FROM reta_estimaciones_180 e
            JOIN reta_autonomo_perfil_180 p ON p.empresa_id = e.empresa_id AND p.ejercicio = e.ejercicio
            WHERE p.sector_actividad = ${sector}
            AND e.ejercicio = ${ejercicio}
            AND e.meses_datos_reales >= 6
        `;

        const [r] = resultado;
        if (!r || parseInt(r.muestra) < 5) return null; // Umbral de privacidad

        return {
            muestra: parseInt(r.muestra),
            rendimientoMensualMedio: Math.round(parseFloat(r.avg_rendimiento_mensual) * 100) / 100,
            percentil25: Math.round(parseFloat(r.p25) * 100) / 100,
            mediana: Math.round(parseFloat(r.mediana) * 100) / 100,
            percentil75: Math.round(parseFloat(r.p75) * 100) / 100,
            cuotaMedia: Math.round(parseFloat(r.avg_cuota) * 100) / 100,
            tramoMasComun: parseInt(r.tramo_mas_comun),
        };
    },
};

// ============================================================
// FUNCIONES INTERNAS
// ============================================================

function calculateScenario(ingresosMensuales, gastosMensuales, tramos, actividadTipo) {
    const ingresosAnual = ingresosMensuales * 12;
    const gastosAnual = gastosMensuales * 12;
    const rendimientoNeto = ingresosAnual - gastosAnual;

    // Deduccion 7% (simplificada) - no aplica a actividades empresariales en directa normal
    const deduccionPct = actividadTipo === 'empresarial_societario' ? 0.03 : 0.07;
    const deduccion = Math.max(0, rendimientoNeto * deduccionPct);
    const rendimientoReducido = Math.max(0, rendimientoNeto - deduccion);
    const rendimientoMensual = rendimientoReducido / 12;

    const base = RetaEngine.calculateOptimalBase(rendimientoMensual, tramos);

    return {
        ingresosMensuales: Math.round(ingresosMensuales * 100) / 100,
        gastosMensuales: Math.round(gastosMensuales * 100) / 100,
        ingresosAnual: Math.round(ingresosAnual * 100) / 100,
        gastosAnual: Math.round(gastosAnual * 100) / 100,
        rendimientoNeto: Math.round(rendimientoNeto * 100) / 100,
        rendimientoReducido: Math.round(rendimientoReducido * 100) / 100,
        rendimientoMensual: Math.round(rendimientoMensual * 100) / 100,
        tramo: base.tramo,
        baseRecomendada: base.baseRecomendada,
        cuota: base.cuota,
        cuotaAnual: Math.round(base.cuota * 12 * 100) / 100,
    };
}

function checkElegibilidadTarifaPlana(haSidoAutonomoAntes, fechaUltimoAlta) {
    if (!haSidoAutonomoAntes) return true;

    // Elegible si han pasado al menos 2 anos desde el ultimo alta
    if (fechaUltimoAlta) {
        const ultimaAlta = new Date(fechaUltimoAlta);
        const hoy = new Date();
        const anosTranscurridos = (hoy - ultimaAlta) / (365.25 * 24 * 60 * 60 * 1000);
        return anosTranscurridos >= 2;
    }

    return false;
}
