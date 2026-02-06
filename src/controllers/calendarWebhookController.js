import { sql } from '../db.js';
import { setupCalendarWebhook, stopCalendarWebhook } from '../services/googleCalendarService.js';
import { syncFromGoogle } from '../services/calendarSyncService.js';

/**
 * Calendar Webhook Controller
 * Maneja webhooks de Google Calendar Push Notifications
 */

/**
 * POST /api/calendar-webhook
 * Recibir notificación de Google Calendar
 * NO requiere autenticación (validación por headers)
 */
export async function handleWebhook(req, res) {
  try {
    // Headers de Google Calendar Push Notifications
    const channelId = req.headers['x-goog-channel-id'];
    const resourceId = req.headers['x-goog-resource-id'];
    const resourceState = req.headers['x-goog-resource-state'];
    const resourceUri = req.headers['x-goog-resource-uri'];

    console.log('📬 Webhook recibido:', {
      channelId,
      resourceId,
      resourceState,
      resourceUri
    });

    // Validar headers
    if (!channelId || !resourceId) {
      console.log('⚠️ Webhook sin headers válidos');
      return res.status(400).send('Missing headers');
    }

    // Verificar que el webhook existe en nuestra DB
    const webhook = await sql`
      SELECT empresa_id FROM calendar_webhook_180
      WHERE channel_id = ${channelId} AND active = true
    `;

    if (webhook.length === 0) {
      console.log('❌ Webhook no encontrado o inactivo:', channelId);
      return res.status(404).send('Webhook not found');
    }

    const empresaId = webhook[0].empresa_id;

    // Responder rápido a Google (200 OK)
    res.status(200).send('OK');

    // Procesar webhook de forma asíncrona
    if (resourceState === 'exists') {
      console.log('🔄 Disparando sincronización automática desde webhook');

      // Sync desde Google (próximos 12 meses)
      const dateFrom = new Date().toISOString().split('T')[0];
      const dateTo = (() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 12);
        return d.toISOString().split('T')[0];
      })();

      syncFromGoogle(empresaId, { dateFrom, dateTo, userId: null })
        .then(stats => {
          console.log('✅ Sync desde webhook completada:', stats);
        })
        .catch(err => {
          console.error('❌ Error en sync desde webhook:', err);
        });
    }
  } catch (err) {
    console.error("❌ Error handling webhook:", err);
    // No enviar error a Google, ya respondimos 200 OK
  }
}

/**
 * POST /admin/calendar-webhook/setup
 * Configurar webhook (admin)
 */
export async function setup(req, res) {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const webhookData = await setupCalendarWebhook(empresa[0].id);

    res.json({
      success: true,
      message: 'Webhook configurado',
      webhook: {
        channel_id: webhookData.id,
        resource_id: webhookData.resourceId,
        expiration: webhookData.expiration
      }
    });
  } catch (err) {
    console.error("❌ Error setting up webhook:", err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /admin/calendar-webhook/stop
 * Detener webhook (admin)
 */
export async function stop(req, res) {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    await stopCalendarWebhook(empresa[0].id);

    res.json({
      success: true,
      message: 'Webhook detenido'
    });
  } catch (err) {
    console.error("❌ Error stopping webhook:", err);
    res.status(500).json({ error: err.message });
  }
}
