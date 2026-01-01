import postgres from "postgres";
import { config } from "./config.js";

if (!config.supabase.url) {
  console.error("❌ NO hay cadena de conexión a Supabase");
}

export const sql = postgres(config.supabase.url, {
  ssl: "require",
});
