import { sql } from "./src/db.js";

async function check() {
    try {
        const cols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'factura_180'
      ORDER BY ordinal_position
    `;
        console.log("Columns of factura_180 (first 10):", JSON.stringify(cols.slice(0, 10), null, 2));
    } catch (err) {
        console.error("Error checking columns:", err);
    } finally {
        process.exit();
    }
}

check();
