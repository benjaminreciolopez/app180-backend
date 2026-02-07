import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
    const sqliteDbPath = path.join(__dirname, '..', 'facturacion.db');
    const sqliteDb = await open({ filename: sqliteDbPath, driver: sqlite3.Database });

    const pgClient = new pg.Client({
        connectionString: process.env.SUPABASE_URL,
    });

    try {
        await pgClient.connect();
        await pgClient.query('BEGIN');

        // 1. Obtener datos de SQLite
        const sqliteClientes = await sqliteDb.all("SELECT * FROM cliente");
        const sqliteFacturas = await sqliteDb.all("SELECT * FROM factura");
        const sqliteLineas = await sqliteDb.all("SELECT * FROM lineafactura");

        console.log(`Leídos de SQLite: ${sqliteClientes.length} clientes, ${sqliteFacturas.length} facturas, ${sqliteLineas.length} líneas.`);

        // ID de la empresa actual en App180
        const empresaId = 'e95bcdbf-85a1-4def-adf3-be7f27688f48';

        // 2. Mapear y migrar Clientes
        const clienteIdMap = new Map(); // Para mapear ID numérico a UUID

        for (const c of sqliteClientes) {
            const newId = uuidv4();
            clienteIdMap.set(c.id, newId);

            await pgClient.query(`
                INSERT INTO clients_180 (
                    id, empresa_id, nombre, nif, email, direccion, poblacion, cp, provincia, pais, telefono, activo, tipo, requiere_geo, geo_policy
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            `, [
                newId,
                empresaId,
                c.nombre,
                c.nif,
                c.email || '',
                c.direccion || '',
                c.poblacion || '',
                c.cp || '',
                c.provincia || '',
                c.pais ? 'ES' : 'ES',
                c.telefono || '',
                true,
                'cliente', // Valor por defecto
                false,
                'info'
            ]);
            console.log(`Cliente migrado: ${c.nombre}`);
        }

        // 3. Migrar Facturas
        const facturaIdMap = new Map();

        for (const f of sqliteFacturas) {
            const newClienteId = clienteIdMap.get(f.cliente_id);
            if (!newClienteId) {
                console.warn(`Factura ${f.numero} saltada: cliente no encontrado`);
                continue;
            }

            const res = await pgClient.query(`
                INSERT INTO factura_180 (
                    empresa_id, cliente_id, numero, fecha, subtotal, iva_global, iva_total, total, estado, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
                RETURNING id
            `, [
                empresaId,
                newClienteId,
                f.numero,
                f.fecha,
                f.subtotal || f.total, // fallback si no hay subtotal
                f.iva_base || 21,
                f.iva_total || 0,
                f.total,
                'Borrador' // Estado inicial seguro
            ]);

            facturaIdMap.set(f.id, res.rows[0].id);
            console.log(`Factura migrada: ${f.numero}`);
        }

        // 4. Migrar Líneas de Factura
        for (const l of sqliteLineas) {
            const newFacturaId = facturaIdMap.get(l.factura_id);
            if (!newFacturaId) {
                console.warn(`Línea saltada: factura ${l.factura_id} no encontrada`);
                continue;
            }

            await pgClient.query(`
                INSERT INTO lineafactura_180 (
                    factura_id, descripcion, cantidad, precio_unitario, total, iva_percent, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            `, [
                newFacturaId,
                l.descripcion,
                l.cantidad,
                l.precio_unitario,
                l.total,
                l.iva_percent || 21
            ]);
        }
        console.log(`Líneas de factura migradas.`);

        // 5. Actualizar contador de facturación
        await pgClient.query(`
            UPDATE emisor_180 
            SET siguiente_numero = 2 
            WHERE empresa_id = $1
        `, [empresaId]);
        console.log(`Contador de facturación actualizado a 2.`);

        await pgClient.query('COMMIT');
        console.log('MIGRACIÓN COMPLETADA CON ÉXITO');

    } catch (err) {
        await pgClient.query('ROLLBACK');
        console.error('ERROR DURANTE LA MIGRACIÓN:', err);
    } finally {
        await sqliteDb.close();
        await pgClient.end();
    }
}

migrate();
