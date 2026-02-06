import { sql } from "../src/db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
    console.log("Inicializando tabla de conocimiento (conocimiento_180)...");

    try {
        // 1. Crear tabla base si no existe (sin columnas nuevas, para que no falle si ya existe sin ellas)
        await sql.unsafe(`
            CREATE TABLE IF NOT EXISTS conocimiento_180 (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                empresa_id UUID NOT NULL,
                token TEXT NOT NULL,
                respuesta TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log("Tabla 'conocimiento_180' verificada/creada.");

        // 2. Aplicar columnas v2 (idempotente)
        const alterSql = fs.readFileSync(
            path.join(__dirname, "../migrations/alter_knowledge_base_v2.sql"), "utf-8"
        );
        await sql.unsafe(alterSql);
        console.log("Columnas v2 aplicadas (categoria, prioridad, activo).");

        // 3. Indexes (ahora que todas las columnas existen)
        await sql.unsafe(`
            CREATE INDEX IF NOT EXISTS idx_conocimiento_empresa ON conocimiento_180 (empresa_id);
            CREATE INDEX IF NOT EXISTS idx_conocimiento_token ON conocimiento_180 (empresa_id, token);
            CREATE INDEX IF NOT EXISTS idx_conocimiento_activo ON conocimiento_180 (empresa_id, activo);
        `);
        console.log("Indexes creados.");

    } catch (err) {
        console.error("Error al crear/actualizar la tabla:", err);
    } finally {
        process.exit();
    }
}

run();
