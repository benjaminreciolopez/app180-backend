
import { sql } from '../src/db.js';

async function updateCompanyName() {
    try {
        const id = '8ea0cef5-795c-4c98-bc5e-63d546a452f8'; // ID from previous step
        const newName = 'Trefilados Urbina';

        console.log(`Actualizando empresa ${id} a "${newName}"...`);

        await sql`
      UPDATE empresa_180
      SET nombre = ${newName}
      WHERE id = ${id}
    `;

        console.log('✅ Nombre de empresa actualizado.');

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

updateCompanyName();
