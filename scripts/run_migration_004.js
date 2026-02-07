import { sql } from "../src/db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
    try {
        console.log("Applying migration 004_create_partes_dia.sql...");

        // Read SQL file
        const sqlPath = path.join(__dirname, "../migrations/004_create_partes_dia.sql");
        const sqlContent = fs.readFileSync(sqlPath, "utf-8");

        // Split by statement if needed, or execute as one block if postgres client supports it
        // Using unsafe/raw query execution for DDL
        await sql.unsafe(sqlContent);

        console.log("✅ Migration applied successfully!");
        process.exit(0);
    } catch (err) {
        console.error("❌ Migration failed:", err);
        process.exit(1);
    }
}

runMigration();
