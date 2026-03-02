/**
 * Fiscal Alert Controller
 * Endpoints for fiscal intelligence alerts and impact simulator.
 */

import { sql } from "../db.js";
import {
    analyzeCurrentQuarter,
    simulateImpact,
    getAlertConfig as getConfig,
    SECTOR_LIST,
} from "../services/fiscalAlertService.js";
import { crearNotificacionSistema } from "./notificacionesController.js";

/**
 * GET /admin/fiscal/alerts?year=2026&trimestre=1
 */
export async function getFiscalAlerts(req, res) {
    try {
        const { year, trimestre } = req.query;
        const empresaId = req.user.empresa_id;

        if (!year || !trimestre) {
            return res.status(400).json({ error: "Año y trimestre requeridos" });
        }

        const y = parseInt(year);
        const q = parseInt(trimestre);
        const data = await analyzeCurrentQuarter(empresaId, y, q);

        // Crear notificaciones para alertas warning/critical (deduplicadas)
        if (data.alerts && data.alerts.length > 0) {
            createAlertNotifications(empresaId, data.alerts, y, q).catch(err =>
                console.error("Error creando notificaciones fiscales:", err)
            );
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error("Error getFiscalAlerts:", error);
        res.status(500).json({ success: false, error: "Error obteniendo alertas fiscales" });
    }
}

/**
 * Crea notificaciones para alertas fiscales (solo warning/critical, deduplicadas)
 */
async function createAlertNotifications(empresaId, alerts, year, quarter) {
    const importantAlerts = alerts.filter(a => a.severity === "warning" || a.severity === "critical");

    for (const alert of importantAlerts) {
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
}

/**
 * POST /admin/fiscal/simulate
 * Body: { year, trimestre, operation: { type: 'factura'|'gasto', base_imponible, iva_pct?, iva_importe? } }
 */
export async function simulateFiscalImpact(req, res) {
    try {
        const { year, trimestre, operation } = req.body;
        const empresaId = req.user.empresa_id;

        if (!year || !trimestre || !operation) {
            return res.status(400).json({ error: "year, trimestre y operation requeridos" });
        }

        if (!operation.type || !['factura', 'gasto'].includes(operation.type)) {
            return res.status(400).json({ error: "operation.type debe ser 'factura' o 'gasto'" });
        }

        if (!operation.base_imponible || parseFloat(operation.base_imponible) <= 0) {
            return res.status(400).json({ error: "operation.base_imponible es requerido y debe ser > 0" });
        }

        const data = await simulateImpact(empresaId, parseInt(year), parseInt(trimestre), operation);
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error simulateFiscalImpact:", error);
        res.status(500).json({ success: false, error: "Error simulando impacto fiscal" });
    }
}

/**
 * GET /admin/fiscal/alert-config
 */
export async function getAlertConfig(req, res) {
    try {
        const empresaId = req.user.empresa_id;
        const config = await getConfig(empresaId);
        res.json({ success: true, data: config, sectors: SECTOR_LIST });
    } catch (error) {
        console.error("Error getAlertConfig:", error);
        res.status(500).json({ success: false, error: "Error obteniendo configuración de alertas" });
    }
}

/**
 * PUT /admin/fiscal/alert-config
 * Body: { sector?, iae_code?, thresholds?, enabled? }
 */
export async function updateAlertConfig(req, res) {
    try {
        const empresaId = req.user.empresa_id;
        const { iae_code, sector, thresholds, enabled } = req.body;

        const newConfig = {};
        if (iae_code !== undefined) newConfig.iae_code = iae_code;
        if (sector !== undefined) newConfig.sector = sector;
        if (thresholds !== undefined) newConfig.thresholds = thresholds;
        if (enabled !== undefined) newConfig.enabled = enabled;

        await sql`
            UPDATE empresa_config_180
            SET fiscal_alert_config = COALESCE(fiscal_alert_config, '{}'::jsonb) || ${JSON.stringify(newConfig)}::jsonb
            WHERE empresa_id = ${empresaId}
        `;

        const config = await getConfig(empresaId);
        res.json({ success: true, data: config, sectors: SECTOR_LIST });
    } catch (error) {
        console.error("Error updateAlertConfig:", error);
        res.status(500).json({ success: false, error: "Error actualizando configuración de alertas" });
    }
}
