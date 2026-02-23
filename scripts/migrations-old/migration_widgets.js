const postgres = require('postgres');
const { config } = require('./src/config.js');

const sql = postgres(config.supabase.url, { ssl: 'require' });

async function run() {
    try {
        console.log('🚀 Iniciando migración: dashboard_widgets_mobile');
        await sql`
      ALTER TABLE empresa_config_180 
      ADD COLUMN IF NOT EXISTS dashboard_widgets_mobile JSONB DEFAULT '[]'::jsonb;
    `;
        console.log('✅ Columna añadida/verificada correctamente');
    } catch (err) {
        console.error('❌ Error en migración:', err);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

run();
