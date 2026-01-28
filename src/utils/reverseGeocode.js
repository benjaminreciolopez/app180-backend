// backend/src/utils/reverseGeocode.js

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

// Cache simple en memoria (evita machacar Nominatim en refreshes)
const cache = new Map();

/**
 * Reverse geocode (lat/lng -> direccion legible)
 * Nominatim requiere User-Agent identificable.
 */
export async function reverseGeocode({ lat, lng }) {
  const latNum = Number(lat);
  const lngNum = Number(lng);

  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;

  // redondeo para cache (aprox 10-20m dependiendo)
  const key = `${latNum.toFixed(4)},${lngNum.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const url =
      `${NOMINATIM_URL}?format=jsonv2&lat=${encodeURIComponent(latNum)}` +
      `&lon=${encodeURIComponent(lngNum)}&zoom=18&addressdetails=1`;

    const r = await fetch(url, {
      method: "GET",
      headers: {
        // IMPORTANTE: User-Agent identificable (Nominatim policy)
        "User-Agent": "app180-backend/1.0 (admin@app180.local)",
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!r.ok) {
      console.warn(`⚠️ reverseGeocode failed HTTP ${r.status}`);
      return null;
    }

    const data = await r.json();

    const address = data?.address || {};
    const direccion =
      data?.display_name ||
      [
        address.road,
        address.house_number,
        address.neighbourhood,
        address.suburb,
        address.city || address.town || address.village,
        address.state,
        address.country,
      ]
        .filter(Boolean)
        .join(", ");

    const ciudad =
      address.city || address.town || address.village || address.county || null;

    const pais = address.country || null;

    const out = { direccion: direccion || null, ciudad, pais };

    cache.set(key, out);
    return out;
  } catch (err) {
    console.error("❌ reverseGeocode Error:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
