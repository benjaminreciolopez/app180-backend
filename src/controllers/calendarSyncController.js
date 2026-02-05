import { sql } from '../db.js';
import {
  syncToGoogle,
  syncFromGoogle,
  syncBidirectional,
  getSyncHistory
} from '../services/calendarSyncService.js';
import { getCalendarConfig } from '../services/googleCalendarService.js';

/**
 * Calendar Sync Controller
 * Maneja endpoints de sincronización manual
 */

/**
 * POST /admin/calendar-sync/to-google
 * Sincronizar APP180 → Google Calendar
 */
export async function handleSyncToGoogle(req, res) {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const empresaId = empresa[0].id;

    // Rango de fechas (por defecto: próximos 12 meses)
    const dateFrom = req.body.dateFrom || new Date().toISOString().split('T')[0];
    const dateTo = req.body.dateTo || (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 12);
      return d.toISOString().split('T')[0];
    })();

    const stats = await syncToGoogle(empresaId, {
      dateFrom,
      dateTo,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: `Sincronización completada: ${stats.created} creados, ${stats.updated} actualizados`,
      stats
    });
  } catch (err) {
    console.error("❌ Error in sync to Google:", err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /admin/calendar-sync/from-google
 * Sincronizar Google Calendar → APP180
 */
export async function handleSyncFromGoogle(req, res) {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const empresaId = empresa[0].id;

    // Rango de fechas (por defecto: próximos 12 meses)
    const dateFrom = req.body.dateFrom || new Date().toISOString().split('T')[0];
    const dateTo = req.body.dateTo || (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 12);
      return d.toISOString().split('T')[0];
    })();

    const stats = await syncFromGoogle(empresaId, {
      dateFrom,
      dateTo,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: `Sincronización completada: ${stats.created} creados, ${stats.updated} actualizados`,
      stats
    });
  } catch (err) {
    console.error("❌ Error in sync from Google:", err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /admin/calendar-sync/bidirectional
 * Sincronización bidireccional
 */
export async function handleSyncBidirectional(req, res) {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const empresaId = empresa[0].id;

    // Rango de fechas (por defecto: próximos 12 meses)
    const dateFrom = req.body.dateFrom || new Date().toISOString().split('T')[0];
    const dateTo = req.body.dateTo || (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 12);
      return d.toISOString().split('T')[0];
    })();

    const stats = await syncBidirectional(empresaId, {
      dateFrom,
      dateTo,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: `Sincronización bidireccional completada: ${stats.total_created} creados, ${stats.total_updated} actualizados`,
      stats
    });
  } catch (err) {
    console.error("❌ Error in bidirectional sync:", err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /admin/calendar-sync/status
 * Obtener estado de sincronización
 */
export async function getStatus(req, res) {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const config = await getCalendarConfig(empresa[0].id);

    if (!config) {
      return res.json({
        configured: false,
        sync_enabled: false
      });
    }

    // Obtener última sincronización
    const lastSync = await sql`
      SELECT * FROM calendar_sync_log_180
      WHERE empresa_id = ${empresa[0].id}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    res.json({
      configured: true,
      sync_enabled: config.sync_enabled,
      last_sync_at: config.last_sync_at,
      last_sync: lastSync[0] || null
    });
  } catch (err) {
    console.error("❌ Error getting sync status:", err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /admin/calendar-sync/history
 * Obtener historial de sincronizaciones
 */
export async function getHistory(req, res) {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const limit = parseInt(req.query.limit) || 20;
    const history = await getSyncHistory(empresa[0].id, limit);

    res.json(history);
  } catch (err) {
    console.error("❌ Error getting sync history:", err);
    res.status(500).json({ error: err.message });
  }
}
