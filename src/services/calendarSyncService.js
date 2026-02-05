import { sql } from '../db.js';
import {
  getCalendarConfig,
  listGoogleEvents,
  createGoogleEvent,
  updateGoogleEvent,
  deleteGoogleEvent,
  app180ToGoogleEvent,
  googleToApp180Event,
  updateSyncToken
} from './googleCalendarService.js';

/**
 * Calendar Sync Service
 * Lógica de sincronización bidireccional entre APP180 y Google Calendar
 * Incluye prevención de loops infinitos
 */

// Tiempo mínimo entre syncs del mismo evento (5 minutos)
const ANTI_LOOP_THRESHOLD_MS = 5 * 60 * 1000;

// ========================================
// MAPEO DE EVENTOS (Anti-Loop)
// ========================================

/**
 * Obtener mapping de un evento APP180
 * @param {string} empresaId
 * @param {string} source - 'calendario_empresa', 'ausencias'
 * @param {string} eventId - UUID del evento en APP180
 * @returns {Object|null}
 */
export async function getEventMapping(empresaId, source, eventId) {
  const mapping = await sql`
    SELECT * FROM calendar_event_mapping_180
    WHERE empresa_id = ${empresaId}
      AND app180_source = ${source}
      AND app180_event_id = ${eventId}
  `;

  return mapping[0] || null;
}

/**
 * Obtener mapping por evento de Google
 * @param {string} empresaId
 * @param {string} googleCalendarId
 * @param {string} googleEventId
 * @returns {Object|null}
 */
export async function getEventMappingByGoogle(empresaId, googleCalendarId, googleEventId) {
  const mapping = await sql`
    SELECT * FROM calendar_event_mapping_180
    WHERE empresa_id = ${empresaId}
      AND google_calendar_id = ${googleCalendarId}
      AND google_event_id = ${googleEventId}
  `;

  return mapping[0] || null;
}

/**
 * Verificar si un evento debe sincronizarse (Anti-Loop)
 * @param {string} empresaId
 * @param {string} source
 * @param {string} eventId
 * @returns {boolean}
 */
export async function shouldSyncEvent(empresaId, source, eventId) {
  const mapping = await getEventMapping(empresaId, source, eventId);

  if (!mapping) {
    // No existe mapping, OK para sincronizar
    return true;
  }

  // Verificar si se sincronizó hace < 5 minutos
  const lastSyncTime = new Date(mapping.last_synced_at).getTime();
  const now = Date.now();
  const diffMs = now - lastSyncTime;

  if (diffMs < ANTI_LOOP_THRESHOLD_MS) {
    console.log(`⏭️ SKIP: Evento sincronizado hace ${Math.round(diffMs / 1000)}s`);
    return false;
  }

  return true;
}

/**
 * Crear o actualizar mapping
 * @param {string} empresaId
 * @param {Object} data - { app180_source, app180_event_id, google_calendar_id, google_event_id, sync_direction, google_etag }
 */
export async function upsertEventMapping(empresaId, data) {
  await sql`
    INSERT INTO calendar_event_mapping_180 (
      empresa_id,
      app180_source,
      app180_event_id,
      google_calendar_id,
      google_event_id,
      sync_direction,
      google_etag,
      last_synced_at
    )
    VALUES (
      ${empresaId},
      ${data.app180_source},
      ${data.app180_event_id},
      ${data.google_calendar_id},
      ${data.google_event_id},
      ${data.sync_direction},
      ${data.google_etag || null},
      NOW()
    )
    ON CONFLICT (empresa_id, app180_source, app180_event_id)
    DO UPDATE SET
      google_event_id = EXCLUDED.google_event_id,
      google_etag = EXCLUDED.google_etag,
      sync_direction = EXCLUDED.sync_direction,
      last_synced_at = NOW(),
      updated_at = NOW()
  `;
}

/**
 * Eliminar mapping
 * @param {string} empresaId
 * @param {string} source
 * @param {string} eventId
 */
export async function deleteEventMapping(empresaId, source, eventId) {
  await sql`
    DELETE FROM calendar_event_mapping_180
    WHERE empresa_id = ${empresaId}
      AND app180_source = ${source}
      AND app180_event_id = ${eventId}
  `;
}

// ========================================
// SINCRONIZACIÓN: APP180 → GOOGLE
// ========================================

/**
 * Sincronizar eventos de APP180 a Google Calendar
 * @param {string} empresaId
 * @param {Object} options - { dateFrom, dateTo, userId }
 * @returns {Object} - Estadísticas de sync
 */
