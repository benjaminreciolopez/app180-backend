import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function verifyWorkLogs() {
    const client = new pg.Client({
        connectionString: process.env.SUPABASE_URL,
    });

    try {
        await client.connect();

        const empresaId = 'e95bcdbf-85a1-4def-adf3-be7f27688f48';
        const empleadoId = 'ee8bc24f-bd34-44e0-b601-9f2adbea0e36';

        console.log('--- 1. Creando trabajo de prueba (con detalles y plantilla) ---');
        const insertRes = await client.query(`
            INSERT INTO work_logs_180 
            (empresa_id, employee_id, descripcion, detalles, fecha, minutos, valor, estado_pago)
            VALUES ($1, $2, $3, $4, NOW(), 60, 20.0, 'pendiente')
            RETURNING id
        `, [empresaId, empleadoId, 'Test Trabajo', 'Detalles de prueba']);
        const workLogId = insertRes.rows[0].id;
        console.log(`Creado work_log ID: ${workLogId}`);

        console.log('--- 2. Verificando columna detalles ---');
        const checkDet = await client.query('SELECT detalles FROM work_logs_180 WHERE id = $1', [workLogId]);
        console.log('Valor detalles:', checkDet.rows[0].detalles);

        console.log('--- 3. Creando plantilla de prueba ---');
        await client.query(`
            INSERT INTO work_log_templates_180 (empresa_id, descripcion, detalles)
            VALUES ($1, $2, $3)
        `, [empresaId, 'Plantilla Test', 'Detalle de plantilla']);
        console.log('Plantilla creada.');

        console.log('--- 4. Listando plantillas ---');
        const templates = await client.query('SELECT * FROM work_log_templates_180 WHERE empresa_id = $1', [empresaId]);
        console.table(templates.rows);

        // Limpieza parcial
        console.log('--- 5. Limpiando datos de prueba ---');
        await client.query('DELETE FROM work_logs_180 WHERE id = $1', [workLogId]);
        await client.query('DELETE FROM work_log_templates_180 WHERE descripcion = $1', ['Plantilla Test']);
        console.log('Limpieza completada.');

        console.log('\n✅ Verificación de Base de Datos EXITOSA');

    } catch (err) {
        console.error('❌ Error en verificación:', err);
    } finally {
        await client.end();
    }
}

verifyWorkLogs();
