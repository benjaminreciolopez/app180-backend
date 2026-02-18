import { sql } from './src/db.js';

async function deepAudit() {
    try {
        const workLogs = await sql`SELECT count(*) FROM work_logs_180`;
        const invoices = await sql`SELECT count(*) FROM invoices_180`;
        const employees = await sql`SELECT count(*) FROM employees_180 WHERE activo = true`;
        const clients = await sql`SELECT count(*) FROM clients_180 WHERE activo = true`;
        const fichajes = await sql`SELECT count(*) FROM fichajes_180`;

        console.log(`--- Auditoría de Estado (Core _180) ---`);
        console.log(`- Trabajos Registrados: ${workLogs[0].count}`);
        console.log(`- Facturas Emitidas: ${invoices[0].count}`);
        console.log(`- Clientes Activos: ${clients[0].count}`);
        console.log(`- Empleados en Plantilla: ${employees[0].count}`);
        console.log(`- Historial de Fichajes: ${fichajes[0].count}`);

        // Verificar si hay campos de IVA o retenciones avanzados
        const taxInfo = await sql`SELECT count(*) FROM information_schema.columns WHERE table_name = 'invoices_180' AND column_name = 'irpf'`;
        console.log(`- Soporte de IRPF en facturas: ${taxInfo[0].count > 0 ? 'Sí' : 'No'}`);

        process.exit(0);
    } catch (err) {
        console.error('Error en auditoría profunda:', err);
        process.exit(1);
    }
}

deepAudit();
