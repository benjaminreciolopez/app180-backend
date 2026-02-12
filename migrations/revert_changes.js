
import { sql } from '../src/db.js';

async function revertChanges() {
    try {
        console.log('--- REVIRTIENDO CAMBIOS ---');

        // 1. Restaurar nombre de empresa del usuario Google
        const googleCompanyId = '8ea0cef5-795c-4c98-bc5e-63d546a452f8';
        const originalName = 'susanaybenjamin@gmail.com';

        console.log(`Restaurando empresa ${googleCompanyId} a "${originalName}"...`);
        await sql`
      UPDATE empresa_180
      SET nombre = ${originalName}
      WHERE id = ${googleCompanyId}
    `;
        console.log('✅ Nombre restaurado.');

        // 2. Eliminar el usuario y empresa "Trefilados Urbina" creados por error
        const emailToDelete = 'info@trefiladosurbina.com';
        console.log(`Buscando usuario ${emailToDelete} para eliminar...`);

        const users = await sql`SELECT id FROM users_180 WHERE email=${emailToDelete}`;
        if (users.length > 0) {
            const userId = users[0].id;

            // Borrar empresa asociada
            await sql`DELETE FROM empresa_180 WHERE user_id=${userId}`;
            // Borrar usuario
            await sql`DELETE FROM users_180 WHERE id=${userId}`;
            console.log('✅ Usuario y empresa "Trefilados Urbina" eliminados.');
        } else {
            console.log('Usuario no encontrado, nada que borrar.');
        }

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

revertChanges();
