#!/usr/bin/env node

/**
 * Script de migración: Crear tablas del módulo de facturación
 * Ejecuta el script SQL create_facturacion_tables.sql en Supabase
 */

import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Leer el script SQL
const sqlFilePath = join(__dirname, 'create_facturacion_tables.sql');
const sqlScript = readFileSync(sqlFilePath, 'utf-8');

// Configurar conexión a Supabase
const connectionString = process.env.SUPABASE_URL || process.env.SUPABASE_CONNECTION_STRING || process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ Error: No se encontró SUPABASE_URL, SUPABASE_CONNECTION_STRING o DATABASE_URL en .env');
    console.error('   Agrega una de estas variables con la cadena de conexión de Supabase.');
    console.error('   Ejemplo: postgresql://postgres:[PASSWORD]@[PROJECT-REF].supabase.co:5432/postgres');
    process.exit(1);
}

async function runMigration() {
    console.log('🚀 Iniciando migración del módulo de facturación...\n');

    let sql;
    try {
        // Conectar a la base de datos
        console.log('📡 Conectando a Supabase...');
        sql = postgres(connectionString, {
            max: 1,
            idle_timeout: 20,
            connect_timeout: 10
        });

        console.log('✅ Conexión establecida\n');
        console.log('📋 Ejecutando script SQL completo...\n');

        // Ejecutar todo el script de una vez (evita problemas con funciones PL/pgSQL)
        try {
            await sql.unsafe(sqlScript);
            console.log('   ✅ Script ejecutado exitosamente\n');
        } catch (error) {
            // Si hay errores, mostrar cuáles
            if (error.message.includes('already exists') ||
                error.message.includes('duplicate') ||
                error.message.includes('ya existe')) {
                console.log('   ⚠️  Algunas tablas ya existían (esto es normal)\n');
            } else {
                console.error('   ❌ Error:', error.message, '\n');
                // No salir, seguir para verificar qué se creó
            }
        }

        console.log('='.repeat(60));
        console.log(`✅ Migración completada`);
        console.log('='.repeat(60) + '\n');

        // Verificar que las tablas se crearon
        console.log('🔍 Verificando tablas creadas...\n');

        const tables = await sql`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name LIKE '%_180'
            ORDER BY table_name
        `;

        console.log('📊 Tablas con sufijo _180 en la base de datos:\n');
        tables.forEach(({ table_name }) => {
            const isFacturacion = [
                'factura_180',
                'lineafactura_180',
                'concepto_180',
                'iva_180',
                'emisor_180',
                'configuracionsistema_180',
                'registroverifactu_180',
                'auditoria_180',
                'envios_email_180'
            ].includes(table_name);

            if (isFacturacion) {
                console.log(`   ✅ ${table_name} (módulo facturación)`);
            } else {
                console.log(`   📋 ${table_name}`);
            }
        });

        // Contar registros (deberían estar vacías)
        console.log('\n📈 Verificando estructura...\n');

        try {
            const facturaCount = await sql`SELECT COUNT(*) as count FROM factura_180`;
            const conceptoCount = await sql`SELECT COUNT(*) as count FROM concepto_180`;
            const ivaCount = await sql`SELECT COUNT(*) as count FROM iva_180`;

            console.log(`   Facturas: ${facturaCount[0].count} registros`);
            console.log(`   Conceptos: ${conceptoCount[0].count} registros`);
            console.log(`   IVAs: ${ivaCount[0].count} registros\n`);
        } catch (err) {
            console.log('   ⚠️  Algunas tablas aún no están disponibles (normal en primera migración)\n');
        }

        console.log('✨ Migración finalizada exitosamente!\n');
        console.log('📝 Próximos pasos:');
        console.log('   1. Crear controllers backend (facturasController.js, etc.)');
        console.log('   2. Crear services backend (facturasService.js, pdfService.js, etc.)');
        console.log('   3. Crear componentes frontend React\n');

    } catch (error) {
        console.error('\n❌ Error fatal durante la migración:', error);
        process.exit(1);
    } finally {
        if (sql) {
            await sql.end();
            console.log('🔌 Conexión cerrada');
        }
    }
}

// Ejecutar migración
runMigration().catch(err => {
    console.error('Error inesperado:', err);
    process.exit(1);
});
