
import { sql } from '../src/db.js';

async function getCompanyInfo() {
    try {
        console.log('--- BUSCANDO EMPRESA PARA susanaybenjamin@gmail.com ---');

        // Buscar usuario
        const users = await sql`SELECT id, email FROM users_180 WHERE email = 'susanaybenjamin@gmail.com'`;
        if (users.length === 0) {
            console.log("Usuario no encontrado");
            return;
        }
        const user = users[0];
        console.log(`Usuario encontrado: ${user.id}`);

        // Buscar empresa
        const empresas = await sql`SELECT id, nombre, user_id FROM empresa_180 WHERE user_id = ${user.id}`;
        if (empresas.length === 0) {
            console.log("Empresa no encontrada para este usuario");
            return;
        }
        const empresa = empresas[0];
        console.log(`Empresa encontrada: ID=${empresa.id}, Nombre="${empresa.nombre}"`);

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

getCompanyInfo();
