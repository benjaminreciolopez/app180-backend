const postgres = require('postgres');
require('dotenv').config();

const { SUPABASE_URL, SUPABASE_KEY, DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

const sql = postgres({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    username: DB_USER,
    password: DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log('🔄 Iniciando migración: agregar columna pdf_path a factura_180...');

        // 1. Agregar columna pdf_path
        await sql`
      ALTER TABLE factura_180 
      ADD COLUMN IF NOT EXISTS pdf_path TEXT;
    `;

        console.log('✅ Columna pdf_path añadida correctamente.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error en migración:', error);
        process.exit(1);
    }
}

migrate();
