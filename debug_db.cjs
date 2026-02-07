
const postgres = require('postgres');
const fs = require('fs');

// Leer del .env manualmente si es necesario
const env = fs.readFileSync('.env', 'utf8');
const match = env.match(/SUPABASE_URL=["']?(.+?)["']?(\s|$)/);
const url = match ? match[1] : null;

if (!url) {
    console.error("No DATABASE_URL found");
    process.exit(1);
}

const sql = postgres(url, { ssl: 'require' });

async function check() {
    try {
        const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'work_logs_180'`;
        console.log("COLUMNS:", JSON.stringify(cols.map(c => c.column_name)));

        const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
        console.log("TABLES:", JSON.stringify(tables.map(t => t.table_name)));
    } catch (e) {
        console.error("ERROR:", e);
    } finally {
        process.exit(0);
    }
}

check();
