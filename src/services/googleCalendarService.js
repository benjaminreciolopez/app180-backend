import { google } from 'googleapis';
import { sql } from '../db.js';
import { encrypt, decrypt } from '../utils/encryption.js';

/**
 * Google Calendar Service
 * Maneja OAuth2, CRUD de eventos y webhooks para Google Calendar
 * Patrón idéntico a emailService.js
 */

// ========================================
// CONFIGURACIÓN
// ========================================

/**
 * Obtener configuración de Google Calendar para una empresa
 * @param {string} empresaId - UUID de la empresa
 * @returns {Object|null} - Configuración o null si no existe
 */
export async function getCalendarConfig(empresaId) {
  const config = await sql`
    SELECT * FROM empresa_calendar_config_180
    WHERE empresa_id = ${empresaId}
  `;

  return config[0] || null;
}

/**
 * Guardar configuración OAuth2
 * @param {string} empresaId - UUID de la empresa
 * @param {Object} data - { provider, email, refreshToken }
 */
export async function saveOAuth2Config(empresaId, { provider, email, refreshToken }) {
  const encryptedToken = encrypt(refreshToken);

  await sql`
    INSERT INTO empresa_calendar_config_180 (
      empresa_id,
      oauth2_provider,
      oauth2_email,
      oauth2_refresh_token,
      oauth2_connected_at
    )
    VALUES (
      ${empresaId},
      ${provider},
      ${email},
      ${encryptedToken},
      NOW()
    )
    ON CONFLICT (empresa_id)
    DO UPDATE SET
      oauth2_provider = EXCLUDED.oauth2_provider,
      oauth2_email = EXCLUDED.oauth2_email,
      oauth2_refresh_token = EXCLUDED.oauth2_refresh_token,
      oauth2_connected_at = NOW(),
      updated_at = NOW()
  `;

  console.log('✅ Google Calendar OAuth2 config guardada:', { empresaId, email });
}

/**
 * Desconectar OAuth2
 * @param {string} empresaId - UUID de la empresa
 */
export async function disconnectOAuth2(empresaId) {
  await sql`
    UPDATE empresa_calendar_config_180
    SET
      oauth2_refresh_token = NULL,
      oauth2_email = NULL,
      oauth2_connected_at = NULL,
      sync_enabled = false,
      updated_at = NOW()
    WHERE empresa_id = ${empresaId}
  `;

  // Desactivar webhooks activos
  await sql`
    UPDATE calendar_webhook_180
    SET active = false, updated_at = NOW()
    WHERE empresa_id = ${empresaId}
  `;

  console.log('✅ Google Calendar desconectado:', empresaId);
}

/**
 * Actualizar sync_token (para sync incremental)
 * @param {string} empresaId - UUID de la empresa
 * @param {string} syncToken - Token de Google
 */
export async function updateSyncToken(empresaId, syncToken) {
  await sql`
    UPDATE empresa_calendar_config_180
    SET sync_token = ${syncToken}, last_sync_at = NOW(), updated_at = NOW()
    WHERE empresa_id = ${empresaId}
  `;
}

// ========================================
// CLIENTE DE GOOGLE CALENDAR
// ========================================

/**
 * Obtener cliente autenticado de Google Calendar
 * @param {string} empresaId - UUID de la empresa
 * @returns {Object} - { client, calendarId, email }
 */
export async function getCalendarClient(empresaId) {
  const config = await getCalendarConfig(empresaId);

  if (!config || !config.oauth2_refresh_token) {
    throw new Error('Google Calendar no está configurado para esta empresa');
  }

  // Desencriptar refresh token
  const refreshToken = decrypt(config.oauth2_refresh_token);

  // Crear cliente OAuth2
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALENDAR_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken
  });

  return {
    client: oauth2Client,
    calendarId: config.calendar_id || 'primary',
    email: config.oauth2_email
  };
}

// ========================================
// OPERACIONES DE EVENTOS
// ========================================

/**
 * Listar eventos de Google Calendar
 * @param {string} empresaId - UUID de la empresa
 * @param {Object} options - { timeMin, timeMax, syncToken }
 * @returns {Array} - Array de eventos de Google
 */
