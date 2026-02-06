import { sql } from "../src/db.js";

async function check() {
    try {
        const ids = await sql`SELECT DISTINCT empresa_id FROM employees_180`;
        console.log(`Found ${ids.length} unique company IDs.`);
        console.log(ids);
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

check();
