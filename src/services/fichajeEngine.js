// services/fichajeEngine.js

import { validarFichajeSegunTurno } from "./fichajesValidacionService.js";
import { detectarFichajeSospechoso } from "./fichajeSospechoso.js";
import { distanciaMetros } from "../utils/distancia.js";
import { reverseGeocode } from "../utils/reverseGeocode.js";
import { getPlanDiaEstado } from "./planDiaEstadoService.js";
import { getYMDMadrid } from "../utils/dateMadrid.js";

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
     4. Geolocalización
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

  if (cliente?.requiere_geo) {
    if (!gpsOk) {
      result.sospechoso = true;
      result.razones.push("GPS inválido o ausente");
    } else if (
      cliente.lat != null &&
      cliente.lng != null &&
      cliente.radio_m != null
    ) {
      const dist = distanciaMetros(
        latNum,
        lngNum,
        Number(cliente.lat),
        Number(cliente.lng),
      );

      const dentro = dist <= Number(cliente.radio_m);

      result.geo = {
        distancia: Math.round(dist),
        dentro_radio: dentro,
        accuracy: accuracy || null,
        direccion: null,
      };

      if (!dentro) {
        result.sospechoso = true;
        result.razones.push(`Fuera de radio cliente (${Math.round(dist)}m)`);

        // Bloqueo duro solo en modo hora
        if (cliente.modo_trabajo === "hora") {
          result.bloqueado = true;
          result.permitido = false;
          result.errores.push("Fuera del área autorizada");
        }
      }
    }
  }

  /* =====================================================
     5. Dirección legible
  ===================================================== */

  if (gpsOk) {
    const geoTxt = await reverseGeocode({
      lat: latNum,
      lng: lngNum,
    });

    if (geoTxt && result.geo) {
      result.geo.direccion = geoTxt;
    }
  }

  /* =====================================================
     6. Sospecha avanzada (IP, patrones, etc.)
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
    result.ipInfo = sospecha.ipInfo || null;
  }

  /* =====================================================
     7. Precisión GPS
  ===================================================== */

  if (accuracy && accuracy > 100) {
    result.incidencias.push("GPS con baja precisión");
  }

  return result;
}
