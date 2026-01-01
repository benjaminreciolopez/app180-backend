// Usa una API pública de geolocalización por IP (ej: ip-api.com)
export const getIpInfo = async (ip) => {
  try {
    if (!ip) return null;

    // Quitar ::ffff: de IPv4 mapeadas
    const cleanIp = ip.startsWith("::ffff:") ? ip.replace("::ffff:", "") : ip;

    const url = `http://ip-api.com/json/${cleanIp}?fields=status,country,city,lat,lon,message`;

    const resp = await fetch(url);
    if (!resp.ok) return null;

    const data = await resp.json();
    if (data.status !== "success") return null;

    return {
      country: data.country || null,
      city: data.city || null,
      lat: data.lat ?? null,
      lng: data.lon ?? null,
    };
  } catch (e) {
    console.error("❌ Error en getIpInfo:", e);
    return null;
  }
};
