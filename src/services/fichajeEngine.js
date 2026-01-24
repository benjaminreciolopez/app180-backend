// backend/src/services/fichajeEngine.js

import { validarFichajeSegunTurno } from "./fichajesValidacionService.js";
import { detectarFichajeSospechoso } from "./fichajeSospechoso.js";
import { getPlanDiaEstado } from "./planDiaEstadoService.js";
import { getYMDMadrid } from "../utils/dateMadrid.js";
import { validarFichajeGeo } from "./geoValidator.js";
import { getWorkContext } from "./workContextService.js";

export async function evaluarFichaje(ctx) {
  const {
    userId,
    empleado,
    cliente,

    tipo,
    fechaHora,

    lat,
    lng,
    accuracy,

    empresaId,
    reqIp,
  } = ctx;

  // Resultado base (debe existir antes de cualquier try/catch)
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

  /* =========================
     Work context
  ========================= */

  let contexto = null;

  if (cliente?.id) {
    try {
      contexto = await getWorkContext({
        empresaId,
        clienteId: cliente.id,
        fecha: getYMDMadrid(fechaHora),
      });
    } catch {
      result.permitido = false;
      result.bloqueado = true;
      result.errores.push("Cliente no válido");
      return result;
    }
  }

  /* =====================================================
     1. Modo orientativo del cliente (no bloqueante)
  ===================================================== */

  if (contexto?.cliente?.modo_defecto) {
    switch (contexto.cliente.modo_defecto) {
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
        // No avisamos
        break;
    }
  }

  /* =====================================================
     2. Turno
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
     3. Planificación
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
  } else if (!plan.boton_visible) {
    result.permitido = false;
    result.bloqueado = true;
    result.errores.push(plan.motivo_oculto || "Fuera de jornada");
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

    clienteLat: contexto?.cliente?.lat ?? null,
    clienteLng: contexto?.cliente?.lng ?? null,
    radio: contexto?.cliente?.radio ?? null,

    ip: reqIp,
  });

  if (
    geoCheck.distancia != null ||
    geoCheck.direccion != null ||
    accuracy != null
  ) {
    result.geo = {
      distancia: geoCheck.distancia,
      accuracy: accuracy ?? null,
      direccion: geoCheck.direccion ?? null,
      dentro_radio:
        geoCheck.distancia != null && contexto?.cliente?.radio != null
          ? geoCheck.distancia <= contexto.cliente.radio
          : null,
    };
  }

  if (geoCheck.ipInfo) {
    result.ipInfo = geoCheck.ipInfo;
  }

  if (geoCheck.sospechoso) {
    result.sospechoso = true;
    result.razones.push(...(geoCheck.motivos || []));
  }

  if (!geoCheck.permitido) {
    const policy = contexto?.cliente?.geo_policy || "strict";

    if (policy === "strict") {
      result.bloqueado = true;
      result.permitido = false;
      result.errores.push("Fuera del área autorizada");
    } else if (policy === "soft") {
      result.incidencias.push("Fuera del área recomendada");
    } else {
      // info: no bloquea, solo informa
      result.incidencias.push("Ubicación fuera del área (informativo)");
    }
  }

  /* =====================================================
     6. Sospecha avanzada
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

  return result;
}
