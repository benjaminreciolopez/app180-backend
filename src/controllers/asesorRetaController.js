/**
 * Controller RETA - Endpoints para gestion de base de cotizacion autonomos
 */

import { sql } from "../db.js";
import { RetaEngine } from "../services/retaEstimationEngine.js";
import { RetaPreOnboarding } from "../services/retaPreOnboardingService.js";

// ============================================================
// DASHBOARD RETA (vista consolidada)
// ============================================================

export async function getRetaDashboard(req, res) {
    try {
        const asesoriaId = req.user.empresa_id;

        // Obtener todas las empresas autonomas vinculadas
        const empresas = await sql`
            SELECT e.id, e.nombre, e.nif_cif,
                   p.base_cotizacion_actual, p.cuota_mensual_actual, p.tramo_actual,
                   p.tarifa_plana_activa, p.perfil_estacionalidad, p.sector_actividad,
                   est.tramo_recomendado, est.base_recomendada, est.cuota_recomendada,
                   est.riesgo_regularizacion_anual, est.confianza_pct,
                   est.rendimiento_neto_mensual, est.fecha_calculo,
                   (SELECT COUNT(*) FROM reta_alertas_180 a
                    WHERE a.empresa_id = e.id AND a.ejercicio = ${new Date().getFullYear()}
                    AND a.leida = false AND a.descartada = false) as alertas_pendientes
            FROM empresa_180 e
            JOIN asesoria_vinculos_180 v ON v.empresa_id = e.id AND v.asesoria_id = ${asesoriaId} AND v.estado = 'activo'
            LEFT JOIN reta_autonomo_perfil_180 p ON p.empresa_id = e.id AND p.ejercicio = ${new Date().getFullYear()}
            LEFT JOIN LATERAL (
                SELECT * FROM reta_estimaciones_180
                WHERE empresa_id = e.id AND ejercicio = ${new Date().getFullYear()}
                ORDER BY fecha_calculo DESC LIMIT 1
            ) est ON true
            WHERE e.tipo_contribuyente = 'autonomo'
            AND e.activo = true
            ORDER BY COALESCE(ABS(est.riesgo_regularizacion_anual), 0) DESC
        `;

        // Resumen global
        const totalClientes = empresas.length;
        const conRiesgoAlto = empresas.filter(e =>
            Math.abs(parseFloat(e.riesgo_regularizacion_anual || 0)) > 500
        ).length;
        const conAlertasPendientes = empresas.filter(e => parseInt(e.alertas_pendientes) > 0).length;
        const sinEstimacion = empresas.filter(e => !e.fecha_calculo).length;

        res.json({
            resumen: { totalClientes, conRiesgoAlto, conAlertasPendientes, sinEstimacion },
            clientes: empresas.map(e => ({
                empresaId: e.id,
                nombre: e.nombre,
                nifCif: e.nif_cif,
                baseActual: e.base_cotizacion_actual ? parseFloat(e.base_cotizacion_actual) : null,
                cuotaActual: e.cuota_mensual_actual ? parseFloat(e.cuota_mensual_actual) : null,
                tramoActual: e.tramo_actual,
                tarifaPlana: e.tarifa_plana_activa,
                tramoRecomendado: e.tramo_recomendado,
                baseRecomendada: e.base_recomendada ? parseFloat(e.base_recomendada) : null,
                cuotaRecomendada: e.cuota_recomendada ? parseFloat(e.cuota_recomendada) : null,
                riesgoRegularizacion: e.riesgo_regularizacion_anual ? parseFloat(e.riesgo_regularizacion_anual) : null,
                confianza: e.confianza_pct,
                rendimientoMensual: e.rendimiento_neto_mensual ? parseFloat(e.rendimiento_neto_mensual) : null,
                ultimaEstimacion: e.fecha_calculo,
                alertasPendientes: parseInt(e.alertas_pendientes),
                sector: e.sector_actividad,
                estacionalidad: e.perfil_estacionalidad,
            })),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ============================================================
// ESTIMACION
// ============================================================

export async function getEstimacion(req, res) {
    try {
        const { empresa_id } = req.params;
        const ejercicio = parseInt(req.query.ejercicio) || new Date().getFullYear();

        const [estimacion] = await sql`
            SELECT * FROM reta_estimaciones_180
            WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio}
            ORDER BY fecha_calculo DESC LIMIT 1
        `;

        if (!estimacion) {
            return res.json({ estimacion: null, mensaje: "No hay estimaciones para este ejercicio." });
        }

        const perfil = await RetaEngine.getPerfil(empresa_id, ejercicio);
        const tramos = await RetaEngine.getTramosForYear(ejercicio);
        const eventos = await RetaEngine.getEventos(empresa_id, ejercicio);
        const proximaVentana = RetaEngine.getNextChangeWindow(ejercicio);

        res.json({
            estimacion,
            perfil,
            tramos,
            eventos,
            proximaVentana,
            recomendacionCambio: RetaEngine.recommendBaseChange(estimacion, perfil, ejercicio),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function generarEstimacion(req, res) {
    try {
        const { empresa_id } = req.params;
        const ejercicio = parseInt(req.body.ejercicio) || new Date().getFullYear();
        const { metodo, ajustesManuales } = req.body;

        const resultado = await RetaEngine.generateFullEstimation(empresa_id, ejercicio, {
            metodo: metodo || 'auto',
            ajustesManuales,
            creadoPor: req.user.id,
            tipoCreador: 'asesor',
        });

        res.json(resultado);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function getHistorico(req, res) {
    try {
        const { empresa_id } = req.params;
        const ejercicio = parseInt(req.query.ejercicio) || new Date().getFullYear();

        const estimaciones = await sql`
            SELECT id, fecha_calculo, metodo_proyeccion,
                   ingresos_proyectados_anual, gastos_proyectados_anual,
                   rendimiento_neto_mensual, tramo_recomendado,
                   base_recomendada, cuota_recomendada,
                   riesgo_regularizacion_anual, confianza_pct,
                   tipo_creador
            FROM reta_estimaciones_180
            WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio}
            ORDER BY fecha_calculo DESC
            LIMIT 50
        `;

        res.json({ estimaciones });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ============================================================
// PERFIL AUTONOMO
// ============================================================

export async function getPerfil(req, res) {
    try {
        const { empresa_id } = req.params;
        const ejercicio = parseInt(req.query.ejercicio) || new Date().getFullYear();
        const perfil = await RetaEngine.getPerfil(empresa_id, ejercicio);
        res.json({ perfil });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function updatePerfil(req, res) {
    try {
        const { empresa_id } = req.params;
        const ejercicio = parseInt(req.body.ejercicio) || new Date().getFullYear();
        const {
            es_societario, es_pluriactividad, regimen_estimacion,
            tarifa_plana_activa, tarifa_plana_inicio, tarifa_plana_fin, tarifa_plana_importe,
            base_cotizacion_actual, tramo_actual, cuota_mensual_actual,
            perfil_estacionalidad, meses_baja_actividad,
            sector_actividad, epigrafes_iae, discapacidad_pct, notas,
        } = req.body;

        const [updated] = await sql`
            UPDATE reta_autonomo_perfil_180 SET
                es_societario = COALESCE(${es_societario}, es_societario),
                es_pluriactividad = COALESCE(${es_pluriactividad}, es_pluriactividad),
                regimen_estimacion = COALESCE(${regimen_estimacion}, regimen_estimacion),
                tarifa_plana_activa = COALESCE(${tarifa_plana_activa}, tarifa_plana_activa),
                tarifa_plana_inicio = COALESCE(${tarifa_plana_inicio}, tarifa_plana_inicio),
                tarifa_plana_fin = COALESCE(${tarifa_plana_fin}, tarifa_plana_fin),
                tarifa_plana_importe = COALESCE(${tarifa_plana_importe}, tarifa_plana_importe),
                base_cotizacion_actual = COALESCE(${base_cotizacion_actual}, base_cotizacion_actual),
                tramo_actual = COALESCE(${tramo_actual}, tramo_actual),
                cuota_mensual_actual = COALESCE(${cuota_mensual_actual}, cuota_mensual_actual),
                perfil_estacionalidad = COALESCE(${perfil_estacionalidad}, perfil_estacionalidad),
                meses_baja_actividad = COALESCE(${meses_baja_actividad}, meses_baja_actividad),
                sector_actividad = COALESCE(${sector_actividad}, sector_actividad),
                epigrafes_iae = COALESCE(${epigrafes_iae}, epigrafes_iae),
                discapacidad_pct = COALESCE(${discapacidad_pct}, discapacidad_pct),
                notas = COALESCE(${notas}, notas),
                updated_at = NOW()
            WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio}
            RETURNING *
        `;

        if (!updated) {
            return res.status(404).json({ error: "Perfil no encontrado" });
        }

        res.json({ perfil: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ============================================================
// EVENTOS
// ============================================================

export async function createEvento(req, res) {
    try {
        const { empresa_id } = req.params;
        const ejercicio = parseInt(req.body.ejercicio) || new Date().getFullYear();
        const { tipo, fecha_inicio, fecha_fin, impacto_ingresos, impacto_gastos, descripcion, datos_extra } = req.body;

        if (!tipo || !fecha_inicio) {
            return res.status(400).json({ error: "tipo y fecha_inicio son obligatorios" });
        }

        const [evento] = await sql`
            INSERT INTO reta_eventos_180 (
                empresa_id, ejercicio, tipo, fecha_inicio, fecha_fin,
                impacto_ingresos, impacto_gastos, descripcion, datos_extra
            ) VALUES (
                ${empresa_id}, ${ejercicio}, ${tipo}, ${fecha_inicio}, ${fecha_fin || null},
                ${impacto_ingresos || 0}, ${impacto_gastos || 0},
                ${descripcion || null}, ${datos_extra ? JSON.stringify(datos_extra) : null}
            )
            RETURNING *
        `;

        res.json({ evento });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function deleteEvento(req, res) {
    try {
        const { empresa_id, id } = req.params;

        const [deleted] = await sql`
            UPDATE reta_eventos_180 SET activo = false
            WHERE id = ${id} AND empresa_id = ${empresa_id}
            RETURNING id
        `;

        if (!deleted) return res.status(404).json({ error: "Evento no encontrado" });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ============================================================
// CAMBIOS DE BASE
// ============================================================

export async function getCambiosBase(req, res) {
    try {
        const { empresa_id } = req.params;
        const ejercicio = parseInt(req.query.ejercicio) || new Date().getFullYear();

        const cambios = await sql`
            SELECT * FROM reta_cambios_base_180
            WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio}
            ORDER BY fecha_efectiva DESC
        `;

        res.json({ cambios });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function createCambioBase(req, res) {
    try {
        const { empresa_id } = req.params;
        const ejercicio = parseInt(req.body.ejercicio) || new Date().getFullYear();
        const { base_nueva, motivo } = req.body;

        if (!base_nueva) {
            return res.status(400).json({ error: "base_nueva es obligatorio" });
        }

        const perfil = await RetaEngine.getPerfil(empresa_id, ejercicio);
        const ventana = RetaEngine.getNextChangeWindow(ejercicio);

        // Determinar tramo nuevo
        const tramos = await RetaEngine.getTramosForYear(ejercicio);
        let tramoNuevo = 1;
        for (const t of tramos) {
            if (base_nueva >= t.baseMin && base_nueva <= t.baseMax) {
                tramoNuevo = t.tramo;
                break;
            }
        }

        // Obtener ultima estimacion para vincular
        const [ultimaEst] = await sql`
            SELECT id FROM reta_estimaciones_180
            WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio}
            ORDER BY fecha_calculo DESC LIMIT 1
        `;

        const [cambio] = await sql`
            INSERT INTO reta_cambios_base_180 (
                empresa_id, ejercicio,
                base_anterior, base_nueva,
                tramo_anterior, tramo_nuevo,
                fecha_efectiva, fecha_solicitud, fecha_limite_solicitud,
                motivo, estimacion_id, solicitado_por
            ) VALUES (
                ${empresa_id}, ${ejercicio},
                ${perfil.base_cotizacion_actual || 0}, ${base_nueva},
                ${perfil.tramo_actual}, ${tramoNuevo},
                ${ventana.fechaEfectiva}, ${new Date().toISOString().slice(0, 10)}, ${ventana.fechaLimite},
                ${motivo || null}, ${ultimaEst?.id || null}, ${req.user.id}
            )
            RETURNING *
        `;

        // Actualizar perfil con la nueva base (si se confirma)
        await sql`
            UPDATE reta_autonomo_perfil_180 SET
                base_cotizacion_actual = ${base_nueva},
                tramo_actual = ${tramoNuevo},
                cuota_mensual_actual = ${Math.round(base_nueva * (tramos[0]?.tipoCotizacion || 31.20) / 100 * 100) / 100},
                updated_at = NOW()
            WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio}
        `;

        res.json({ cambio });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ============================================================
// SIMULACION
// ============================================================

export async function getSimulacion(req, res) {
    try {
        const { empresa_id } = req.params;
        const ejercicio = parseInt(req.query.ejercicio) || new Date().getFullYear();
        const variacionIngresosPct = parseFloat(req.query.variacion_ingresos || 0);
        const variacionGastosPct = parseFloat(req.query.variacion_gastos || 0);

        const resultado = await RetaEngine.simulate(empresa_id, ejercicio, {
            variacionIngresosPct,
            variacionGastosPct,
        });

        if (!resultado) {
            return res.status(404).json({ error: "No hay estimaciones previas para simular" });
        }

        res.json(resultado);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ============================================================
// PRE-ONBOARDING
// ============================================================

export async function createPreOnboarding(req, res) {
    try {
        const asesoriaId = req.user.empresa_id;
        const resultado = await RetaPreOnboarding.create(asesoriaId, req.body);
        res.json(resultado);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function getPreOnboarding(req, res) {
    try {
        const { id } = req.params;
        const [preOnboarding] = await sql`
            SELECT * FROM reta_pre_onboarding_180 WHERE id = ${id}
        `;
        if (!preOnboarding) return res.status(404).json({ error: "No encontrado" });

        // Comparacion sectorial si aplica
        const comparacion = await RetaPreOnboarding.getComparacionSector(
            preOnboarding.sector, new Date().getFullYear()
        );

        res.json({ preOnboarding, comparacion });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function updatePreOnboarding(req, res) {
    try {
        const { id } = req.params;
        const resultado = await RetaPreOnboarding.update(id, req.body);
        res.json(resultado);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function vincularPreOnboarding(req, res) {
    try {
        const { id } = req.params;
        const { empresa_id } = req.body;
        if (!empresa_id) return res.status(400).json({ error: "empresa_id es obligatorio" });

        const resultado = await RetaPreOnboarding.vincular(id, empresa_id);
        res.json({ vinculado: resultado });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function listPreOnboarding(req, res) {
    try {
        const asesoriaId = req.user.empresa_id;

        const lista = await sql`
            SELECT po.*, e.nombre as empresa_nombre
            FROM reta_pre_onboarding_180 po
            LEFT JOIN empresa_180 e ON e.id = po.empresa_id
            WHERE po.asesoria_id = ${asesoriaId}
            ORDER BY po.created_at DESC
            LIMIT 100
        `;

        res.json({ preOnboardings: lista });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ============================================================
// ALERTAS
// ============================================================

export async function getAlertas(req, res) {
    try {
        const asesoriaId = req.user.empresa_id;
        const ejercicio = parseInt(req.query.ejercicio) || new Date().getFullYear();

        const alertas = await sql`
            SELECT a.*, e.nombre as empresa_nombre
            FROM reta_alertas_180 a
            JOIN empresa_180 e ON e.id = a.empresa_id
            JOIN asesoria_vinculos_180 v ON v.empresa_id = e.id AND v.asesoria_id = ${asesoriaId} AND v.estado = 'activo'
            WHERE a.ejercicio = ${ejercicio}
            AND a.descartada = false
            ORDER BY
                CASE a.severidad WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                a.created_at DESC
            LIMIT 200
        `;

        res.json({ alertas });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function marcarAlertaLeida(req, res) {
    try {
        const { id } = req.params;
        await sql`UPDATE reta_alertas_180 SET leida = true WHERE id = ${id}`;
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ============================================================
// TRAMOS (referencia)
// ============================================================

export async function getTramosReferencia(req, res) {
    try {
        const ejercicio = parseInt(req.params.ejercicio) || new Date().getFullYear();
        const tramos = await RetaEngine.getTramosForYear(ejercicio);
        res.json({ tramos, ejercicio });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
