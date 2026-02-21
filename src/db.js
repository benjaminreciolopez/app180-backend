import postgres from "postgres";
import { config } from "./config.js";

if (!config.supabase.url) {
  console.error("❌ NO hay cadena de conexión a Supabase");
}

export const sql = postgres(config.supabase.url, {
  ssl: "require",
  max: 20, // Límite de conexiones simultáneas
  idle_timeout: 20, // Cerrar conexiones inactivas después de 20 segundos
  max_lifetime: 60 * 30, // Cerrar conexiones después de 30 minutos
  connect_timeout: 10, // Fail-fast si no puede conectar en 10 segundos
});
