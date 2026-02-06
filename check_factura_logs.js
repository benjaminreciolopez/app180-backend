import { sql } from "./src/db.js";

async function check() {
    try {
        const rows = await sql`
      SELECT * FROM audit_log_180 
      WHERE entidad_tipo = 'factura' 
      OR accion LIKE '%factura%' 
      ORDER BY created_at DESC 
      LIMIT 10
    `;
        console.log("Audit logs for facturas:", JSON.stringify(rows, null, 2));

        const count = await sql`SELECT COUNT(*) FROM audit_log_180`;
        console.log("Total audit logs:", count);
    } catch (err) {
        console.error("Error:", err);
    } finally {
        process.exit();
    }
}

check();
