import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function updateClientCodes() {
    const pgClient = new pg.Client({
        connectionString: process.env.SUPABASE_URL,
    });

    try {
        await pgClient.connect();
        await pgClient.query('BEGIN');

        const empresaId = 'e95bcdbf-85a1-4def-adf3-be7f27688f48';

        // 1. Obtener los clientes ordenados por fecha de creación para asignar códigos correlativos
        const res = await pgClient.query(`
            SELECT id, nombre, created_at 
            FROM clients_180 
            WHERE empresa_id = $1 
            ORDER BY created_at ASC
        `, [empresaId]);

        const clients = res.rows;
        console.log(`Actualizando códigos para ${clients.length} clientes...`);

        // 2. Asignar códigos CLI-001, CLI-002, etc.
        for (let i = 0; i < clients.length; i++) {
            const client = clients[i];
            const nextNumber = i + 1;
            const code = `CLI-${String(nextNumber).padStart(3, '0')}`;

            await pgClient.query(`
                UPDATE clients_180 
                SET codigo = $1 
                WHERE id = $2
            `, [code, client.id]);

            console.log(`Asignado código ${code} a cliente: ${client.nombre}`);
        }

        await pgClient.query('COMMIT');
        console.log('CÓDIGOS DE CLIENTE ACTUALIZADOS CON ÉXITO');

    } catch (err) {
        await pgClient.query('ROLLBACK');
        console.error('ERROR ACTUALIZANDO CÓDIGOS:', err);
    } finally {
        await pgClient.end();
    }
}

updateClientCodes();
