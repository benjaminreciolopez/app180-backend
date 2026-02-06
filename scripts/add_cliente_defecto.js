import { sql } from "../src/db.js";

async function migrate() {
  try {
    console.log("🚀 Iniciando migración: Agregar cliente_defecto_id a employees_180...");

    // 1. Añadir columna si no existe (usando UUID)
    await sql`
      ALTER TABLE employees_180 
      ADD COLUMN IF NOT EXISTS cliente_defecto_id UUID REFERENCES clients_180(id);
    `;
    
    console.log("✅ Columna cliente_defecto_id creada/verificada (UUID).");

    console.log("🎉 Migración completada con éxito.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error en migración:", err);
    process.exit(1);
  }
}

migrate();
