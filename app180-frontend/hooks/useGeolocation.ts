// Helper interno para pedir posición con opciones específicas
function getPos(options: PositionOptions): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocalización no soportada"));
      return;
    }

    const timeoutId = setTimeout(() => {
      reject(new Error("Timeout GPS"));
    }, (options.timeout || 10000) + 1000); // 1s extra buffer

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timeoutId);
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        clearTimeout(timeoutId);
        reject(err);
      },
      options
    );
  });
}

export async function getCurrentPosition(): Promise<{
  lat: number;
  lng: number;
}> {
  try {
    // Intento 1: Alta precisión (ideal para móviles/GPS)
    return await getPos({
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 0,
    });
  } catch (err) {
    console.warn("GPS Alta precisión falló, intentando baja precisión (WiFi)...", err);
    // Intento 2: Baja precisión (WiFi/Triangulación - mejor que IP)
    // Mayor timeout para dar tiempo a escanear redes
    return await getPos({
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 30000, // Aceptamos caché reciente
    });
  }
}
