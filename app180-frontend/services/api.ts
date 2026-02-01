// services/api.ts
import axios from "axios";
// 🔁 Importación circular necesaria, pero la gestionamos con cuidado
// Importamos solo lo necesario o usamos lazy require si fuera necesario
// Pero como api.ts es base, mejor mover getToken a un archivo aparte o...
// Para simplificar, copiamos la lógica de lectura aquí o importamos de auth
// PERO auth importa api. 
// SOLUCIÓN: Leer storage manualmente aquí para evitar ciclo, pero respetando la lógica.

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "https://app180-backend.onrender.com";

export const api = axios.create({
  baseURL: API_BASE,
});

// ======================================================
// HELPERS INTERNOS PARA EVITAR CICLO CON auth.ts
// ======================================================
function getStoredToken() {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("token") || localStorage.getItem("token");
}

function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
  window.location.href = "/login";
}

// ======================================================
// REQUEST INTERCEPTOR
// ======================================================
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    // Usamos el helper que busca en ambos sitios
    const token = getStoredToken();

    if (token && !config.url?.startsWith("/system")) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }

  return config;
});

// ======================================================
// RESPONSE INTERCEPTOR
// ======================================================
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (typeof window !== "undefined") {
      const status = err?.response?.status;
      const code = err?.response?.data?.code;

      if (code === "PASSWORD_FORCED") {
        window.dispatchEvent(new CustomEvent("password-forced"));
        return Promise.reject(err);
      }

      if (status === 401) {
        const url = err?.config?.url || "";

        if (
          url.startsWith("/system") ||
          url.startsWith("/auth/login") ||
          url.startsWith("/auth/register-admin")
        ) {
          return Promise.reject(err);
        }

        if (
          url.startsWith("/auth") ||
          url.startsWith("/empleado") ||
          url.startsWith("/admin")
        ) {
          // Usamos helper de limpieza total
          clearSession();
        }
      }
    }

    return Promise.reject(err);
  },
);

// ======================================================
// HELPER OPCIONAL (login / logout)
// ======================================================
// ======================================================
// HELPER OPCIONAL (login / logout)
// ======================================================
export function setAuthToken(token?: string | null) {
  if (typeof window === "undefined") return;

  if (token) {
    // Por defecto api.ts no decide dónde guardar, eso lo hace auth.ts
    // Solo actualizamos header axios
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    // Si se llama explícitamente a borrar
    delete api.defaults.headers.common.Authorization;
  }
}
