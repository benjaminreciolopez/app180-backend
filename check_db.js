import { sql } from "./src/db.js";

async function check() {
    try {
        const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%audit%';
    `;
        console.log("Tables found:", tables);

        if (tables.some(t => t.table_name === 'audit_log_180')) {
            const count = await sql`SELECT COUNT(*) FROM audit_log_180`;
            console.log("Audit log count:", count);

            const last = await sql`SELECT * FROM audit_log_180 ORDER BY created_at DESC LIMIT 5`;
            console.log("Last 5 records:", last);
        } else {
            console.log("Table audit_log_180 NOT FOUND!");
        }
    } catch (err) {
        console.error("Error checking DB:", err);
    } finally {
        process.exit();
    }
}

check();