export async function syncToGoogle(empresaId, { dateFrom, dateTo, userId = null }) {
  const config = await getCalendarConfig(empresaId);

  if (!config || !config.sync_enabled) {
    throw new Error('Google Calendar no está habilitado');
  }

  const syncTypes = config.sync_types || {};
  const stats = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: []
  };

  // 1. Obtener eventos APP180 según sync_types
  const whereConditions = [];

  if (syncTypes.festivos !== false) {
    whereConditions.push(`tipo IN ('festivo_local', 'festivo_nacional', 'festivo_empresa', 'convenio')`);
  }
  if (syncTypes.cierres !== false) {
    whereConditions.push(`tipo IN ('cierre_empresa', 'no_laborable')`);
  }

  if (whereConditions.length === 0) {
    console.log('⚠️ No hay tipos de eventos habilitados para sincronizar');
    return stats;
  }

  const eventos = await sql`
    SELECT * FROM calendario_empresa_180
    WHERE empresa_id = ${empresaId}
      AND fecha >= ${dateFrom}
      AND fecha <= ${dateTo}
      AND activo = true
      AND (${sql.unsafe(whereConditions.join(' OR '))})
    ORDER BY fecha ASC
  `;

  console.log(`📤 Sincronizando ${eventos.length} eventos a Google Calendar`);

  // 2. Sincronizar cada evento
  for (const evento of eventos) {
    try {
      // Anti-Loop: Verificar si debe sincronizarse
      const should = await shouldSyncEvent(empresaId, 'calendario_empresa', evento.id);
      if (!should) {
        stats.skipped++;
        continue;
      }

      // Verificar si ya existe mapping
      const mapping = await getEventMapping(empresaId, 'calendario_empresa', evento.id);

      if (mapping) {
        // Actualizar evento existente
        const googleEventData = app180ToGoogleEvent(evento);
        const updated = await updateGoogleEvent(empresaId, mapping.google_event_id, googleEventData);

        await upsertEventMapping(empresaId, {
          app180_source: 'calendario_empresa',
          app180_event_id: evento.id,
          google_calendar_id: config.calendar_id || 'primary',
          google_event_id: updated.id,
          sync_direction: 'to_google',
          google_etag: updated.etag
        });

        stats.updated++;
      } else {
        // Crear nuevo evento en Google
        const googleEventData = app180ToGoogleEvent(evento);
        const created = await createGoogleEvent(empresaId, googleEventData);

        await upsertEventMapping(empresaId, {
          app180_source: 'calendario_empresa',
          app180_event_id: evento.id,
          google_calendar_id: config.calendar_id || 'primary',
          google_event_id: created.id,
          sync_direction: 'to_google',
          google_etag: created.etag
        });

        stats.created++;
      }
    } catch (err) {
      console.error(`❌ Error sincronizando evento ${evento.id}:`, err.message);
      stats.errors.push({
        evento_id: evento.id,
        error: err.message
      });
    }
  }

  // 3. Registrar log
  await createSyncLog(empresaId, {
    sync_type: 'manual',
    sync_direction: 'to_google',
    status: stats.errors.length === 0 ? 'success' : 'partial',
    events_created: stats.created,
    events_updated: stats.updated,
    errors_count: stats.errors.length,
    error_details: stats.errors.length > 0 ? stats.errors : null,
    triggered_by: userId
  });

  console.log('✅ Sync to Google completada:', stats);
  return stats;
}

// ========================================
// SINCRONIZACIÓN: GOOGLE → APP180
// ========================================

/**
 * Sincronizar eventos de Google Calendar a APP180
 * @param {string} empresaId
 * @param {Object} options - { dateFrom, dateTo, userId }
 * @returns {Object} - Estadísticas de sync
 */
