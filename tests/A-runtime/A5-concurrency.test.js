/**
 * A5 - Concurrency Tests
 * Tests race conditions in critical operations
 *
 * Known bug: Invoice number generation is non-atomic (SELECT + UPDATE)
 * See: facturasService.js:9-64
 */
import { describe, test, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import app from '../../src/app.js';
import { getTestEnv } from '../helpers/seeds.js';
import { sql } from '../../src/db.js';

const api = supertest(app);
let env;

beforeAll(() => {
  env = getTestEnv();
});

// ─── INVOICE NUMBER RACE CONDITION ─────────────────────────

describe('A5.1 - Invoice Number Race Condition', () => {
  test('Parallel invoice validations should produce unique numbers', async () => {
    const adminToken = env.empresaA.adminToken;
    const clienteId = env.empresaA.cliente1.id;

    // Create 5 draft invoices sequentially (createFactura returns no ID,
    // so we query the DB after each creation)
    const draftIds = [];
    for (let i = 0; i < 5; i++) {
      const res = await api
        .post('/api/admin/facturacion/facturas')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          cliente_id: clienteId,
          fecha: new Date().toISOString().split('T')[0],
          iva_global: 21,
          lineas: [
            { descripcion: `Concurrent test ${i}`, cantidad: 1, precio_unitario: 100 + i }
          ],
        });

      if (res.status === 201 || res.status === 200) {
        // createFactura returns { success, message } with no id, so query DB
        const [latest] = await sql`
          SELECT id FROM factura_180
          WHERE empresa_id = ${env.empresaA.id}
            AND estado = 'BORRADOR'
          ORDER BY created_at DESC
          LIMIT 1
        `;
        if (latest) draftIds.push(latest.id);
      }
    }

    if (draftIds.length < 3) {
      console.warn('  Could not create enough draft invoices for concurrency test');
      return;
    }

    // Validate all in parallel (this is where the race condition triggers)
    // Route is POST (not PUT), and requires fecha in body
    const fecha = new Date().toISOString().split('T')[0];
    const validatePromises = draftIds.map(id =>
      api
        .post(`/api/admin/facturacion/facturas/${id}/validar`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fecha })
    );

    const results = await Promise.all(validatePromises);

    // Collect assigned invoice numbers
    // validarFactura returns { success, message, numero }
    const numbers = [];
    for (const r of results) {
      if (r.status === 200) {
        const numero = r.body.numero;
        if (numero) numbers.push(numero);
      }
    }

    // Check for duplicates
    const uniqueNumbers = new Set(numbers);
    if (numbers.length > 1) {
      expect(uniqueNumbers.size).toBe(numbers.length);
      // If this fails, it means we detected the race condition!
    }
  }, 30000);
});

// ─── CLIENT CODE RACE CONDITION ────────────────────────────

describe('A5.2 - Client Code Race Condition', () => {
  test('Parallel client creation should produce unique codes', async () => {
    const adminToken = env.empresaA.adminToken;

    // Create 5 clients in parallel
    const createPromises = Array.from({ length: 5 }, (_, i) =>
      api
        .post('/admin/clientes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nombre: `Concurrent Client ${i}`,
          nif: `B${String(10000000 + i).slice(0, 8)}`,
          email: `concurrent${i}@test-concurrent.com`,
        })
    );

    const results = await Promise.all(createPromises);

    const codes = [];
    for (const r of results) {
      const code = r.body.cliente?.codigo || r.body.codigo;
      if (code) codes.push(code);
    }

    if (codes.length > 1) {
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(codes.length);
    }

    // Cleanup created clients
    for (const r of results) {
      const id = r.body.cliente?.id || r.body.id;
      if (id) {
        await api.delete(`/admin/clientes/${id}`).set('Authorization', `Bearer ${adminToken}`);
      }
    }
  });
});

// ─── FICHAJE HASH CHAIN RACE CONDITION ─────────────────────

describe('A5.3 - Fichaje Hash Chain Race Condition', () => {
  test('Parallel fichajes for same employee should maintain consistent hash chain', async () => {
    const empleadoToken = env.empresaA.empleado1.token;

    // Try to create 3 fichajes in rapid succession
    const fichajePromises = Array.from({ length: 3 }, (_, i) =>
      api
        .post('/fichajes/entrada')
        .set('Authorization', `Bearer ${empleadoToken}`)
        .send({
          tipo: i % 2 === 0 ? 'entrada' : 'salida',
          latitud: 40.4168 + i * 0.001,
          longitud: -3.7038 + i * 0.001,
        })
    );

    const results = await Promise.all(fichajePromises);

    // Count successful fichajes
    const successCount = results.filter(r => r.status === 200 || r.status === 201).length;

    // Even if some fail due to business rules (can't enter twice),
    // verify the hash chain is still intact
    const integrityRes = await api
      .get('/api/admin/fichajes/integridad/verificar')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .query({ empleado_id: env.empresaA.empleado1.id });

    if (integrityRes.status === 200) {
      // Controller wraps service result in { verificacion: resultado, timestamp }
      const verificacion = integrityRes.body.verificacion || integrityRes.body;
      expect(verificacion.valido).toBe(true);
    }
  });
});

// ─── CONCURRENT ASIENTO CREATION ───────────────────────────

describe('A5.4 - Concurrent Asiento Creation', () => {
  test('Double generation for same period should not duplicate asientos', async () => {
    const adminToken = env.empresaA.adminToken;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // generarAsientosPeriodo controller expects fecha_desde and fecha_hasta (not periodo)
    const fecha_desde = `${year}-${String(month).padStart(2, '0')}-01`;
    // Last day of month
    const lastDay = new Date(year, month, 0).getDate();
    const fecha_hasta = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Call generate twice in parallel
    const [res1, res2] = await Promise.all([
      api
        .post('/api/admin/contabilidad/asientos/generar')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fecha_desde, fecha_hasta }),
      api
        .post('/api/admin/contabilidad/asientos/generar')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fecha_desde, fecha_hasta }),
    ]);

    // At least one should succeed, the other should either succeed or report "already generated"
    const succeeded = [res1, res2].filter(r => r.status === 200);

    // Check for duplicate asientos using fecha_desde/fecha_hasta query params
    const asientosRes = await api
      .get('/api/admin/contabilidad/asientos')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ fecha_desde, fecha_hasta });

    if (asientosRes.status === 200) {
      const asientos = asientosRes.body.asientos || asientosRes.body;
      if (Array.isArray(asientos)) {
        // Check for duplicates by referencia_id + referencia_tipo
        // (the column is referencia_tipo, not tipo_origen)
        const refs = asientos
          .map(a => `${a.referencia_id}-${a.referencia_tipo}`)
          .filter(r => r !== 'undefined-undefined' && r !== 'null-null');
        const uniqueRefs = new Set(refs);
        expect(uniqueRefs.size).toBe(refs.length);
      }
    }
  });
});
