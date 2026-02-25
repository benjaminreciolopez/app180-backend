import postgres from "postgres";
import { config } from "./config.js";

if (!config.supabase.url) {
  console.error("❌ NO hay cadena de conexión a Supabase");
}

const isTest = process.env.NODE_ENV === 'test';

export const sql = postgres(config.supabase.url, {
  ssl: "require",
  max: isTest ? 5 : 20, // Fewer connections in test (session pooler limit)
  idle_timeout: isTest ? 10 : 20, // Cerrar conexiones inactivas
  max_lifetime: 60 * 30, // Cerrar conexiones después de 30 minutos
  connect_timeout: 10, // Fail-fast si no puede conectar en 10 segundos
});
