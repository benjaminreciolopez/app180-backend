/**
 * A1 - Smoke Tests
 * Verifies that ALL endpoints respond without 500 errors
 * Auto-generated from route definitions in app.js
 *
 * A 500 error indicates an unhandled exception (bug)
 * Expected responses: 200, 400, 401, 403, 404 - but NEVER 500
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

// ─── PUBLIC ENDPOINTS ──────────────────────────────────────

describe('A1.1 - Public Endpoints Smoke Test', () => {
  const publicGets = [
    '/',
    '/system/status',
    '/system/health',
  ];

  test.each(publicGets)('GET %s should not return 500', async (path) => {
    const res = await api.get(path);
    expect(res.status).not.toBe(500);
  });
});

// ─── AUTH ENDPOINTS ────────────────────────────────────────

describe('A1.2 - Auth Endpoints Smoke Test', () => {
  test('POST /auth/login with empty body should not crash', async () => {
    const res = await api.post('/auth/login').send({});
    expect(res.status).not.toBe(500);
  });

  test('POST /auth/register with empty body should not crash', async () => {
    const res = await api.post('/auth/register').send({});
    expect(res.status).not.toBe(500);
  });

  test('GET /auth/me without token should not crash', async () => {
    const res = await api.get('/auth/me');
    expect(res.status).not.toBe(500);
  });
});

// ─── ADMIN ENDPOINTS (AUTHENTICATED) ──────────────────────

describe('A1.3 - Admin GET Endpoints Smoke Test', () => {
  const adminGets = [
    '/admin/employees',
    '/admin/clientes',
    '/admin/configuracion/emisor',
    '/admin/auditoria',
    '/admin/notificaciones',
    '/api/admin/facturacion/facturas',
    '/api/admin/purchases',
    '/api/admin/nominas',
    '/api/admin/contabilidad/asientos',
    '/api/admin/contabilidad/balance',
    '/api/admin/contabilidad/pyg',
    '/api/admin/contabilidad/cuentas',
    '/api/admin/fiscal/libro-ventas',
    '/api/admin/fiscal/libro-gastos',
    '/api/admin/ai/usage',
  ];

  test.each(adminGets)('GET %s should not return 500', async (path) => {
    const res = await api
      .get(path)
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`);
    expect(res.status).not.toBe(500);
  });
});

// ─── ADMIN POST ENDPOINTS WITH EMPTY BODY ──────────────────

describe('A1.4 - Admin POST Endpoints With Empty Body', () => {
  const adminPosts = [
    '/admin/clientes',
    '/api/admin/facturacion/facturas',
    '/api/admin/purchases',
    '/api/admin/nominas',
    '/api/admin/contabilidad/asientos',
  ];

  test.each(adminPosts)('POST %s with empty body should not return 500', async (path) => {
    const res = await api
      .post(path)
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({});
    // Should return 400 (bad request), not 500
    expect(res.status).not.toBe(500);
  });
});

// ─── EMPLEADO ENDPOINTS ────────────────────────────────────

describe('A1.5 - Empleado Endpoints Smoke Test', () => {
  const empleadoGets = [
    '/auth/me',
    '/fichajes',
  ];

  test.each(empleadoGets)('GET %s as empleado should not return 500', async (path) => {
    const res = await api
      .get(path)
      .set('Authorization', `Bearer ${env.empresaA.empleado1.token}`);
    expect(res.status).not.toBe(500);
  });
});

// ─── ASESOR ENDPOINTS ──────────────────────────────────────

describe('A1.6 - Asesor Endpoints Smoke Test', () => {
  test('GET /asesor/dashboard should not return 500', async () => {
    const res = await api
      .get('/asesor/dashboard')
      .set('Authorization', `Bearer ${env.asesoria.asesorToken}`);
    expect(res.status).not.toBe(500);
  });

  test('GET /asesor/clientes should not return 500', async () => {
    const res = await api
      .get('/asesor/clientes')
      .set('Authorization', `Bearer ${env.asesoria.asesorToken}`);
    expect(res.status).not.toBe(500);
  });
});

// ─── NONEXISTENT ROUTES ────────────────────────────────────

describe('A1.7 - Nonexistent Routes', () => {
  test('GET /api/nonexistent should return 404, not 500', async () => {
    const res = await api
      .get('/api/nonexistent')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`);
    expect(res.status).not.toBe(500);
  });

  test('POST /admin/nonexistent should return 404, not 500', async () => {
    const res = await api
      .post('/admin/nonexistent')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({ test: true });
    expect(res.status).not.toBe(500);
  });
});
