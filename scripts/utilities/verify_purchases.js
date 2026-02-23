import { sql } from './src/db.js';

async function verifyPurchasesModule() {
    try {
        const testEmpresaId = '00000000-0000-0000-0000-000000000000'; // ID genérico para test

        // 1. Simular creación
        console.log('Probando inserción de compra...');
        const [newPurchase] = await sql`
      INSERT INTO purchases_180 (
        empresa_id, proveedor, descripcion, total, fecha_compra, categoria, activo
      ) VALUES (
        ${testEmpresaId}, 'Test Provider', 'Gasto de prueba Nivel Dios', 99.99, NOW(), 'test', true
      ) RETURNING *
    `;
        console.log('✅ Compra creada:', newPurchase.id);

        // 2. Simular listado
        console.log('Probando listado de compras...');
        const rows = await sql`SELECT * FROM purchases_180 WHERE empresa_id = ${testEmpresaId} AND activo = true`;
        if (rows.length > 0) {
            console.log(`✅ Listado correcto: ${rows.length} registros.`);
        }

        // 3. Limpieza de test
        await sql`DELETE FROM purchases_180 WHERE empresa_id = ${testEmpresaId}`;
        console.log('✅ Datos de prueba eliminados.');

        process.exit(0);
    } catch (err) {
        console.error('❌ Error en verificación:', err);
        process.exit(1);
    }
}

verifyPurchasesModule();
