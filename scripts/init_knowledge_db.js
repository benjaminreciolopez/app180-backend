import { sql } from "../src/db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
    console.log("🚀 Inicializando tabla de conocimiento (conocimiento_180)...");

    try {
        const migrationPath = path.join(__dirname, "../migrations/create_knowledge_base.sql");
        const migrationSql = fs.readFileSync(migrationPath, "utf-8");

        // Ejecutar el SQL
        // Nota: postgres.js permite ejecutar snippets de SQL crudo, pero es mejor usar `sql.unsafe` o similar si es un bloque grande
        // Sin embargo, `sql` tag function suele esperar parámetros.
        // Para ejecutar un archivo SQL crudo, suele ser mejor usar `sql.file` si la librería lo soporta, o `sql.unsafe`.
        // La librería `postgres` tiene `sql.file`? Probemos pasando el string a unsafe.

        await sql.unsafe(migrationSql);

        console.log("✅ Tabla 'conocimiento_180' creada correctamente.");

        // Verificar si ya existe algún dato de prueba, si no, crear uno
        // Necesitamos un empresa_id válido. Vamos a buscar uno cualquiera para prueba o dejarlo vacío.
        // Mejor solo crear la tabla.

    } catch (err) {
        console.error("❌ Error al crear la tabla:", err);
    } finally {
        process.exit();
    }
}

run();
