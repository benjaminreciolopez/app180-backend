
import { sql } from '../src/db.js';
import bcrypt from 'bcryptjs';

console.log('Script iniciado');

async function restoreAdmin() {
    try {
        console.log('Conectando a DB...');
        // Prueba de conexión simple
        const version = await sql`SELECT version()`;
        console.log('Conexión OK:', version[0].version);

        const email = 'info@trefiladosurbina.com';
        const password = 'admin';
        const nombre = 'Admin';
        const empresaNombre = 'Trefilados Urbina';

        console.log(`Verificando usuario ${email}...`);
        const existing = await sql`SELECT id FROM users_180 WHERE email=${email}`;

        if (existing.length > 0) {
            console.log('⚠️ El usuario ya existe. Saltando creación.');
            console.log('ID existente:', existing[0].id);

            // Asegurarnos que tiene empresa
            const emp = await sql`SELECT id FROM empresa_180 WHERE user_id=${existing[0].id}`;
            if (emp.length === 0) {
                console.log('Usuario sin empresa. Creando empresa...');
                const nuevaEmpresa = await sql`
                INSERT INTO empresa_180 (user_id, nombre)
                VALUES (${existing[0].id}, ${empresaNombre})
                RETURNING id
            `;
                console.log('Empresa creada:', nuevaEmpresa[0].id);
                await sql`
                INSERT INTO empresa_config_180 (empresa_id)
                VALUES (${nuevaEmpresa[0].id})
            `;
            } else {
                console.log('Empresa ya existente:', emp[0].id);
            }

            return;
        }

        console.log('Creando hash de contraseña...');
        const hash = await bcrypt.hash(password, 10);

        console.log('Insertando usuario...');
        const user = await sql`
      INSERT INTO users_180 (
        email, password, nombre, role, password_forced
      ) VALUES (
        ${email}, ${hash}, ${nombre}, 'admin', false
      )
      RETURNING id
    `;
        const userId = user[0].id;
        console.log(`Usuario creado: ${userId}`);

        console.log('Insertando empresa...');
        const empresa = await sql`
      INSERT INTO empresa_180 (user_id, nombre)
      VALUES (${userId}, ${empresaNombre})
      RETURNING id
    `;
        const empresaId = empresa[0].id;
        console.log(`Empresa creada: ${empresaId}`);

        console.log('Insertando configuración...');
        await sql`
      INSERT INTO empresa_config_180 (empresa_id)
      VALUES (${empresaId})
    `;
        console.log('Configuración inicial creada.');

        console.log('\n✅ RESTAURACIÓN COMPLETADA');
        console.log(`Usuario: ${email}`);
        console.log(`Pass: ${password}`);

    } catch (err) {
        console.error('❌ Error fatal:', err);
        console.error(err.stack);
    } finally {
        console.log('Cerrando conexión...');
        await sql.end();
        process.exit(0);
    }
}

restoreAdmin();
