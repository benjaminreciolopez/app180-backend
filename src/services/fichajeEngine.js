import { validarFichajeSegunTurno } from "./fichajesValidacionService.js";
import { detectarFichajeSospechoso } from "./fichajeSospechoso.js";
import { getPlanDiaEstado } from "./planDiaEstadoService.js";
import { getYMDMadrid } from "../utils/dateMadrid.js";
import { validarFichajeGeo } from "./geoValidator.js";

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
     1. Reglas por modo_trabajo
  ===================================================== */

  if (cliente) {
    switch (cliente.modo_trabajo) {
      case "mes":
        if (tipo !== "entrada") {
          result.bloqueado = true;
          result.permitido = false;
          result.errores.push(
            "Modo mensual: solo se permite fichaje de entrada",
          );
        }
        break;

      case "dia":
        if (tipo !== "entrada") {
          result.incidencias.push("Modo día: fichaje no principal");
        }
        break;

      case "precio_fijo":
        result.incidencias.push("Proyecto a precio fijo");
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

    clienteLat: cliente?.lat ?? null,
    clienteLng: cliente?.lng ?? null,
    radio: cliente?.radio_m ?? null,

    ip: reqIp,
  });

  if (
    geoCheck.distancia != null ||
    geoCheck.direccion != null ||
    accuracy != null
  ) {
    result.geo = {
      distancia: geoCheck.distancia,
      accuracy,
      direccion: geoCheck.direccion,
      dentro_radio:
        geoCheck.distancia != null && cliente?.radio_m != null
          ? geoCheck.distancia <= cliente.radio_m
          : null,
    };
  }

  if (geoCheck.ipInfo) {
    result.ipInfo = geoCheck.ipInfo;
  }

  if (geoCheck.sospechoso) {
    result.sospechoso = true;
    result.razones.push(...geoCheck.motivos);
  }

  if (!geoCheck.permitido) {
    result.bloqueado = true;
    result.permitido = false;
    result.errores.push("Fuera del área autorizada");
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
    clienteId: cliente?.id,
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

  if (accuracy && accuracy > 100) {
    result.incidencias.push("GPS con baja precisión");
  }

  return result;
}
