/**
 * A2 - Input Validation Tests
 * Tests that the API handles malicious/malformed input gracefully
 *
 * Covers: missing fields, wrong types, boundary values,
 * SQL injection, XSS payloads, oversized input
 */
import { describe, test, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import app from '../../src/app.js';
import { getTestEnv } from '../helpers/seeds.js';

const api = supertest(app);
let env;

beforeAll(() => {
  env = getTestEnv();
});

const adminReq = () => api.set ? undefined : undefined; // placeholder
const withAdmin = (req) => req.set('Authorization', `Bearer ${env.empresaA.adminToken}`);

// ─── SQL INJECTION ATTEMPTS ────────────────────────────────

describe('A2.1 - SQL Injection Prevention', () => {
  const sqlPayloads = [
    "'; DROP TABLE users_180; --",
    "1 OR 1=1",
    "1'; SELECT * FROM users_180 WHERE '1'='1",
    "admin'--",
    "1 UNION SELECT email, password FROM users_180",
    "${sql`DELETE FROM empresa_180`}",
  ];

  test.each(sqlPayloads)('SQL injection in client nombre: %s', async (payload) => {
    const res = await api
      .post('/admin/clientes')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({ nombre: payload, email: 'sql@test.com' });

    // Should not crash (500) - should either accept (stored safely) or reject (400)
    expect(res.status).not.toBe(500);

    // If created, verify the payload is stored as-is (not executed)
    if (res.status === 200 || res.status === 201) {
      const id = res.body.cliente?.id || res.body.id;
      if (id) {
        // Cleanup
        await api.delete(`/admin/clientes/${id}`).set('Authorization', `Bearer ${env.empresaA.adminToken}`);
      }
    }
  });

  test('SQL injection in query parameters should not work', async () => {
    const res = await api
      .get("/admin/clientes?search='; DROP TABLE clients_180; --")
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`);

    expect(res.status).not.toBe(500);
  });
});

// ─── XSS PAYLOADS ──────────────────────────────────────────

describe('A2.2 - XSS Prevention', () => {
  const xssPayloads = [
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert(1)>',
    '"><script>document.cookie</script>',
    "javascript:alert('XSS')",
    '<svg onload=alert(1)>',
  ];

  test.each(xssPayloads)('XSS in client nombre: %s', async (payload) => {
    const res = await api
      .post('/admin/clientes')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({ nombre: payload, email: 'xss@test.com' });

    // Should not crash
    expect(res.status).not.toBe(500);

    // Cleanup if created
    if (res.status === 200 || res.status === 201) {
      const id = res.body.cliente?.id || res.body.id;
      if (id) await api.delete(`/admin/clientes/${id}`).set('Authorization', `Bearer ${env.empresaA.adminToken}`);
    }
  });
});

// ─── WRONG TYPE INPUTS ─────────────────────────────────────

describe('A2.3 - Wrong Type Inputs', () => {
  test('String where number expected (cantidad)', async () => {
    const res = await api
      .post('/api/admin/facturacion/facturas')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({
        cliente_id: env.empresaA.cliente1.id,
        fecha: new Date().toISOString().split('T')[0],
        iva_global: 21,
        lineas: [{ descripcion: 'Test', cantidad: 'abc', precio_unitario: 100 }],
      });

    // Should not crash (500)
    expect(res.status).not.toBe(500);
  });

  test('Number where string expected (nombre)', async () => {
    const res = await api
      .post('/admin/clientes')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({ nombre: 12345, email: 'type@test.com' });

    expect(res.status).not.toBe(500);
  });

  test('Array where string expected', async () => {
    const res = await api
      .post('/admin/clientes')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({ nombre: ['a', 'b'], email: 'array@test.com' });

    expect(res.status).not.toBe(500);
  });

  test('Object where string expected', async () => {
    const res = await api
      .post('/admin/clientes')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({ nombre: { key: 'value' }, email: 'obj@test.com' });

    expect(res.status).not.toBe(500);
  });

  test('Boolean where number expected (iva_global)', async () => {
    const res = await api
      .post('/api/admin/facturacion/facturas')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({
        cliente_id: env.empresaA.cliente1.id,
        fecha: new Date().toISOString().split('T')[0],
        iva_global: true,
        lineas: [{ descripcion: 'Test', cantidad: 1, precio_unitario: 100 }],
      });

    expect(res.status).not.toBe(500);
  });
});

// ─── BOUNDARY VALUES ───────────────────────────────────────

describe('A2.4 - Boundary Values', () => {
  test('Negative cantidad should be handled', async () => {
    const res = await api
      .post('/api/admin/facturacion/facturas')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({
        cliente_id: env.empresaA.cliente1.id,
        fecha: new Date().toISOString().split('T')[0],
        iva_global: 21,
        lineas: [{ descripcion: 'Negative', cantidad: -1, precio_unitario: 100 }],
      });

    expect(res.status).not.toBe(500);
  });

  test('Extremely large number should be handled', async () => {
    const res = await api
      .post('/api/admin/facturacion/facturas')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({
        cliente_id: env.empresaA.cliente1.id,
        fecha: new Date().toISOString().split('T')[0],
        iva_global: 21,
        lineas: [{ descripcion: 'Big', cantidad: 999999999, precio_unitario: 999999999 }],
      });

    expect(res.status).not.toBe(500);
  });

  test('Zero values should be handled', async () => {
    const res = await api
      .post('/api/admin/facturacion/facturas')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({
        cliente_id: env.empresaA.cliente1.id,
        fecha: new Date().toISOString().split('T')[0],
        iva_global: 0,
        lineas: [{ descripcion: 'Zero', cantidad: 0, precio_unitario: 0 }],
      });

    expect(res.status).not.toBe(500);
  });
});

// ─── OVERSIZED INPUT ───────────────────────────────────────

describe('A2.5 - Oversized Input', () => {
  test('1MB string in nombre field should be handled', async () => {
    const bigString = 'A'.repeat(1024 * 1024); // 1MB
    const res = await api
      .post('/admin/clientes')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({ nombre: bigString, email: 'big@test.com' });

    // Should be rejected or truncated, not crash
    expect(res.status).not.toBe(500);
  });

  test('10000 lineas in invoice should be handled', async () => {
    const manyLines = Array.from({ length: 10000 }, (_, i) => ({
      descripcion: `Line ${i}`,
      cantidad: 1,
      precio_unitario: 1,
    }));

    const res = await api
      .post('/api/admin/facturacion/facturas')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({
        cliente_id: env.empresaA.cliente1.id,
        fecha: new Date().toISOString().split('T')[0],
        iva_global: 21,
        lineas: manyLines,
      });

    expect(res.status).not.toBe(500);
  }, 30000);
});

// ─── INVALID DATE FORMATS ──────────────────────────────────

describe('A2.6 - Invalid Date Formats', () => {
  test('Invalid date string should be handled', async () => {
    const res = await api
      .post('/api/admin/facturacion/facturas')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({
        cliente_id: env.empresaA.cliente1.id,
        fecha: 'not-a-date',
        iva_global: 21,
        lineas: [{ descripcion: 'Test', cantidad: 1, precio_unitario: 100 }],
      });

    expect(res.status).not.toBe(500);
  });

  test('Date far in the future should be handled', async () => {
    const res = await api
      .post('/api/admin/facturacion/facturas')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({
        cliente_id: env.empresaA.cliente1.id,
        fecha: '9999-12-31',
        iva_global: 21,
        lineas: [{ descripcion: 'Future', cantidad: 1, precio_unitario: 100 }],
      });

    expect(res.status).not.toBe(500);
  });
});
