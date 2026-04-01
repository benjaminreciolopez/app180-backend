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
    EPIGRAFES_IAE,
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
    // Alertas que se benefician del simulador de impacto
    const simulatorAlertTypes = ['gastos_ingresos_ratio', 'gasto_spike', 'iva_ratio', 'missing_retentions'];

    for (const alert of alerts) {
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

        const useSimulator = simulatorAlertTypes.includes(alert.alert_type);

        await crearNotificacionSistema({
            empresaId,
            tipo: 'fiscal_alert',
            titulo: `Alerta Fiscal: ${alert.message.substring(0, 80)}`,
            mensaje: alert.recommendation,
            accionUrl: useSimulator
                ? '/admin/fiscal?tab=alertas&openSimulator=true'
                : '/admin/fiscal?tab=alertas',
            accionLabel: useSimulator
                ? '¿Quieres simular el impacto?'
                : 'Ver detalles',
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

        // Cargar epígrafes personalizados de la empresa
        const customEpigrafes = await sql`
            SELECT sector, codigo, descripcion FROM epigrafes_iae_custom_180
            WHERE empresa_id = ${empresaId}
            ORDER BY sector, codigo
        `.catch(() => []);

        // Mergear epígrafes base + custom por sector
        const epigrafes = {};
        for (const sector of SECTOR_LIST) {
            const base = EPIGRAFES_IAE[sector] || [];
            const custom = customEpigrafes.filter(e => e.sector === sector);
            epigrafes[sector] = [...base, ...custom.map(c => ({ codigo: c.codigo, descripcion: c.descripcion, custom: true }))];
        }

        res.json({ success: true, data: config, sectors: SECTOR_LIST, epigrafes });
    } catch (error) {
        console.error("Error getAlertConfig:", error);
        res.status(500).json({ success: false, error: "Error obteniendo configuración de alertas" });
    }
}

/**
 * POST /admin/fiscal/epigrafes
 * Añadir un epígrafe personalizado a un sector
 */
export async function addEpigrafe(req, res) {
    try {
        const empresaId = req.user.empresa_id;
        const { sector, codigo, descripcion } = req.body;

        if (!sector || !codigo || !descripcion) {
            return res.status(400).json({ error: "Sector, código y descripción son obligatorios" });
        }

        await sql`
            INSERT INTO epigrafes_iae_custom_180 (empresa_id, sector, codigo, descripcion)
            VALUES (${empresaId}, ${sector}, ${codigo.trim()}, ${descripcion.trim()})
            ON CONFLICT (empresa_id, sector, codigo) DO UPDATE SET descripcion = ${descripcion.trim()}
        `;

        res.json({ success: true });
    } catch (error) {
        console.error("Error addEpigrafe:", error);
        res.status(500).json({ error: "Error añadiendo epígrafe" });
    }
}

/**
 * DELETE /admin/fiscal/epigrafes/:codigo?sector=xxx
 * Eliminar un epígrafe personalizado
 */
export async function deleteEpigrafe(req, res) {
    try {
        const empresaId = req.user.empresa_id;
        const { codigo } = req.params;
        const { sector } = req.query;

        await sql`
            DELETE FROM epigrafes_iae_custom_180
            WHERE empresa_id = ${empresaId} AND codigo = ${codigo} AND sector = ${sector}
        `;

        res.json({ success: true });
    } catch (error) {
        console.error("Error deleteEpigrafe:", error);
        res.status(500).json({ error: "Error eliminando epígrafe" });
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

        // Leer config actual como objeto (protección contra datos corrompidos)
        const [row] = await sql`
            SELECT fiscal_alert_config FROM empresa_config_180
            WHERE empresa_id = ${empresaId}
        `;
        let raw = row?.fiscal_alert_config;
        let current = {};
        if (raw) {
            if (typeof raw === 'string') {
                try { current = JSON.parse(raw); } catch { current = {}; }
            } else if (typeof raw === 'object' && !Array.isArray(raw)) {
                current = raw;
            }
        }

        // Mergear campos
        if (iae_code !== undefined) current.iae_code = iae_code;
        if (sector !== undefined) current.sector = sector;
        if (enabled !== undefined) current.enabled = enabled;
        if (thresholds !== undefined) {
            current.thresholds = { ...(current.thresholds || {}), ...thresholds };
        }

        // Usar sql.json() para asegurar que se guarda como JSONB objeto, no string
        await sql`
            UPDATE empresa_config_180
            SET fiscal_alert_config = ${sql.json(current)}
            WHERE empresa_id = ${empresaId}
        `;

        const config = await getConfig(empresaId);
        res.json({ success: true, data: config, sectors: SECTOR_LIST });
    } catch (error) {
        console.error("Error updateAlertConfig:", error);
        res.status(500).json({ success: false, error: "Error actualizando configuración de alertas" });
    }
}
