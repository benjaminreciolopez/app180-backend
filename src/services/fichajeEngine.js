// backend/src/services/fichajeEngine.js

import { validarFichajeSegunTurno } from "./fichajesValidacionService.js";
import { detectarFichajeSospechoso } from "./fichajeSospechoso.js";
import { getPlanDiaEstado } from "./planDiaEstadoService.js";
import { getYMDMadrid } from "../utils/dateMadrid.js";
import { validarFichajeGeo } from "./geoValidator.js";

/**
 * Motor principal de evaluación de fichajes
 * Fuente única de verdad: planificación + asignaciones backend
 */
export async function evaluarFichaje(ctx) {
  const {
    userId,
    empleado,

    tipo,
    fechaHora,

    lat,
    lng,
    accuracy,

    empresaId,
    reqIp,
  } = ctx;

  /* =====================================================
     Resultado base
  ===================================================== */

  const result = {
    permitido: true,
    bloqueado: false,

    errores: [],
    incidencias: [],

    sospechoso: false,
    razones: [],

    geo: null,
    ipInfo: null,
  };

  /* =====================================================
     1. Turno (regla laboral)
  ===================================================== */

  const turno = await validarFichajeSegunTurno({
    empleadoId: empleado.id,
    empresaId,
    fechaHora,
    tipo,
  });

  if (turno?.incidencias?.length) {
    result.incidencias.push(...turno.incidencias);
  }

  if (turno?.warnings?.length) {
    result.incidencias.push(...turno.warnings);
  }

  /* =====================================================
     2. Planificación + cliente real
  ===================================================== */

  const fechaYMD = getYMDMadrid(fechaHora);

  const plan = await getPlanDiaEstado({
    empresaId,
    empleadoId: empleado.id,
    fecha: fechaYMD,
  });

  if (!plan) {
    result.permitido = false;
    result.bloqueado = true;
    result.errores.push("Planificación no disponible");
    return result;
  }

  if (!plan.boton_visible) {
    result.permitido = false;
    result.bloqueado = true;
    result.errores.push(plan.motivo_oculto || "Fuera de jornada");
    return result;
  }

  // Cliente real (desde backend)
  const cliente = plan?.cliente || null;

  /* =====================================================
     3. Modo orientativo del cliente (no bloqueante)
  ===================================================== */

  if (cliente?.modo_defecto) {
    switch (cliente.modo_defecto) {
      case "mes":
        if (tipo !== "entrada") {
          result.incidencias.push("Modo mensual: fichaje distinto de entrada");
        }
        break;

      case "dia":
        if (tipo !== "entrada") {
          result.incidencias.push("Modo diario: fichaje distinto de entrada");
        }
        break;

      case "trabajo":
        result.incidencias.push("Cliente orientado a trabajos");
        break;

      case "mixto":
      default:
        break;
    }
  }

  /* =====================================================
     4. Normalizar GPS
  ===================================================== */

  const latNum = Number(lat);
  const lngNum = Number(lng);

  const gpsOk =
    Number.isFinite(latNum) &&
    Number.isFinite(lngNum) &&
    latNum >= -90 &&
    latNum <= 90 &&
    lngNum >= -180 &&
    lngNum <= 180;

  /* =====================================================
     5. Geolocalización unificada
  ===================================================== */

  const geoCheck = await validarFichajeGeo({
    empleadoLat: gpsOk ? latNum : null,
    empleadoLng: gpsOk ? lngNum : null,
    accuracy,

    clienteLat: cliente?.lat ?? null,
    clienteLng: cliente?.lng ?? null,
    radio: cliente?.radio_m ?? null,

    ip: reqIp,
  });

  /* ======================
     Guardar info geo
  ====================== */

  /* ======================
     Guardar info geo
  ====================== */

  let geoDireccion = geoCheck.direccion;

  // FALLBACK: Si no hay dirección por GPS (fallo API/reverse), intentar usar info de IP
  if (!geoDireccion && geoCheck.ipInfo) {
    geoDireccion = {
      direccion: null,
      ciudad: geoCheck.ipInfo.city,
      pais: geoCheck.ipInfo.country,
      lat: geoCheck.ipInfo.lat, // fallback IP lat
      lng: geoCheck.ipInfo.lng, // fallback IP lng
    };
  } 
  
  // SIEMPRE asegurar coordenadas reales si GPS es válido
  if (gpsOk) {
    if (!geoDireccion) geoDireccion = {};
    // Sobrescribimos con lo real del dispositivo (más preciso que IP)
    geoDireccion.lat = latNum;
    geoDireccion.lng = lngNum;
  }

  if (
    geoCheck.distancia != null ||
    geoDireccion != null ||
    accuracy != null
  ) {
    result.geo = {
      distancia: geoCheck.distancia ?? null,
      accuracy: accuracy ?? null,
      direccion: geoDireccion ?? null,

      dentro_radio:
        geoCheck.distancia != null && cliente?.radio_m != null
          ? geoCheck.distancia <= cliente.radio_m
          : null,
    };
  }

  if (geoCheck.ipInfo) {
    result.ipInfo = geoCheck.ipInfo;
  }

  /* ======================
     Sospecha geográfica
  ====================== */

  if (geoCheck.sospechoso) {
    result.sospechoso = true;
    result.razones.push(...(geoCheck.motivos || []));
  }

  /* ======================
     Política geográfica
  ====================== */

  if (!geoCheck.permitido) {
    const policy = cliente?.geo_policy || "strict"; // Restauramos lectura real de política

    if (policy === "strict") {
      // CAMBIO: No bloqueamos, solo marcamos sospechoso
      // result.bloqueado = true;
      // result.permitido = false;
      result.sospechoso = true;
      result.razones.push("Fuera del área autorizada (Política estricta)");
      result.incidencias.push("UBICACIÓN INVALIDA: Fichaje permitido pero fuera de rango");
    } else if (policy === "soft") {
      result.incidencias.push("Fuera del área recomendada");
    } else {
      result.incidencias.push("Ubicación fuera del área (informativo)");
    }
  }

  /* =====================================================
     6. Sospecha avanzada (fraude / IP / patrón)
  ===================================================== */

  const sospecha = await detectarFichajeSospechoso({
    userId,
    empleadoId: empleado.id,
    empresaId,
    tipo,
    lat,
    lng,
    clienteId: cliente?.id ?? null,
    reqIp,
  });

  if (sospecha?.sospechoso) {
    result.sospechoso = true;
    result.razones.push(...(sospecha.razones || []));

    if (!result.ipInfo && sospecha.ipInfo) {
      result.ipInfo = sospecha.ipInfo;
    }
  }

  /* =====================================================
     7. Precisión GPS
  ===================================================== */

  if (accuracy && Number(accuracy) > 100) {
    result.incidencias.push("GPS con baja precisión");
  }

  /* =====================================================
     Resultado final
  ===================================================== */

  return result;
}
