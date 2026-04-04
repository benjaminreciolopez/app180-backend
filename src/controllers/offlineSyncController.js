// backend/src/controllers/offlineSyncController.js
//
// Sincronización de fichajes offline desde dispositivos kiosko.
// Procesa en orden cronológico para mantener la cadena de hash.

import { sql } from "../db.js";
import { crearFichajeInterno } from "../services/fichajeSharedService.js";
import { getClientIp } from "../utils/clientIp.js";
import { saveToStorage } from "./storageController.js";

/**
 * POST /api/kiosk/sync-offline
 * Recibe un array de fichajes realizados offline y los procesa secuencialmente.
 *
 * Body: { fichajes: [{ local_id, empleado_id, tipo, subtipo?, timestamp, offline_pin? }] }
 */
export const syncOfflineFichajes = async (req, res) => {
  try {
    const { fichajes } = req.body;
    const { empresa_id, centro_trabajo_id, id: deviceId, nombre: deviceName, offline_pin: devicePin } = req.kiosk;

    if (!Array.isArray(fichajes) || fichajes.length === 0) {
      return res.status(400).json({ error: "Array de fichajes requerido" });
    }

    if (fichajes.length > 100) {
      return res.status(400).json({ error: "Máximo 100 fichajes por sincronización" });
    }

    // Validar PIN offline si el dispositivo lo tiene configurado
    const firstWithPin = fichajes.find((f) => f.offline_pin);
    if (devicePin && firstWithPin) {
      if (firstWithPin.offline_pin !== devicePin) {
        return res.status(401).json({ error: "PIN offline incorrecto" });
      }
    }

    // Ordenar por timestamp cronológico (hash chain requiere orden)
    const sorted = [...fichajes].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Crear batch de sincronización
    const [batch] = await sql`
      INSERT INTO offline_sync_batches_180 (empresa_id, kiosk_device_id, total_fichajes)
      VALUES (${empresa_id}, ${deviceId}, ${sorted.length})
      RETURNING id
    `;

    const batchId = batch.id;
    const clientIp = getClientIp(req);
    const errores = [];
    let aceptados = 0;
    let rechazados = 0;

    // Procesar secuencialmente para mantener hash chain
    for (const fichaje of sorted) {
      const TIPOS = ["entrada", "salida", "descanso_inicio", "descanso_fin"];
      if (!fichaje.empleado_id || !fichaje.tipo || !TIPOS.includes(fichaje.tipo)) {
        errores.push({
          local_id: fichaje.local_id,
          error: "Datos inválidos (empleado_id o tipo faltan/incorrectos)",
        });
        rechazados++;
        continue;
      }

      try {
        const fichajeResult = await crearFichajeInterno({
          empleadoId: fichaje.empleado_id,
          empresaId: empresa_id,
          tipo: fichaje.tipo,
          fechaHora: new Date(fichaje.timestamp),
          centroTrabajoId: centro_trabajo_id,
          origen: "offline_sync",
          reqIp: clientIp,
          skipPlanCheck: true,
          skipGeoValidation: true,
          estadoOverride: "pendiente_validacion",
          subtipo: fichaje.subtipo || null,
          offlineTimestamp: new Date(fichaje.timestamp),
          offlineDeviceId: deviceId,
          syncBatchId: batchId,
        });

        // Guardar foto de verificación si viene incluida
        if (fichaje.foto_base64 && fichajeResult?.id) {
          try {
            const buffer = Buffer.from(fichaje.foto_base64, "base64");
            const record = await saveToStorage({
              empresaId: empresa_id,
              nombre: `offline_verify_${fichajeResult.id}.jpg`,
              buffer,
              folder: "offline-photos",
              mimeType: "image/jpeg",
            });
            const photoUrl = `${process.env.SUPABASE_PROJECT_URL}/storage/v1/object/public/app180-files/${record.storage_path}`;
            await sql`
              UPDATE fichajes_180 SET foto_verificacion_url = ${photoUrl} WHERE id = ${fichajeResult.id}
            `;
          } catch (photoErr) {
            console.error("Error guardando foto offline (no bloqueante):", photoErr.message);
          }
        }

        aceptados++;
      } catch (err) {
        errores.push({
          local_id: fichaje.local_id,
          error: err.message,
        });
        rechazados++;
      }
    }

    // Actualizar batch
    await sql`
      UPDATE offline_sync_batches_180
      SET
        fichajes_aceptados = ${aceptados},
        fichajes_rechazados = ${rechazados},
        estado = 'completado',
        errores = ${JSON.stringify(errores)}
      WHERE id = ${batchId}
    `;

    // Notificación al admin (si hay fichajes procesados)
    if (aceptados > 0) {
      try {
        await sql`
          INSERT INTO notificaciones_180 (empresa_id, tipo, titulo, mensaje, datos)
          VALUES (
            ${empresa_id},
            'offline_sync',
            'Fichajes offline sincronizados',
            ${`${aceptados} fichajes offline sincronizados desde "${deviceName}". ${rechazados > 0 ? `${rechazados} rechazados.` : ""} Requieren validación.`},
            ${JSON.stringify({ batch_id: batchId, aceptados, rechazados, device: deviceName })}
          )
        `;
      } catch (_) { /* notificación no bloquea */ }
    }

    // Actualizar último uso del dispositivo
    await sql`
      UPDATE kiosk_devices_180
      SET ultimo_uso = NOW()
      WHERE id = ${deviceId}
    `.catch(() => {});

    return res.json({
      total: sorted.length,
      aceptados,
      rechazados,
      errores: errores.length > 0 ? errores : undefined,
    });
  } catch (err) {
    console.error("Error syncOfflineFichajes:", err);
    return res.status(500).json({ error: "Error al sincronizar fichajes offline" });
  }
};