export async function listGoogleEvents(empresaId, { timeMin, timeMax, syncToken }) {
  const { client, calendarId } = await getCalendarClient(empresaId);
  const calendar = google.calendar({ version: 'v3', auth: client });

  const params = {
    calendarId,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 2500
  };

  // Sync incremental si hay syncToken
  if (syncToken) {
    params.syncToken = syncToken;
  } else {
    // Sync completo por rango de fechas
    if (timeMin) params.timeMin = timeMin;
    if (timeMax) params.timeMax = timeMax;
  }

  const response = await calendar.events.list(params);

  return {
    events: response.data.items || [],
    nextSyncToken: response.data.nextSyncToken,
    nextPageToken: response.data.nextPageToken
  };
}

/**
 * Crear evento en Google Calendar
 * @param {string} empresaId - UUID de la empresa
 * @param {Object} eventData - Datos del evento (formato Google)
 * @returns {Object} - Evento creado
 */
export async function createGoogleEvent(empresaId, eventData) {
  const { client, calendarId } = await getCalendarClient(empresaId);
  const calendar = google.calendar({ version: 'v3', auth: client });

  const response = await calendar.events.insert({
    calendarId,
    requestBody: eventData
  });

  console.log('✅ Evento creado en Google Calendar:', response.data.id);
  return response.data;
}

/**
 * Actualizar evento en Google Calendar
 * @param {string} empresaId - UUID de la empresa
 * @param {string} googleEventId - ID del evento en Google
 * @param {Object} eventData - Datos actualizados
 * @returns {Object} - Evento actualizado
 */
export async function updateGoogleEvent(empresaId, googleEventId, eventData) {
  const { client, calendarId } = await getCalendarClient(empresaId);
  const calendar = google.calendar({ version: 'v3', auth: client });

  const response = await calendar.events.update({
    calendarId,
    eventId: googleEventId,
    requestBody: eventData
  });

  console.log('✅ Evento actualizado en Google Calendar:', googleEventId);
  return response.data;
}

/**
 * Actualizar parcialmente un evento en Google Calendar (usando patch)
 * @param {string} empresaId - UUID de la empresa
 * @param {string} googleEventId - ID del evento en Google
 * @param {Object} eventData - Datos actualizados
 * @returns {Object} - Evento actualizado
 */
export async function patchGoogleEvent(empresaId, googleEventId, eventData) {
  const { client, calendarId } = await getCalendarClient(empresaId);
  const calendar = google.calendar({ version: 'v3', auth: client });

  const response = await calendar.events.patch({
    calendarId,
    eventId: googleEventId,
    requestBody: eventData
  });

  console.log('✅ Evento parcheado (patch) en Google Calendar:', googleEventId);
  return response.data;
}

/**
 * Eliminar evento en Google Calendar
 * @param {string} empresaId - UUID de la empresa
 * @param {string} googleEventId - ID del evento en Google
 */
export async function deleteGoogleEvent(empresaId, googleEventId) {
  const { client, calendarId } = await getCalendarClient(empresaId);
  const calendar = google.calendar({ version: 'v3', auth: client });

  await calendar.events.delete({
    calendarId,
    eventId: googleEventId
  });

  console.log('✅ Evento eliminado de Google Calendar:', googleEventId);
}

// ========================================
// WEBHOOKS
// ========================================

/**
 * Configurar webhook de Google Calendar (Push Notifications)
 * @param {string} empresaId - UUID de la empresa
 * @returns {Object} - Datos del webhook creado
 */
