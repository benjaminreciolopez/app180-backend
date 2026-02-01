// services/geoValidator.js

import { distanciaMetros } from "../utils/distancia.js";
import { getIpInfo } from "../utils/ipLocation.js";
import { reverseGeocode } from "../utils/reverseGeocode.js";

export async function validarFichajeGeo({
  empleadoLat,
  empleadoLng,
  accuracy,

  clienteLat,
  clienteLng,
  radio,

  ip,
}) {


  const out = {
    permitido: true,
    distancia: null,
    sospechoso: false,
    motivos: [],
    ipInfo: null,
    direccion: null,
  };

  /* =========================
     1. Distancia
  ========================= */

  const d = distanciaMetros(empleadoLat, empleadoLng, clienteLat, clienteLng);

  if (!Number.isFinite(d)) {
    out.sospechoso = true;
    out.motivos.push("coordenadas_invalidas");
  } else {
    out.distancia = Math.round(d);

    if (d > radio) {
      out.permitido = false;
      out.sospechoso = true;
      out.motivos.push("fuera_de_radio");
    }
  }

  /* =========================
     2. Precisión GPS
  ========================= */

  if (accuracy && accuracy > 100) {
    out.sospechoso = true;
    out.motivos.push("gps_impreciso");
  }

  /* =========================
     3. IP info (heurístico)
  ========================= */

  if (ip) {
    out.ipInfo = await getIpInfo(ip);

    if (out.ipInfo?.provider?.toLowerCase().includes("vpn")) {
      out.sospechoso = true;
      out.motivos.push("vpn_detectado");
    }
  }

  /* =========================
     4. Dirección legible
  ========================= */

  /* =========================
     4. Dirección legible
  ========================= */

  const latNum = Number(empleadoLat);
  const lngNum = Number(empleadoLng);

  if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
    out.direccion = await reverseGeocode({
      lat: latNum,
      lng: lngNum,
    });
  }

  return out;
}
