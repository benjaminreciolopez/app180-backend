import { google } from 'googleapis';
import { sql } from '../db.js';
import {
  getCalendarConfig,
  saveOAuth2Config,
  disconnectOAuth2,
  listGoogleEvents
} from '../services/googleCalendarService.js';

/**
 * Calendar Config Controller
 * Maneja configuración de Google Calendar (OAuth2, settings)
 * Patrón idéntico a emailConfigController.js
 */

/**
 * GET /admin/calendar-config
 * Obtener configuración actual (sin datos sensibles)
 */
export async function getConfig(req, res) {
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

    // Retornar config sin datos sensibles
    res.json({
      configured: true,
      oauth2_provider: config.oauth2_provider,
      oauth2_email: config.oauth2_email,
      oauth2_connected_at: config.oauth2_connected_at,
      calendar_id: config.calendar_id,
      last_sync_at: config.last_sync_at,
      sync_enabled: config.sync_enabled,
      sync_direction: config.sync_direction,
      sync_types: config.sync_types,
      sync_range_months: config.sync_range_months
    });
  } catch (err) {
    console.error("❌ Error getting calendar config:", err);
    res.status(500).json({ error: "Error al obtener configuración" });
  }
}

/**
 * POST /admin/calendar-config/oauth2/start
 * Iniciar flujo OAuth2 - retorna URL de autorización
 */
export async function startOAuth2(req, res) {
  try {
    const { provider = 'google' } = req.body;

    if (provider !== 'google') {
      return res.status(400).json({ error: "Solo Google está soportado actualmente" });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALENDAR_REDIRECT_URI
    );

    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/userinfo.email'
    ];

    // Almacenar user ID y type en state para recuperar después del callback
    const state = Buffer.from(JSON.stringify({
      userId: req.user.id,
      type: 'calendar' // Para diferenciar de callback de email
    })).toString('base64');

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: state,
      prompt: 'consent' // Forzar para obtener refresh_token
    });

    console.log('🔗 Google Calendar auth URL generada:', process.env.GOOGLE_CALENDAR_REDIRECT_URI);

    res.json({ authUrl });
  } catch (err) {
    console.error("❌ Error starting OAuth2:", err);
    res.status(500).json({ error: "Error al iniciar autenticación" });
  }
}

/**
 * GET /auth/google/calendar/callback
 * Callback de OAuth2 de Google
 */
export async function handleGoogleCallback(req, res) {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send('❌ Código o state no proporcionado');
    }

    // Decodificar state
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    const userId = stateData.userId;

    if (!userId) {
      return res.status(400).send('❌ State inválido');
    }

    // Obtener empresa_id del usuario
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${userId}
    `;

    if (empresa.length === 0) {
      return res.status(403).send('❌ Usuario sin empresa asociada');
    }

    const empresaId = empresa[0].id;

    // Intercambiar código por tokens
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALENDAR_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      return res.status(400).send('❌ No se obtuvo refresh_token. Intenta revocar acceso en Google y vuelve a autorizar.');
    }

    // Obtener email del usuario de Google
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    // Guardar configuración
    await saveOAuth2Config(empresaId, {
      provider: 'google',
      email: userInfo.data.email,
      refreshToken: tokens.refresh_token
    });

    console.log('✅ Google Calendar conectado:', {
      empresaId,
      email: userInfo.data.email
    });

    // Redirigir al frontend
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/admin/configuracion?calendar_success=true`);
  } catch (err) {
    console.error("❌ Error en callback OAuth2:", err);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/admin/configuracion?calendar_error=true`);
  }
}

/**
 * POST /admin/calendar-config/oauth2/disconnect
 * Desconectar Google Calendar
 */
export async function disconnect(req, res) {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    await disconnectOAuth2(empresa[0].id);

    res.json({
      success: true,
      message: 'Google Calendar desconectado'
    });
  } catch (err) {
    console.error("❌ Error disconnecting Google Calendar:", err);
    res.status(500).json({ error: "Error al desconectar Google Calendar" });
  }
}

/**
 * POST /admin/calendar-config/test
 * Probar conexión con Google Calendar
 */
export async function testConnection(req, res) {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const empresaId = empresa[0].id;

    // Intentar listar eventos (próximos 7 días)
    const dateFrom = new Date();
    const dateTo = new Date();
    dateTo.setDate(dateTo.getDate() + 7);

    const { events } = await listGoogleEvents(empresaId, {
      timeMin: dateFrom.toISOString(),
      timeMax: dateTo.toISOString()
    });

    res.json({
      success: true,
      message: `Conexión exitosa. ${events.length} eventos encontrados en próximos 7 días.`,
      events_count: events.length
    });
  } catch (err) {
    console.error("❌ Error testing connection:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

/**
 * PUT /admin/calendar-config/settings
 * Actualizar configuración de sincronización
 */
export async function updateSettings(req, res) {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const { sync_enabled, sync_direction, sync_types, sync_range_months } = req.body;

    await sql`
      UPDATE empresa_calendar_config_180
      SET
        sync_enabled = ${sync_enabled !== undefined ? sync_enabled : sql`sync_enabled`},
        sync_direction = ${sync_direction || sql`sync_direction`},
        sync_types = ${sync_types ? JSON.stringify(sync_types) : sql`sync_types`},
        sync_range_months = ${sync_range_months || sql`sync_range_months`},
        updated_at = NOW()
      WHERE empresa_id = ${empresa[0].id}
    `;

    res.json({
      success: true,
      message: 'Configuración actualizada'
    });
  } catch (err) {
    console.error("❌ Error updating settings:", err);
    res.status(500).json({ error: "Error al actualizar configuración" });
  }
}