export async function setupCalendarWebhook(empresaId) {
  const { client, calendarId } = await getCalendarClient(empresaId);
  const calendar = google.calendar({ version: 'v3', auth: client });

  const channelId = `app180-${empresaId}-${Date.now()}`;
  const webhookUrl = `${process.env.APP_URL}/api/calendar-webhook`;
  const expiration = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 días

  const response = await calendar.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: webhookUrl,
      expiration: expiration.toString()
    }
  });

  // Guardar en DB
  await sql`
    INSERT INTO calendar_webhook_180 (
      empresa_id,
      channel_id,
      resource_id,
      calendar_id,
      expiration
    )
    VALUES (
      ${empresaId},
      ${channelId},
      ${response.data.resourceId},
      ${calendarId},
      to_timestamp(${expiration / 1000})
    )
    ON CONFLICT (empresa_id, calendar_id)
    DO UPDATE SET
      channel_id = EXCLUDED.channel_id,
      resource_id = EXCLUDED.resource_id,
      expiration = EXCLUDED.expiration,
      active = true,
      updated_at = NOW()
  `;

  console.log('✅ Webhook de Google Calendar configurado:', channelId);
  return response.data;
}

/**
 * Detener webhook de Google Calendar
 * @param {string} empresaId - UUID de la empresa
 */
export async function stopCalendarWebhook(empresaId) {
  const webhook = await sql`
    SELECT channel_id, resource_id
    FROM calendar_webhook_180
    WHERE empresa_id = ${empresaId} AND active = true
  `;

  if (webhook.length === 0) {
    console.log('⚠️ No hay webhook activo para detener');
    return;
  }

  const { client } = await getCalendarClient(empresaId);
  const calendar = google.calendar({ version: 'v3', auth: client });

  try {
    await calendar.channels.stop({
      requestBody: {
        id: webhook[0].channel_id,
        resourceId: webhook[0].resource_id
      }
    });

    // Marcar como inactivo
    await sql`
      UPDATE calendar_webhook_180
      SET active = false, updated_at = NOW()
      WHERE empresa_id = ${empresaId}
    `;

    console.log('✅ Webhook detenido:', webhook[0].channel_id);
  } catch (err) {
    console.error('❌ Error al detener webhook:', err.message);
    // Marcar como inactivo de todas formas
    await sql`
      UPDATE calendar_webhook_180
      SET active = false, updated_at = NOW()
      WHERE empresa_id = ${empresaId}
    `;
  }
}

// ========================================
// CONVERSIÓN DE FORMATOS
// ========================================

/**
 * Convertir evento APP180 a formato Google Calendar
 * @param {Object} app180Event - Evento de calendario_empresa_180
 * @returns {Object} - Evento en formato Google
 */
export function app180ToGoogleEvent(app180Event) {
  // Mapeo de colores por tipo
  const colorMap = {
    festivo_local: '11', // Rojo
    festivo_nacional: '11', // Rojo
    festivo_empresa: '4', // Flamingo
    cierre_empresa: '8', // Gris
    convenio: '9', // Azul
    laborable_extra: '5', // Amarillo
    no_laborable: '10' // Verde
  };

  // Google requiere formato YYYY-MM-DD para eventos de "todo el día"
  // Y la fecha de fin es EXCLUSIVA (debe ser el día siguiente)
  const startDate = new Date(app180Event.fecha);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 1);

  const toYMD = (d) => d.toISOString().split('T')[0];

  return {
    summary: app180Event.nombre || app180Event.label || 'Evento',
    description: app180Event.descripcion || '',
    start: { date: toYMD(startDate) },
    end: { date: toYMD(endDate) },
    colorId: colorMap[app180Event.tipo] || '1',
    transparency: app180Event.es_laborable ? 'transparent' : 'opaque',
    source: {
      title: 'APP180',
      url: `${process.env.APP_URL || 'https://app180.com'}`
    }
  };
}

/**
 * Convertir evento Google Calendar a formato APP180
 * @param {Object} googleEvent - Evento de Google Calendar
 * @returns {Object} - Evento en formato APP180
 */
export function googleToApp180Event(googleEvent) {
  // Fecha del evento (all-day o datetime)
  const fecha = googleEvent.start?.date || googleEvent.start?.dateTime?.split('T')[0];

  return {
    fecha,
    nombre: googleEvent.summary || 'Evento de Google',
    descripcion: googleEvent.description || '',
    tipo: 'festivo_local', // Default, puede ser refinado
    es_laborable: googleEvent.transparency === 'transparent',
    origen: 'ocr',
    activo: true,
    confirmado: true
  };
}
