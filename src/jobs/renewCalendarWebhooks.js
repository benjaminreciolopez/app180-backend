import { sql } from '../db.js';
import { stopCalendarWebhook, setupCalendarWebhook } from '../services/googleCalendarService.js';

/**
 * Cronjob: Renovar webhooks de Google Calendar
 * Los webhooks de Google expiran después de ~7 días
 * Este job se ejecuta diariamente para renovar los que están por expirar
 */

export async function renewCalendarWebhooks() {
  try {
    console.log('🔄 [CRON] Verificando webhooks de Google Calendar...');

    // Buscar webhooks que expiran en las próximas 24 horas
    const expiring = await sql`
      SELECT DISTINCT empresa_id, channel_id
      FROM calendar_webhook_180
      WHERE active = true
        AND expiration < NOW() + INTERVAL '24 hours'
    `;

    if (expiring.length === 0) {
      console.log('✅ [CRON] No hay webhooks por renovar');
      return;
    }

    console.log(`🔄 [CRON] Renovando ${expiring.length} webhooks...`);

    let renewed = 0;
    let failed = 0;

    for (const webhook of expiring) {
      try {
        // Detener webhook antiguo
        await stopCalendarWebhook(webhook.empresa_id);

        // Crear nuevo webhook
        await setupCalendarWebhook(webhook.empresa_id);

        renewed++;
        console.log(`✅ [CRON] Webhook renovado: ${webhook.channel_id}`);
      } catch (err) {
        failed++;
        console.error(`❌ [CRON] Error renovando webhook ${webhook.channel_id}:`, err.message);
      }
    }

    console.log(`✅ [CRON] Renovación completada: ${renewed} OK, ${failed} errores`);
  } catch (err) {
    console.error('❌ [CRON] Error en renewCalendarWebhooks:', err);
  }
}
