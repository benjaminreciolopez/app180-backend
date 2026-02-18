import { sql } from './src/db.js';

async function auditData() {
    try {
        const purchases = await sql`SELECT count(*) FROM purchases_180`;
        const materials = await sql`SELECT count(*) FROM materiales`;
        const expenseConfig = await sql`SELECT count(*) FROM information_schema.columns WHERE table_name = 'work_logs_180' AND column_name = 'precio'`;

        console.log(`- Conteo en purchases_180: ${purchases[0].count}`);
        console.log(`- Conteo en materiales: ${materials[0].count}`);

        process.exit(0);
    } catch (err) {
        console.error('Error auditando datos:', err);
        process.exit(1);
    }
}

auditData();
