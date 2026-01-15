// backend/src/services/fichajeSospechoso.js
import { sql } from "../db.js";
import { distanciaMetros } from "../utils/distancia.js";
import { getIpInfo } from "../utils/ipLocation.js";

// Analiza si un fichaje es sospechoso según varias reglas
export const detectarFichajeSospechoso = async ({
  userId,
  empleadoId,
  tipo,
  lat,
  lng,
  clienteId,
  deviceHash,
  reqIp,
}) => {
  const razones = [];

  let dev = null;
  let infoActual = null;
  let distKm = null;

  // REGLA 1 — Fichajes demasiado seguidos (< 3 minutos)
  if (empleadoId) {
    const lastRows = await sql`
      SELECT fecha, tipo
      FROM fichajes_180
      WHERE empleado_id = ${empleadoId}
      ORDER BY fecha DESC
      LIMIT 1
    `;

    if (lastRows.length > 0) {
      const diffMs = Math.abs(new Date() - new Date(lastRows[0].fecha));
      const diffMin = diffMs / 60000;
      if (diffMin < 3) razones.push("Fichajes demasiado seguidos (<3 minutos)");
    }
  }

  // REGLA 2 — GPS inválido
  const gpsInvalido =
    lat === null ||
    lng === null ||
    isNaN(Number(lat)) ||
    isNaN(Number(lng)) ||
    Number(lat) < -90 ||
    Number(lat) > 90 ||
    Number(lng) < -180 ||
    Number(lng) > 180;

  if (gpsInvalido) razones.push("Geolocalización inválida o ausente");

  // REGLA 3 — Geocerca cliente
  if (clienteId && !gpsInvalido && tipo !== "salida") {
    const clienteRows = await sql`
      SELECT lat, lng, radio_m
      FROM clients_180
      WHERE id = ${clienteId}
    `;

    if (
      clienteRows.length > 0 &&
      clienteRows[0].lat != null &&
      clienteRows[0].lng != null &&
      clienteRows[0].radio_m != null
    ) {
      const dist = distanciaMetros(
        Number(lat),
        Number(lng),
        Number(clienteRows[0].lat),
        Number(clienteRows[0].lng)
      );

      if (dist > Number(clienteRows[0].radio_m)) {
        razones.push(
          `Fuera de la zona permitida del cliente. Distancia: ${Math.round(
            dist
          )}m (máx: ${clienteRows[0].radio_m}m)`
        );
      }
    }
  }

  // REGLA 4 — IP habitual vs IP actual (ubicación)
  if (empleadoId && reqIp) {
    const deviceRows = await sql`
      SELECT id, ip_habitual, ip_lat, ip_lng, ip_country, ip_city
      FROM employee_devices_180
      WHERE empleado_id = ${empleadoId}
      ORDER BY created_at ASC
      LIMIT 1
    `;

    if (deviceRows.length > 0) {
      dev = deviceRows[0];

      // si no hay habitual guardada, se guarda ahora (sin marcar sospechoso por esto)
      if (!dev.ip_lat || !dev.ip_lng || !dev.ip_country) {
        const info = await getIpInfo(reqIp);
        if (info) {
          await sql`
            UPDATE employee_devices_180
            SET ip_habitual = ${reqIp},
                ip_lat = ${info.lat},
                ip_lng = ${info.lng},
                ip_country = ${info.country},
                ip_city = ${info.city}
            WHERE id = ${dev.id}
          `;
          dev = {
            ...dev,
            ip_habitual: reqIp,
            ip_lat: info.lat,
            ip_lng: info.lng,
            ip_country: info.country,
            ip_city: info.city,
          };
        }
      } else {
        infoActual = await getIpInfo(reqIp);

        if (infoActual && infoActual.lat != null && infoActual.lng != null) {
          distKm =
            distanciaMetros(
              Number(dev.ip_lat),
              Number(dev.ip_lng),
              Number(infoActual.lat),
              Number(infoActual.lng)
            ) / 1000;

          if (distKm > 50) {
            razones.push(
              `IP geográficamente alejada de la habitual (~${distKm.toFixed(
                1
              )} km)`
            );
          }

          if (
            dev.ip_country &&
            infoActual.country &&
            dev.ip_country !== infoActual.country
          ) {
            razones.push(
              `País distinto al habitual (${infoActual.country} vs ${dev.ip_country})`
            );
          }
        }
      }
    }
  }

  if (razones.length === 0) {
    return { sospechoso: false, razones: [], ipInfo: null, distanciaKm: null };
  }

  return {
    sospechoso: true,
    razones,
    ipInfo: {
      habitual: dev
        ? {
            ip: dev.ip_habitual || null,
            lat: dev.ip_lat ?? null,
            lng: dev.ip_lng ?? null,
            country: dev.ip_country || null,
            city: dev.ip_city || null,
          }
        : null,
      actual: infoActual
        ? {
            ip: reqIp || null,
            lat: infoActual.lat ?? null,
            lng: infoActual.lng ?? null,
            country: infoActual.country || null,
            city: infoActual.city || null,
          }
        : null,
    },
    distanciaKm: distKm,
  };
};