export async function syncFromGoogle(empresaId, { dateFrom, dateTo, userId = null }) {
  const config = await getCalendarConfig(empresaId);

  if (!config || !config.sync_enabled) {
    throw new Error('Google Calendar no está habilitado');
  }

  const stats = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: []
  };

  // 1. Obtener eventos de Google Calendar
  const { events, nextSyncToken } = await listGoogleEvents(empresaId, {
    timeMin: `${dateFrom}T00:00:00Z`,
    timeMax: `${dateTo}T23:59:59Z`,
    syncToken: config.sync_token // Sync incremental si existe
  });

  console.log(`📥 Sincronizando ${events.length} eventos desde Google Calendar`);

  // 2. Sincronizar cada evento
  for (const googleEvent of events) {
    try {
      // Verificar si ya existe mapping
      const mapping = await getEventMappingByGoogle(
        empresaId,
        config.calendar_id || 'primary',
        googleEvent.id
      );

      if (mapping) {
        // Anti-Loop: Verificar timestamp
        const lastSyncTime = new Date(mapping.last_synced_at).getTime();
        const diffMs = Date.now() - lastSyncTime;

        if (diffMs < ANTI_LOOP_THRESHOLD_MS) {
          console.log(`⏭️ SKIP: Evento de Google sincronizado hace ${Math.round(diffMs / 1000)}s`);
          stats.skipped++;
          continue;
        }

        // Actualizar evento en APP180
        const app180Data = googleToApp180Event(googleEvent);

        await sql`
          UPDATE calendario_empresa_180
          SET
            nombre = ${app180Data.nombre},
            descripcion = ${app180Data.descripcion},
            es_laborable = ${app180Data.es_laborable},
            updated_at = NOW()
          WHERE id = ${mapping.app180_event_id}
        `;

        // Actualizar mapping
        await upsertEventMapping(empresaId, {
          app180_source: mapping.app180_source,
          app180_event_id: mapping.app180_event_id,
          google_calendar_id: config.calendar_id || 'primary',
          google_event_id: googleEvent.id,
          sync_direction: 'from_google',
          google_etag: googleEvent.etag
        });

        stats.updated++;
      } else {
        // Crear nuevo evento en APP180
        const app180Data = googleToApp180Event(googleEvent);

        const result = await sql`
          INSERT INTO calendario_empresa_180 (
            empresa_id,
            fecha,
            tipo,
            nombre,
            descripcion,
            es_laborable,
            origen,
            activo,
            confirmado
          )
          VALUES (
            ${empresaId},
            ${app180Data.fecha},
            ${app180Data.tipo},
            ${app180Data.nombre},
            ${app180Data.descripcion},
            ${app180Data.es_laborable},
            ${app180Data.origen},
            ${app180Data.activo},
            ${app180Data.confirmado}
          )
          RETURNING id
        `;

        // Crear mapping
        await upsertEventMapping(empresaId, {
          app180_source: 'calendario_empresa',
          app180_event_id: result[0].id,
          google_calendar_id: config.calendar_id || 'primary',
          google_event_id: googleEvent.id,
          sync_direction: 'from_google',
          google_etag: googleEvent.etag
        });

        stats.created++;
      }
    } catch (err) {
      console.error(`❌ Error sincronizando evento de Google ${googleEvent.id}:`, err.message);
      stats.errors.push({
        google_event_id: googleEvent.id,
        error: err.message
      });
    }
  }

  // 3. Actualizar sync_token para próxima sync incremental
  if (nextSyncToken) {
    await updateSyncToken(empresaId, nextSyncToken);
  }

  // 4. Registrar log
  await createSyncLog(empresaId, {
    sync_type: 'manual',
    sync_direction: 'from_google',
    status: stats.errors.length === 0 ? 'success' : 'partial',
    events_created: stats.created,
    events_updated: stats.updated,
    errors_count: stats.errors.length,
    error_details: stats.errors.length > 0 ? stats.errors : null,
    triggered_by: userId
  });

  console.log('✅ Sync from Google completada:', stats);
  return stats;
}

// ========================================
// SINCRONIZACIÓN BIDIRECCIONAL
// ========================================

/**
 * Sincronizar bidireccionalmente
 * @param {string} empresaId
 * @param {Object} options - { dateFrom, dateTo, userId }
 * @returns {Object} - Estadísticas combinadas
 */
export async function syncBidirectional(empresaId, options) {
  console.log('🔄 Iniciando sincronización bidireccional');

  const toGoogleStats = await syncToGoogle(empresaId, options);
  const fromGoogleStats = await syncFromGoogle(empresaId, options);

  const combinedStats = {
    to_google: toGoogleStats,
    from_google: fromGoogleStats,
    total_created: toGoogleStats.created + fromGoogleStats.created,
    total_updated: toGoogleStats.updated + fromGoogleStats.updated,
    total_errors: toGoogleStats.errors.length + fromGoogleStats.errors.length
  };

  console.log('✅ Sincronización bidireccional completada:', combinedStats);
  return combinedStats;
}

// ========================================
// LOGS DE SINCRONIZACIÓN
// ========================================

/**
 * Crear log de sincronización
 * @param {string} empresaId
 * @param {Object} data
 */
export async function createSyncLog(empresaId, data) {
  await sql`
    INSERT INTO calendar_sync_log_180 (
      empresa_id,
      sync_type,
      sync_direction,
      status,
      events_created,
      events_updated,
      events_deleted,
      errors_count,
      error_details,
      triggered_by
    )
    VALUES (
      ${empresaId},
      ${data.sync_type},
      ${data.sync_direction},
      ${data.status},
      ${data.events_created || 0},
      ${data.events_updated || 0},
      ${data.events_deleted || 0},
      ${data.errors_count || 0},
      ${data.error_details ? JSON.stringify(data.error_details) : null},
      ${data.triggered_by || null}
    )
  `;
}

/**
 * Obtener historial de sincronizaciones
 * @param {string} empresaId
 * @param {number} limit
 * @returns {Array}
 */
export async function getSyncHistory(empresaId, limit = 20) {
  return await sql`
    SELECT * FROM calendar_sync_log_180
    WHERE empresa_id = ${empresaId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}
