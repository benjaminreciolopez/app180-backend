import { sql } from './src/db.js';
async function run() {
    const c = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='factura_180' AND column_name='id'`;
    console.log(c);
    process.exit();
}
run();
