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
        const asesoriaId = req.user.asesoria_id;
        const ejercicio = new Date().getFullYear();

        // Obtener empresa propia de la asesoria (si es autonomo, aparece en RETA)
        const [asesoria] = await sql`
            SELECT empresa_id FROM asesorias_180 WHERE id = ${asesoriaId}
        `;
        const asesoriaEmpresaId = asesoria?.empresa_id || null;

        // Obtener todas las empresas: clientes vinculados + empresa propia de la asesoria
        const empresas = await sql`
            SELECT e.id, e.nombre, e.tipo_contribuyente,
                   p.base_cotizacion_actual, p.cuota_mensual_actual, p.tramo_actual,
                   p.tarifa_plana_activa, p.perfil_estacionalidad, p.sector_actividad,
                   est.tramo_recomendado, est.base_recomendada, est.cuota_recomendada,
                   est.riesgo_regularizacion_anual, est.confianza_pct,
                   est.rendimiento_neto_mensual, est.fecha_calculo,
                   (SELECT COUNT(*) FROM reta_alertas_180 a
                    WHERE a.empresa_id = e.id AND a.ejercicio = ${ejercicio}
                    AND a.leida = false AND a.descartada = false) as alertas_pendientes,
                   CASE WHEN e.id = ${asesoriaEmpresaId} THEN true ELSE false END as es_propia
            FROM empresa_180 e
            LEFT JOIN asesoria_clientes_180 v ON v.empresa_id = e.id AND v.asesoria_id = ${asesoriaId} AND v.estado = 'activo'
            LEFT JOIN reta_autonomo_perfil_180 p ON p.empresa_id = e.id AND p.ejercicio = ${ejercicio}
            LEFT JOIN LATERAL (
                SELECT * FROM reta_estimaciones_180
                WHERE empresa_id = e.id AND ejercicio = ${ejercicio}
                ORDER BY fecha_calculo DESC LIMIT 1
            ) est ON true
            WHERE e.activo = true
              AND (v.id IS NOT NULL OR e.id = ${asesoriaEmpresaId})
            ORDER BY COALESCE(ABS(est.riesgo_regularizacion_anual), 0) DESC
        `;

        // Obtener titulares autónomos de TODAS las empresas (vinculadas + propia)
        const titularesAutonomos = await sql`
            SELECT t.id as titular_id, t.nombre as titular_nombre, t.nif as titular_nif,
                   t.empresa_id, e.nombre as empresa_nombre,
                   e.tipo_contribuyente,
                   tp.base_cotizacion_actual, tp.cuota_mensual_actual, tp.tramo_actual,
                   tp.tarifa_plana_activa, tp.perfil_estacionalidad, tp.sector_actividad,
                   te.tramo_recomendado, te.base_recomendada, te.cuota_recomendada,
                   te.riesgo_regularizacion_anual, te.confianza_pct,
                   te.rendimiento_neto_mensual, te.fecha_calculo,
                   (SELECT COUNT(*) FROM reta_alertas_180 a
                    WHERE a.titular_id = t.id AND a.ejercicio = ${ejercicio}
                    AND a.leida = false AND a.descartada = false) as alertas_pendientes
            FROM titulares_empresa_180 t
            JOIN empresa_180 e ON e.id = t.empresa_id
            LEFT JOIN asesoria_clientes_180 v ON v.empresa_id = e.id AND v.asesoria_id = ${asesoriaId} AND v.estado = 'activo'
            LEFT JOIN reta_autonomo_perfil_180 tp ON tp.titular_id = t.id AND tp.ejercicio = ${ejercicio}
            LEFT JOIN LATERAL (
                SELECT * FROM reta_estimaciones_180
                WHERE titular_id = t.id AND ejercicio = ${ejercicio}
                ORDER BY fecha_calculo DESC LIMIT 1
            ) te ON true
            WHERE t.activo = true AND t.regimen_ss = 'autonomo' AND e.activo = true
              AND (v.id IS NOT NULL OR e.id = ${asesoriaEmpresaId})
            ORDER BY COALESCE(ABS(te.riesgo_regularizacion_anual), 0) DESC
        `;

        // Empresas directamente autónomas (tipo_contribuyente = 'autonomo')
        const autonomosDirectos = empresas.filter(e => e.tipo_contribuyente === 'autonomo');

        // Empresas que tienen titulares autónomos (pero la empresa misma puede no ser 'autonomo')
        const empresasConTitularesAutonomos = new Set(titularesAutonomos.map(t => t.empresa_id));

        // Combinar: una empresa es RETA si es autónoma O tiene titulares autónomos
        const allAutonomoIds = new Set([
            ...autonomosDirectos.map(e => e.id),
            ...empresasConTitularesAutonomos,
        ]);

        const sinConfigurar = empresas.filter(e => !e.tipo_contribuyente && !empresasConTitularesAutonomos.has(e.id) && e.id !== asesoriaEmpresaId);

        // Build unified client list: empresas autónomas directas + titulares autónomos individuales
        const clientesList = [];

        // Add empresas that are directly autonomo (and have NO titulares — if they have titulares, show per-titular)
        for (const e of autonomosDirectos) {
            const titularesDeEstaEmpresa = titularesAutonomos.filter(t => t.empresa_id === e.id);
            if (titularesDeEstaEmpresa.length === 0) {
                // No titulares registrados: show empresa-level RETA data (legacy)
                clientesList.push({
                    empresaId: e.id,
                    titularId: null,
                    nombre: e.nombre,
                    nifCif: null,
                    tipoContribuyente: e.tipo_contribuyente,
                    esTitular: false,
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
                });
            }
            // If has titulares, they'll be added below from titularesAutonomos
        }

        // Add each autónomo titular as a separate entry
        for (const t of titularesAutonomos) {
            clientesList.push({
                empresaId: t.empresa_id,
                titularId: t.titular_id,
                nombre: `${t.titular_nombre} (${t.empresa_nombre})`,
                nifCif: t.titular_nif || null,
                tipoContribuyente: 'autonomo',
                esTitular: true,
                baseActual: t.base_cotizacion_actual ? parseFloat(t.base_cotizacion_actual) : null,
                cuotaActual: t.cuota_mensual_actual ? parseFloat(t.cuota_mensual_actual) : null,
                tramoActual: t.tramo_actual,
                tarifaPlana: t.tarifa_plana_activa,
                tramoRecomendado: t.tramo_recomendado,
                baseRecomendada: t.base_recomendada ? parseFloat(t.base_recomendada) : null,
                cuotaRecomendada: t.cuota_recomendada ? parseFloat(t.cuota_recomendada) : null,
                riesgoRegularizacion: t.riesgo_regularizacion_anual ? parseFloat(t.riesgo_regularizacion_anual) : null,
                confianza: t.confianza_pct,
                rendimientoMensual: t.rendimiento_neto_mensual ? parseFloat(t.rendimiento_neto_mensual) : null,
                ultimaEstimacion: t.fecha_calculo,
                alertasPendientes: parseInt(t.alertas_pendientes || 0),
                sector: t.sector_actividad,
                estacionalidad: t.perfil_estacionalidad,
            });
        }

        // Resumen global
        const totalClientes = clientesList.length;
        const conRiesgoAlto = clientesList.filter(e =>
            Math.abs(parseFloat(e.riesgoRegularizacion || 0)) > 500
        ).length;
        const conAlertasPendientes = clientesList.filter(e => e.alertasPendientes > 0).length;
        const sinEstimacion = clientesList.filter(e => !e.ultimaEstimacion).length;

        res.json({
            resumen: { totalClientes, conRiesgoAlto, conAlertasPendientes, sinEstimacion, sinConfigurar: sinConfigurar.length, totalEmpresas: empresas.length },
            clientes: clientesList,
            sinConfigurar: sinConfigurar.map(e => ({
                empresaId: e.id,
                nombre: e.nombre,
                nifCif: null,
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
        const titular_id = req.query.titular_id || null;

        const [estimacion] = titular_id
            ? await sql`
                SELECT * FROM reta_estimaciones_180
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id = ${titular_id}
                ORDER BY fecha_calculo DESC LIMIT 1
            `
            : await sql`
                SELECT * FROM reta_estimaciones_180
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id IS NULL
                ORDER BY fecha_calculo DESC LIMIT 1
            `;

        if (!estimacion) {
            return res.json({ estimacion: null, mensaje: "No hay estimaciones para este ejercicio." });
        }

        const perfil = await RetaEngine.getPerfil(empresa_id, ejercicio, titular_id);
        const tramos = await RetaEngine.getTramosForYear(ejercicio);
        const eventos = await RetaEngine.getEventos(empresa_id, ejercicio, titular_id);
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
        const { metodo, ajustesManuales, titular_id } = req.body;

        const resultado = await RetaEngine.generateFullEstimation(empresa_id, ejercicio, {
            metodo: metodo || 'auto',
            ajustesManuales,
            creadoPor: req.user.id,
            tipoCreador: 'asesor',
            titularId: titular_id || null,
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
        const titular_id = req.query.titular_id || null;

        const estimaciones = titular_id
            ? await sql`
                SELECT id, fecha_calculo, metodo_proyeccion,
                       ingresos_proyectados_anual, gastos_proyectados_anual,
                       rendimiento_neto_mensual, tramo_recomendado,
                       base_recomendada, cuota_recomendada,
                       riesgo_regularizacion_anual, confianza_pct,
                       tipo_creador, titular_id
                FROM reta_estimaciones_180
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id = ${titular_id}
                ORDER BY fecha_calculo DESC
                LIMIT 50
            `
            : await sql`
                SELECT id, fecha_calculo, metodo_proyeccion,
                       ingresos_proyectados_anual, gastos_proyectados_anual,
                       rendimiento_neto_mensual, tramo_recomendado,
                       base_recomendada, cuota_recomendada,
                       riesgo_regularizacion_anual, confianza_pct,
                       tipo_creador, titular_id
                FROM reta_estimaciones_180
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id IS NULL
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
        const titular_id = req.query.titular_id || null;
        const perfil = await RetaEngine.getPerfil(empresa_id, ejercicio, titular_id);
        res.json({ perfil });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function updatePerfil(req, res) {
    try {
        const { empresa_id } = req.params;
        const ejercicio = parseInt(req.body.ejercicio) || new Date().getFullYear();
        const titular_id = req.body.titular_id || null;
        const {
            es_societario, es_pluriactividad, regimen_estimacion,
            tarifa_plana_activa, tarifa_plana_inicio, tarifa_plana_fin, tarifa_plana_importe,
            base_cotizacion_actual, tramo_actual, cuota_mensual_actual,
            perfil_estacionalidad, meses_baja_actividad,
            sector_actividad, epigrafes_iae, discapacidad_pct, notas,
        } = req.body;

        // Asegurar que el perfil exista para (empresa, ejercicio, titular)
        await RetaEngine.getPerfil(empresa_id, ejercicio, titular_id);

        const [updated] = titular_id
            ? await sql`
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
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id = ${titular_id}
                RETURNING *
            `
            : await sql`
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
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id IS NULL
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
        const titular_id = req.body.titular_id || null;
        const { tipo, fecha_inicio, fecha_fin, impacto_ingresos, impacto_gastos, descripcion, datos_extra } = req.body;

        if (!tipo || !fecha_inicio) {
            return res.status(400).json({ error: "tipo y fecha_inicio son obligatorios" });
        }

        const [evento] = await sql`
            INSERT INTO reta_eventos_180 (
                empresa_id, ejercicio, titular_id, tipo, fecha_inicio, fecha_fin,
                impacto_ingresos, impacto_gastos, descripcion, datos_extra
            ) VALUES (
                ${empresa_id}, ${ejercicio}, ${titular_id}, ${tipo}, ${fecha_inicio}, ${fecha_fin || null},
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
        const titular_id = req.query.titular_id || null;

        const cambios = titular_id
            ? await sql`
                SELECT * FROM reta_cambios_base_180
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id = ${titular_id}
                ORDER BY fecha_efectiva DESC
            `
            : await sql`
                SELECT * FROM reta_cambios_base_180
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id IS NULL
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
        const titular_id = req.body.titular_id || null;
        const { base_nueva, motivo } = req.body;

        if (!base_nueva) {
            return res.status(400).json({ error: "base_nueva es obligatorio" });
        }

        const perfil = await RetaEngine.getPerfil(empresa_id, ejercicio, titular_id);
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

        // Obtener ultima estimacion para vincular (filtrada por titular)
        const [ultimaEst] = titular_id
            ? await sql`
                SELECT id, tramo_recomendado FROM reta_estimaciones_180
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id = ${titular_id}
                ORDER BY fecha_calculo DESC LIMIT 1
            `
            : await sql`
                SELECT id, tramo_recomendado FROM reta_estimaciones_180
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id IS NULL
                ORDER BY fecha_calculo DESC LIMIT 1
            `;

        // Crear como propuesta del asesor (estado por defecto:
        // 'propuesto_pdte_cliente'). El perfil RETA NO se actualiza hasta que
        // el asesor confirme manualmente que la TGSS aplicó el cambio
        // (endpoint confirmCambioBase, tras subida de justificante o
        // confirmación verbal del cliente).
        const [cambio] = await sql`
            INSERT INTO reta_cambios_base_180 (
                empresa_id, ejercicio, titular_id,
                base_anterior, base_nueva,
                tramo_anterior, tramo_nuevo,
                fecha_efectiva, fecha_solicitud, fecha_limite_solicitud,
                motivo, estimacion_id, solicitado_por
            ) VALUES (
                ${empresa_id}, ${ejercicio}, ${titular_id},
                ${perfil.base_cotizacion_actual || 0}, ${base_nueva},
                ${perfil.tramo_actual}, ${tramoNuevo},
                ${ventana.fechaEfectiva}, ${new Date().toISOString().slice(0, 10)}, ${ventana.fechaLimite},
                ${motivo || null}, ${ultimaEst?.id || null}, ${req.user.id}
            )
            RETURNING *
        `;

        // El módulo RETA es exclusivo del asesor — no notificamos al cliente.
        // El asesor avisa al cliente por sus propios canales (mail/whatsapp) y
        // luego importará la resolución TGSS cuando le llegue.

        res.json({ cambio });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * PUT /asesor/reta/clientes/:empresa_id/cambios-base/:id/confirmar
 *
 * El asesor confirma que el cambio de base ya está aplicado en la TGSS
 * (porque el cliente subió justificante o lo verificó verbalmente).
 * Esta es la transición final: pasa a 'confirmado_ss' y APLICA el cambio
 * sobre el perfil RETA del autónomo.
 */
export async function confirmCambioBase(req, res) {
    try {
        const { empresa_id, id } = req.params;

        const [cambio] = await sql`
            SELECT * FROM reta_cambios_base_180
            WHERE id = ${id} AND empresa_id = ${empresa_id}
        `;
        if (!cambio) return res.status(404).json({ error: "Cambio no encontrado" });
        if (cambio.estado === 'confirmado_ss') {
            return res.status(409).json({ error: "Ya estaba confirmado" });
        }
        if (cambio.estado === 'descartado') {
            return res.status(409).json({ error: "El cambio está descartado" });
        }

        const ejercicio = cambio.ejercicio;
        const titular_id = cambio.titular_id;
        const tramoNuevo = cambio.tramo_nuevo;
        const baseNueva = parseFloat(cambio.base_nueva);

        const tramos = await RetaEngine.getTramosForYear(ejercicio);
        const tipoCot = tramos[0]?.tipoCotizacion || 31.20;
        const cuota = Math.round(baseNueva * tipoCot / 100 * 100) / 100;

        // 1) Aplicar al perfil RETA
        if (titular_id) {
            await sql`
                UPDATE reta_autonomo_perfil_180 SET
                    base_cotizacion_actual = ${baseNueva},
                    tramo_actual = ${tramoNuevo},
                    cuota_mensual_actual = ${cuota},
                    updated_at = NOW()
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id = ${titular_id}
            `;
        } else {
            await sql`
                UPDATE reta_autonomo_perfil_180 SET
                    base_cotizacion_actual = ${baseNueva},
                    tramo_actual = ${tramoNuevo},
                    cuota_mensual_actual = ${cuota},
                    updated_at = NOW()
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id IS NULL
            `;
        }

        // 2) Marcar el cambio como confirmado
        const [confirmado] = await sql`
            UPDATE reta_cambios_base_180 SET
                estado = 'confirmado_ss',
                confirmado_at = NOW(),
                confirmado_por = ${req.user.id},
                updated_at = NOW()
            WHERE id = ${id}
            RETURNING *
        `;

        // 2b) Sincronizar gastos recurrentes vinculados al perfil RETA, o
        // auto-crear/vincular si no existían.
        let gastosSincronizados = [];
        let gastoAutoCreado = null;
        try {
            const { syncGastosRecurrentesPerfilReta, crearOrLinkGastoRecurrenteReta } = await import(
                "../services/retaSyncService.js"
            );
            gastosSincronizados = await syncGastosRecurrentesPerfilReta(
                empresa_id,
                ejercicio,
                titular_id,
                cuota
            );
            if (gastosSincronizados.length === 0) {
                const r = await crearOrLinkGastoRecurrenteReta({
                    empresaId: empresa_id,
                    ejercicio,
                    titularId: titular_id,
                    cuotaMensual: cuota,
                });
                if (r.accion !== "ninguna") gastoAutoCreado = r;
            }
        } catch (err) {
            console.error("Error sincronizando/creando gastos recurrentes con RETA:", err);
        }

        // 3) Auto-resolver alertas RETA que dejen de aplicar
        const [ultimaEst] = titular_id
            ? await sql`
                SELECT tramo_recomendado FROM reta_estimaciones_180
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id = ${titular_id}
                ORDER BY fecha_calculo DESC LIMIT 1
            `
            : await sql`
                SELECT tramo_recomendado FROM reta_estimaciones_180
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id IS NULL
                ORDER BY fecha_calculo DESC LIMIT 1
            `;
        const tiposResueltos = ['plazo_cambio_proximo'];
        if (ultimaEst && tramoNuevo === ultimaEst.tramo_recomendado) {
            tiposResueltos.push('desviacion_tramo', 'regularizacion_alta');
        }

        const descartadas = titular_id
            ? await sql`
                UPDATE reta_alertas_180 SET descartada = true, leida = true
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio}
                  AND titular_id = ${titular_id}
                  AND tipo IN ${sql(tiposResueltos)}
                  AND descartada = false
                RETURNING id
            `
            : await sql`
                UPDATE reta_alertas_180 SET descartada = true, leida = true
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio}
                  AND titular_id IS NULL
                  AND tipo IN ${sql(tiposResueltos)}
                  AND descartada = false
                RETURNING id
            `;

        // 4) Apagar notificaciones espejo del asesor
        if (descartadas?.length > 0) {
            const ids = descartadas.map((d) => d.id);
            await sql`
                UPDATE notificaciones_asesor_180
                SET leida = TRUE, leida_at = NOW()
                WHERE asesoria_id = ${req.user.asesoria_id}
                  AND (metadata ->> 'alerta_reta_id')::uuid = ANY(${ids}::uuid[])
                  AND leida = FALSE
            `;
        }

        res.json({
            cambio: confirmado,
            gastos_sincronizados: gastosSincronizados,
            gasto_auto: gastoAutoCreado,
        });
    } catch (err) {
        console.error("confirmCambioBase error:", err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * PUT /asesor/reta/clientes/:empresa_id/cambios-base/:id/descartar
 * Anula un cambio en cualquier estado no confirmado.
 */
export async function descartarCambioBase(req, res) {
    try {
        const { empresa_id, id } = req.params;
        const { motivo } = req.body || {};

        const [cambio] = await sql`
            UPDATE reta_cambios_base_180 SET
                estado = 'descartado',
                motivo = COALESCE(${motivo || null}, motivo),
                updated_at = NOW()
            WHERE id = ${id} AND empresa_id = ${empresa_id}
              AND estado != 'confirmado_ss'
            RETURNING *
        `;
        if (!cambio) return res.status(404).json({ error: "Cambio no encontrado o ya confirmado" });

        res.json({ cambio });
    } catch (err) {
        console.error("descartarCambioBase error:", err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * Extrae base de cotización y fecha de efectos del texto plano de un PDF de
 * resolución TGSS sobre cambio de base de autónomo. Heurístico — si no
 * encuentra los datos devuelve null en cada campo.
 */
const MESES_ES = {
    enero: "01", febrero: "02", marzo: "03", abril: "04",
    mayo: "05", junio: "06", julio: "07", agosto: "08",
    septiembre: "09", setiembre: "09", octubre: "10",
    noviembre: "11", diciembre: "12",
};

function pad2(n) { return String(n).padStart(2, "0"); }

function fechaNumericaToISO(d, m, y) {
    const dd = pad2(d);
    const mm = pad2(m);
    const yyyy = String(y).length === 2 ? "20" + y : String(y);
    if (parseInt(mm) < 1 || parseInt(mm) > 12) return null;
    if (parseInt(dd) < 1 || parseInt(dd) > 31) return null;
    return `${yyyy}-${mm}-${dd}`;
}

function parsearTextoResolucionTGSS(texto) {
    const original = texto || "";
    const t = original.replace(/\s+/g, " ");

    // ========== Base de cotización ==========
    let base = null;
    const patronesBase = [
        /(?:nueva\s+base\s+(?:de\s+cotizaci[oó]n)?|base\s+(?:mensual\s+)?(?:elegida|solicitada|de\s+cotizaci[oó]n))[^\d€]{0,40}?([\d.]{1,9},\d{2})/i,
        /([\d.]{1,9},\d{2})\s*(?:€|euros?)\s*(?:de\s+base|mensuales?\s+de\s+base)/i,
        // Cualquier número con formato moneda dentro de los primeros 800 caracteres
        // — fallback débil; usa solo si no hubo match específico
    ];
    for (const re of patronesBase) {
        const m = t.match(re);
        if (m) {
            const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
            if (!isNaN(n) && n > 0 && n < 100000) { base = n; break; }
        }
    }
    // Fallback: buscar la primera cifra "X.XXX,XX" del documento (suele ser la base)
    if (base == null) {
        const m = t.match(/([\d]{1,3}\.[\d]{3},\d{2}|[\d]{3,5},\d{2})/);
        if (m) {
            const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
            if (!isNaN(n) && n >= 200 && n <= 5000) base = n; // banda de bases plausibles
        }
    }

    // ========== Fecha de efectos ==========
    let fecha = null;

    // 1) Patrones específicos: "efectos desde DD/MM/YYYY" o variantes con guiones / puntos
    const reNumEspecifica = /(?:con\s+efectos?\s+(?:desde\s+(?:el\s+)?|de\s+)?|fecha\s+(?:de\s+)?efectos?\s*:?\s*|surt(?:e|ir[aá]n?)\s+efectos?\s+(?:desde\s+(?:el\s+)?)?|aplicable\s+(?:desde\s+(?:el\s+)?)?|vigencia\s+(?:desde\s+(?:el\s+)?)?|desde\s+el)\s*(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/i;
    let m = t.match(reNumEspecifica);
    if (m) fecha = fechaNumericaToISO(m[1], m[2], m[3]);

    // 2) "1 de junio de 2026" / "01 de Junio del 2026"
    if (!fecha) {
        const reLiteral = /(?:efectos?\s+(?:desde\s+(?:el\s+)?|de\s+)?|fecha\s+(?:de\s+)?efectos?\s*:?\s*|desde\s+el|a\s+partir\s+del?)\s*(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+|del\s+)?(\d{4})/i;
        const m2 = t.match(reLiteral);
        if (m2) {
            const mm = MESES_ES[m2[2].toLowerCase()];
            if (mm) fecha = `${m2[3]}-${mm}-${pad2(m2[1])}`;
        }
    }

    // 3) Formato literal sin etiqueta: "1 de junio de 2026"
    if (!fecha) {
        const m3 = t.match(/(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+|del\s+)?(\d{4})/i);
        if (m3) {
            const mm = MESES_ES[m3[2].toLowerCase()];
            if (mm) fecha = `${m3[3]}-${mm}-${pad2(m3[1])}`;
        }
    }

    // 4) Fallback: primera fecha numérica del documento (las resoluciones TGSS
    //    suelen empezar con la fecha de efectos)
    if (!fecha) {
        const m4 = t.match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
        if (m4) fecha = fechaNumericaToISO(m4[1], m4[2], m4[3]);
    }

    // ========== NIF/NIE/DNI ==========
    let nif = null;
    const reNif = /\b([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z])\b/;
    const m5 = original.match(reNif);
    if (m5) nif = m5[1];

    return { base_nueva: base, fecha_efectiva: fecha, nif };
}

/**
 * POST /asesor/reta/parsear-pdf-cambio-base
 * Recibe un PDF (multipart) y devuelve datos extraídos. NO crea nada en BD.
 * Útil para autorrellenar el formulario antes de importar.
 */
export async function parsearPdfCambioBase(req, res) {
    try {
        if (!req.file) return res.status(400).json({ error: "Falta el PDF" });
        const { extractFullPdfText } = await import("../services/ocr/ocrEngine.js");
        const texto = await extractFullPdfText(req.file.buffer, 5);
        const datos = parsearTextoResolucionTGSS(texto);
        res.json({ datos, longitud_texto: texto.length });
    } catch (err) {
        console.error("parsearPdfCambioBase error:", err);
        res.status(500).json({ error: err.message || "Error parseando PDF" });
    }
}

/**
 * POST /asesor/reta/clientes/:empresa_id/cambios-base/importar
 * El asesor sube directamente el PDF de la resolución TGSS y crea el cambio
 * en estado 'confirmado_ss' (porque el documento de SS ya es la confirmación).
 * Aplica al perfil RETA y sincroniza gastos recurrentes vinculados.
 */
export async function importarCambioBase(req, res) {
    try {
        const { empresa_id } = req.params;
        const ejercicio = parseInt(req.body.ejercicio) || new Date().getFullYear();
        const titular_id = req.body.titular_id || null;
        const baseNueva = parseFloat(req.body.base_nueva);
        const fechaEfectiva = req.body.fecha_efectiva;
        const motivo = req.body.motivo || "Importado por asesor desde resolución TGSS";

        if (!baseNueva || baseNueva <= 0) {
            return res.status(400).json({ error: "base_nueva inválida" });
        }
        if (!fechaEfectiva) {
            return res.status(400).json({ error: "fecha_efectiva es obligatoria" });
        }

        // Subir el PDF si llega
        let justificantePdfUrl = null;
        if (req.file) {
            try {
                const { saveToStorage } = await import("./storageController.js");
                const ext = (req.file.originalname || "").split(".").pop()?.toLowerCase() || "pdf";
                justificantePdfUrl = await saveToStorage({
                    empresaId: empresa_id,
                    folder: "reta",
                    nombre: `reta_resolucion_asesor_${empresa_id}.${ext}`,
                    buffer: req.file.buffer,
                    mimeType: req.file.mimetype,
                });
            } catch (err) {
                console.error("Error subiendo PDF resolución TGSS:", err);
            }
        }

        // Calcular tramo nuevo y cuota
        const perfil = await RetaEngine.getPerfil(empresa_id, ejercicio, titular_id);
        const tramos = await RetaEngine.getTramosForYear(ejercicio);
        let tramoNuevo = 1;
        for (const t of tramos) {
            if (baseNueva >= t.baseMin && baseNueva <= t.baseMax) {
                tramoNuevo = t.tramo;
                break;
            }
        }
        const tipoCot = tramos[0]?.tipoCotizacion || 31.20;
        const cuota = Math.round(baseNueva * tipoCot / 100 * 100) / 100;

        // Insertar registro en estado 'confirmado_ss' con el PDF como justificante
        const ventana = RetaEngine.getNextChangeWindow(ejercicio);
        const [cambio] = await sql`
            INSERT INTO reta_cambios_base_180 (
                empresa_id, ejercicio, titular_id,
                base_anterior, base_nueva,
                tramo_anterior, tramo_nuevo,
                fecha_efectiva, fecha_solicitud, fecha_limite_solicitud,
                motivo, solicitado_por,
                estado, justificante_pdf_url, justificante_uploaded_at,
                confirmado_at, confirmado_por
            ) VALUES (
                ${empresa_id}, ${ejercicio}, ${titular_id},
                ${perfil?.base_cotizacion_actual || 0}, ${baseNueva},
                ${perfil?.tramo_actual || null}, ${tramoNuevo},
                ${fechaEfectiva}, ${new Date().toISOString().slice(0, 10)}, ${ventana.fechaLimite},
                ${motivo}, ${req.user.id},
                'confirmado_ss', ${justificantePdfUrl}, ${justificantePdfUrl ? new Date() : null},
                NOW(), ${req.user.id}
            )
            RETURNING *
        `;

        // Aplicar al perfil RETA
        if (titular_id) {
            await sql`
                UPDATE reta_autonomo_perfil_180 SET
                    base_cotizacion_actual = ${baseNueva},
                    tramo_actual = ${tramoNuevo},
                    cuota_mensual_actual = ${cuota},
                    updated_at = NOW()
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id = ${titular_id}
            `;
        } else {
            await sql`
                UPDATE reta_autonomo_perfil_180 SET
                    base_cotizacion_actual = ${baseNueva},
                    tramo_actual = ${tramoNuevo},
                    cuota_mensual_actual = ${cuota},
                    updated_at = NOW()
                WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio} AND titular_id IS NULL
            `;
        }

        // Sincronizar gastos recurrentes vinculados, o auto-crear/vincular
        // si no existía ninguno.
        let gastosSincronizados = [];
        let gastoAutoCreado = null;
        try {
            const { syncGastosRecurrentesPerfilReta, crearOrLinkGastoRecurrenteReta } = await import(
                "../services/retaSyncService.js"
            );
            gastosSincronizados = await syncGastosRecurrentesPerfilReta(
                empresa_id,
                ejercicio,
                titular_id,
                cuota
            );
            if (gastosSincronizados.length === 0) {
                const r = await crearOrLinkGastoRecurrenteReta({
                    empresaId: empresa_id,
                    ejercicio,
                    titularId: titular_id,
                    cuotaMensual: cuota,
                });
                if (r.accion !== "ninguna") gastoAutoCreado = r;
            }
        } catch (err) {
            console.error("Error sincronizando/creando gastos recurrentes RETA:", err);
        }

        // Auto-resolver alertas RETA equivalentes
        try {
            const tiposResueltos = ['plazo_cambio_proximo', 'desviacion_tramo', 'regularizacion_alta'];
            const descartadas = titular_id
                ? await sql`
                    UPDATE reta_alertas_180 SET descartada = true, leida = true
                    WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio}
                      AND titular_id = ${titular_id}
                      AND tipo IN ${sql(tiposResueltos)}
                      AND descartada = false
                    RETURNING id
                `
                : await sql`
                    UPDATE reta_alertas_180 SET descartada = true, leida = true
                    WHERE empresa_id = ${empresa_id} AND ejercicio = ${ejercicio}
                      AND titular_id IS NULL
                      AND tipo IN ${sql(tiposResueltos)}
                      AND descartada = false
                    RETURNING id
                `;
            if (descartadas?.length > 0) {
                const ids = descartadas.map((d) => d.id);
                await sql`
                    UPDATE notificaciones_asesor_180
                    SET leida = TRUE, leida_at = NOW()
                    WHERE asesoria_id = ${req.user.asesoria_id}
                      AND (metadata ->> 'alerta_reta_id')::uuid = ANY(${ids}::uuid[])
                      AND leida = FALSE
                `;
            }
        } catch (err) {
            console.error("Error auto-resolviendo alertas tras importar:", err);
        }

        res.json({
            cambio,
            gastos_sincronizados: gastosSincronizados,
            gasto_auto: gastoAutoCreado,
        });
    } catch (err) {
        console.error("importarCambioBase error:", err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * POST /asesor/reta/clientes/:empresa_id/cuota-recurrente/crear
 *
 * Crea (o vincula a un candidato existente) un gasto recurrente para la
 * cuota mensual del autónomo, usando los datos del perfil RETA actual.
 * Si ya hay uno vinculado, no hace nada.
 *
 * Body opcional:
 *   - ejercicio (default: año actual)
 *   - titular_id (default: null)
 */
export async function crearCuotaRecurrenteReta(req, res) {
    try {
        const { empresa_id } = req.params;
        const ejercicio = parseInt(req.body?.ejercicio) || new Date().getFullYear();
        const titular_id = req.body?.titular_id || null;

        const perfil = await RetaEngine.getPerfil(empresa_id, ejercicio, titular_id);
        if (!perfil || !perfil.cuota_mensual_actual) {
            return res.status(400).json({
                error: "No hay cuota mensual definida en el perfil RETA. Genera primero la estimación o importa una resolución.",
            });
        }

        let titularNombre = null;
        if (titular_id) {
            try {
                const [t] = await sql`SELECT nombre FROM titulares_180 WHERE id = ${titular_id}`;
                titularNombre = t?.nombre || null;
            } catch { /* tabla puede no existir en algunos despliegues */ }
        }

        const { crearOrLinkGastoRecurrenteReta } = await import(
            "../services/retaSyncService.js"
        );
        const r = await crearOrLinkGastoRecurrenteReta({
            empresaId: empresa_id,
            ejercicio,
            titularId: titular_id,
            cuotaMensual: parseFloat(perfil.cuota_mensual_actual),
            titularNombre,
        });

        // Auto-resolver alerta 'cuota_no_configurada' si existía
        try {
            const descartadas = await sql`
                UPDATE reta_alertas_180 SET descartada = true, leida = true
                WHERE empresa_id = ${empresa_id}
                  AND tipo = 'cuota_no_configurada'
                  AND descartada = false
                RETURNING id
            `;
            if (descartadas?.length > 0) {
                const ids = descartadas.map((d) => d.id);
                await sql`
                    UPDATE notificaciones_asesor_180
                    SET leida = TRUE, leida_at = NOW()
                    WHERE asesoria_id = ${req.user.asesoria_id}
                      AND (metadata ->> 'alerta_reta_id')::uuid = ANY(${ids}::uuid[])
                      AND leida = FALSE
                `;
            }
        } catch (err) {
            console.error("auto-resolve cuota_no_configurada:", err);
        }

        res.json({ resultado: r });
    } catch (err) {
        console.error("crearCuotaRecurrenteReta error:", err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * POST /asesor/reta/scan-alertas
 * Dispara on-demand el escaneo completo de alertas RETA. Útil tras un cambio
 * de configuración (vinculaciones, perfiles) sin esperar al cron diario.
 */
export async function lanzarScanAlertas(req, res) {
    try {
        const { runRetaAlertScan } = await import("../services/retaAlertService.js");
        await runRetaAlertScan();
        // Devuelve el resumen del usuario (cuántas alertas tiene ahora)
        const ejercicio = new Date().getFullYear();
        const [{ pendientes }] = await sql`
            SELECT COUNT(*)::int AS pendientes
            FROM reta_alertas_180 a
            JOIN asesoria_clientes_180 ac ON ac.empresa_id = a.empresa_id AND ac.estado = 'activo'
            WHERE ac.asesoria_id = ${req.user.asesoria_id}
              AND a.ejercicio = ${ejercicio}
              AND a.descartada = false
        `;
        res.json({ ok: true, alertas_pendientes: pendientes });
    } catch (err) {
        console.error("lanzarScanAlertas error:", err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * GET /asesor/reta/cambios-pendientes
 * Bandeja del asesor: cambios comunicados por cliente que esperan revisión,
 * y cambios propuestos por el asesor que el cliente aún no ha aceptado.
 */
export async function getCambiosPendientes(req, res) {
    try {
        const asesoriaId = req.user.asesoria_id;
        if (!asesoriaId) {
            return res.status(403).json({ error: "Solo asesores con asesoría asignada" });
        }

        const cambios = await sql`
            SELECT
                cb.*,
                e.nombre AS empresa_nombre
            FROM reta_cambios_base_180 cb
            JOIN empresa_180 e ON e.id = cb.empresa_id
            JOIN asesoria_clientes_180 ac
              ON ac.empresa_id = cb.empresa_id
              AND ac.asesoria_id = ${asesoriaId}
              AND ac.estado = 'activo'
            WHERE cb.estado IN ('comunicado_pdte_asesor', 'propuesto_pdte_cliente')
            ORDER BY
              CASE cb.estado
                WHEN 'comunicado_pdte_asesor' THEN 1
                WHEN 'propuesto_pdte_cliente' THEN 2
              END,
              cb.created_at DESC
        `;

        res.json({ cambios });
    } catch (err) {
        console.error("getCambiosPendientes error:", err);
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
        const titularId = req.query.titular_id || null;

        const resultado = await RetaEngine.simulate(empresa_id, ejercicio, {
            variacionIngresosPct,
            variacionGastosPct,
            titularId,
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
        const asesoriaId = req.user.asesoria_id;
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
        const asesoriaId = req.user.asesoria_id;

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
        const asesoriaId = req.user.asesoria_id;
        const ejercicio = parseInt(req.query.ejercicio) || new Date().getFullYear();

        const alertas = await sql`
            SELECT a.*, e.nombre as empresa_nombre
            FROM reta_alertas_180 a
            JOIN empresa_180 e ON e.id = a.empresa_id
            JOIN asesoria_clientes_180 v ON v.empresa_id = e.id AND v.asesoria_id = ${asesoriaId} AND v.estado = 'activo'
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

        // Reflejar en el campanario del asesor: marcar la notificación espejo
        // como leída (si existe). El metadata.alerta_reta_id apunta a la alerta.
        await sql`
            UPDATE notificaciones_asesor_180
            SET leida = TRUE, leida_at = NOW()
            WHERE asesoria_id = ${req.user.asesoria_id}
              AND (metadata ->> 'alerta_reta_id')::uuid = ${id}
              AND leida = FALSE
        `;

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
