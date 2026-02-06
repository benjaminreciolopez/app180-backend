// backend/src/utils/ipLocation.js

// Nota: muchos proveedores bloquean datacenter IPs.
// Esto es "best effort". No fallamos el fichaje por IP.

export async function getIpInfo(ip) {
  try {
    // Limpieza por si llega "::ffff:1.2.3.4"
    const cleanIp = String(ip || "")
      .replace("::ffff:", "")
      .trim();

    if (!cleanIp) return null;

    // ipapi.co (simple). Si falla, devolvemos null.
    const url = `https://ipapi.co/${encodeURIComponent(cleanIp)}/json/`;

    const res = await fetch(url, {
      headers: { "User-Agent": "app180/1.0" },
    });

    if (!res.ok) return null;

    const j = await res.json();

    // ipapi puede devolver "error": true
    if (j?.error) return null;

    return {
      ip: cleanIp,
      city: j?.city ?? null,
      region: j?.region ?? null,
      country: j?.country_name ?? j?.country ?? null,
      timezone: j?.timezone ?? null,
      provider: j?.org ?? j?.asn ?? null,
      lat: j?.latitude ?? j?.lat ?? null,
      lng: j?.longitude ?? j?.lon ?? null,
    };
  } catch {
    return null;
  }
}
