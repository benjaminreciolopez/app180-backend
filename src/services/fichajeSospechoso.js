import { sql } from "../db.js";
import { distanciaMetros } from "../utils/distancia.js";
import { getIpInfo } from "../utils/ipLocation.js";
import { validarFichajeSegunPlan } from "./validarFichajeSegunPlan.js";
import { validarFichajeSegunTurno } from "./fichajesValidacionService.js";

export const detectarFichajeSospechoso = async ({
  userId,
  empleadoId,
  empresaId,
  tipo,
  lat,
  lng,
  clienteId,
  reqIp,
}) => {
  const razones = [];

  let dev = null;
  let infoActual = null;
  let distKm = null;

  // ------------------------------
  // REGLA 1 — Fichajes demasiado seguidos
  // ------------------------------
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
      if (diffMin < 3) {
        razones.push("Fichajes demasiado seguidos (<3 minutos)");
      }
    }
  }

  // ------------------------------
  // REGLA 2 — GPS inválido
  // ------------------------------
  const gpsInvalido =
    lat === null ||
    lng === null ||
    isNaN(Number(lat)) ||
    isNaN(Number(lng)) ||
    Number(lat) < -90 ||
    Number(lat) > 90 ||
    Number(lng) < -180 ||
    Number(lng) > 180;

  if (gpsInvalido) {
    razones.push("Geolocalización inválida o ausente");
  }

  // ------------------------------
  // REGLA 3 — Geocerca de cliente
  // ------------------------------
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
        Number(clienteRows[0].lng),
      );

      if (dist > Number(clienteRows[0].radio_m)) {
        razones.push(
          `Fuera de la zona permitida del cliente. Distancia: ${Math.round(
            dist,
          )}m (máx: ${clienteRows[0].radio_m}m)`,
        );
      }
    }
  }

  // ------------------------------
  // REGLA 4 — IP habitual vs actual
  // ------------------------------
  if (empleadoId && reqIp) {
    const deviceRows = await sql`
      SELECT 
        id, 
        ip_habitual, 
        ip_lat, 
        ip_lng, 
        ip_country, 
        ip_city,
        ip_region,
        ip_timezone,
        ip_provider
      FROM employee_devices_180
      WHERE empleado_id = ${empleadoId}
      LIMIT 1
    `;

    if (deviceRows.length > 0) {
      dev = deviceRows[0];

      const noHabitual =
        (!dev.ip_country && !dev.ip_city && (!dev.ip_lat || !dev.ip_lng)) ||
        !dev.ip_habitual;

      // Guardar IP habitual si no existe
      if (noHabitual) {
        const info = await getIpInfo(reqIp);
        if (info) {
          await sql`
            UPDATE employee_devices_180
            SET 
              ip_habitual = ${info.ip},
              ip_lat = ${info.lat},
              ip_lng = ${info.lng},
              ip_country = ${info.country},
              ip_city = ${info.city},
              ip_region = ${info.region},
              ip_timezone = ${info.timezone},
              ip_provider = ${info.provider}
            WHERE id = ${dev.id}
          `;

          dev = {
            ...dev,
            ip_habitual: info.ip,
            ip_lat: info.lat,
            ip_lng: info.lng,
            ip_country: info.country,
            ip_city: info.city,
            ip_region: info.region,
            ip_timezone: info.timezone,
            ip_provider: info.provider,
          };
        }
      } else {
        infoActual = await getIpInfo(reqIp);

        if (
          infoActual &&
          infoActual.lat != null &&
          infoActual.lng != null &&
          dev.ip_lat != null &&
          dev.ip_lng != null
        ) {
          distKm =
            distanciaMetros(
              Number(dev.ip_lat),
              Number(dev.ip_lng),
              Number(infoActual.lat),
              Number(infoActual.lng),
            ) / 1000;

          if (distKm > 50) {
            razones.push(
              `IP geográficamente alejada de la habitual (~${distKm.toFixed(
                1,
              )} km)`,
            );
          }
        }

        if (
          dev.ip_country &&
          infoActual?.country &&
          dev.ip_country !== infoActual.country
        ) {
          razones.push(
            `País distinto al habitual (${infoActual.country} vs ${dev.ip_country})`,
          );
        }
      }
    }
  }
  // ------------------------------
  // REGLA 5 — Desviación horaria vs planificación
  // ------------------------------
  if (empleadoId && empresaId) {
    try {
      const validacion = await validarFichajeSegunTurno({
        empleadoId,
        empresaId,
        fechaHora: new Date(),
        tipo,
      });

      if (validacion?.incidencias?.length > 0) {
        for (const inc of validacion.incidencias) {
          razones.push(`Horario: ${inc}`);
        }
      }

      if (validacion?.warnings?.length > 0) {
        for (const warn of validacion.warnings) {
          razones.push(`Aviso: ${warn}`);
        }
      }
    } catch (err) {
      console.error("Error validando contra planificación:", err);
      razones.push("No se pudo validar el horario contra planificación");
    }
  }
  // ------------------------------
  // REGLA 6 — Desviación vs bloques de plantilla (plan avanzado)
  // ------------------------------
  if (empleadoId && empresaId) {
    try {
      const validacionPlan = await validarFichajeSegunPlan({
        empresaId,
        empleadoId,
        fechaHora: new Date(),
        tipo,
      });

      if (validacionPlan?.incidencias?.length > 0) {
        for (const inc of validacionPlan.incidencias) {
          razones.push(`Plan: ${inc}`);
        }
      }
    } catch (err) {
      console.error("Error validando contra plan:", err);
      razones.push("Error validando contra plantilla");
    }
  }

  // ------------------------------
  // RESULTADO FINAL
  // ------------------------------
  if (razones.length === 0) {
    return { sospechoso: false, ipInfo: null, distanciaKm: null };
  }

  return {
    sospechoso: true,
    razones,
    ipInfo: {
      habitual: dev
        ? {
            ip: dev.ip_habitual,
            lat: dev.ip_lat,
            lng: dev.ip_lng,
            country: dev.ip_country,
            city: dev.ip_city,
            region: dev.ip_region,
            timezone: dev.ip_timezone,
            provider: dev.ip_provider,
          }
        : null,
      actual: infoActual || null,
    },
    distanciaKm: distKm || null,
  };
};
