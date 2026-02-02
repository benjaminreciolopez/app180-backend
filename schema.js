import { sql } from "./src/db.js";

async function check() {
    try {
        const cols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'factura_180'
      ORDER BY ordinal_position
    `;
        console.log("Columns of factura_180:", JSON.stringify(cols.map(c => c.column_name), null, 2));
    } catch (err) {
        console.error("Error:", err);
    } finally {
        process.exit();
    }
}

check();
