import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function resetClientCounter() {
    const pgClient = new pg.Client({
        connectionString: process.env.SUPABASE_URL,
    });

    try {
        await pgClient.connect();

        const empresaId = 'e95bcdbf-85a1-4def-adf3-be7f27688f48';

        // Comprobar cuántos clientes hay realmente
        const countRes = await pgClient.query('SELECT COUNT(*) FROM clients_180 WHERE empresa_id = $1', [empresaId]);
        const actualCount = parseInt(countRes.rows[0].count, 10);
        console.log(`Clientes actuales en la base de datos: ${actualCount}`);

        // Actualizar el contador a la cifra real
        await pgClient.query(`
            UPDATE cliente_seq_180 
            SET last_num = $1 
            WHERE empresa_id = $2
        `, [actualCount, empresaId]);

        console.log(`Contador reseteado a: ${actualCount}. El siguiente será: CLI-${String(actualCount + 1).padStart(5, '0')}`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pgClient.end();
    }
}

resetClientCounter();
