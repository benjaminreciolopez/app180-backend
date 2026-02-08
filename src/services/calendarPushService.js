import { getCalendarConfig } from './googleCalendarService.js';
import { syncToGoogle } from './calendarSyncService.js';
import { sql } from '../db.js';

/**
 * Servicio de Push para Google Calendar
 * Gestiona el envío automático de cambios a Google
 */

/**
 * Disparar sincronización automática de un evento específico
 * @param {string} empresaId 
 * @param {string} source - 'calendario_empresa' o 'ausencias'
 * @param {string} eventId 
 */
export async function autoPushToGoogle(empresaId, source, eventId) {
    try {
        // 1. Verificar si la empresa tiene habilitada la sincronización
        const config = await getCalendarConfig(empresaId);
        if (!config || !config.sync_enabled || !config.oauth2_refresh_token) {
            return; // No hacer nada si no está configurado o habilitado
        }

        console.log(`🚀 [Push] Disparando auto-sync para ${source}:${eventId} (Empresa: ${empresaId})`);

        // 2. Obtener el rango de fechas para la sync (el día del evento)
        let dateFrom, dateTo;

        if (source === 'calendario_empresa') {
            const rows = await sql`SELECT fecha FROM calendario_empresa_180 WHERE id = ${eventId}`;
            if (rows.length === 0) return;
            dateFrom = rows[0].fecha.toISOString().split('T')[0];
            dateTo = dateFrom;
        } else if (source === 'ausencias') {
            const rows = await sql`SELECT fecha_inicio, fecha_fin FROM ausencias_180 WHERE id = ${eventId}`;
            if (rows.length === 0) return;
            dateFrom = rows[0].fecha_inicio.toISOString().split('T')[0];
            dateTo = rows[0].fecha_fin.toISOString().split('T')[0];
        } else {
            return;
        }

        // 3. Ejecutar la sincronización existente para el rango afectado
        // Se lanza en segundo plano (sin esperar el await del proceso pesado aquí para no bloquear el API)
        syncToGoogle(empresaId, {
            dateFrom,
            dateTo,
            userId: null,
            sync_type: 'auto_push_event'
        }).catch(err => {
            console.error(`❌ [Push Error] Error en sync automática para ${source}:${eventId}:`, err);
        });

    } catch (err) {
        console.error(`❌ [Push Error] Error crítico en autoPushToGoogle:`, err);
    }
}
