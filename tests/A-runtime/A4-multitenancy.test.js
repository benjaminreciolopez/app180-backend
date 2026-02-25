/**
 * A4 - Multi-tenancy Isolation Tests
 * Verifies that Empresa A cannot access data from Empresa B and vice versa
 *
 * This is CRITICAL - a multi-tenancy breach exposes ALL customer data
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

// ─── CLIENTS ISOLATION ─────────────────────────────────────

describe('A4.1 - Client Data Isolation', () => {
  test('Admin A listing clients should NOT see empresa B clients', async () => {
    const res = await api
      .get('/admin/clientes')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`);
    if (res.status !== 200) {
      console.warn(`  ⚠️ BUG: GET /admin/clientes returned ${res.status}:`, JSON.stringify(res.body).slice(0, 200));
    }
    expect(res.status).toBe(200);

    const clients = res.body.clientes || res.body;
    if (Array.isArray(clients)) {
      // Verify no client belongs to empresa B
      clients.forEach(client => {
        if (client.empresa_id) {
          expect(client.empresa_id).toBe(env.empresaA.id);
        }
      });
    }
  });

  test('Admin B listing clients should get 0 results (no clients seeded)', async () => {
    const res = await api
      .get('/admin/clientes')
      .set('Authorization', `Bearer ${env.empresaB.adminToken}`);
    expect(res.status).toBe(200);

    const clients = res.body.clientes || res.body;
    if (Array.isArray(clients)) {
      expect(clients.length).toBe(0);
    }
  });
});

// ─── EMPLOYEE ISOLATION ────────────────────────────────────

describe('A4.2 - Employee Data Isolation', () => {
  test('Admin A listing employees should NOT see empresa B employees', async () => {
    const res = await api
      .get('/employees')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`);
    expect(res.status).toBe(200);

    const employees = res.body.employees || res.body.empleados || res.body;
    if (Array.isArray(employees)) {
      employees.forEach(emp => {
        if (emp.empresa_id) {
          expect(emp.empresa_id).toBe(env.empresaA.id);
        }
      });
    }
  });

  test('Admin B should NOT see empresa A employees', async () => {
    const res = await api
      .get('/employees')
      .set('Authorization', `Bearer ${env.empresaB.adminToken}`);
    expect(res.status).toBe(200);

    const employees = res.body.employees || res.body.empleados || res.body;
    if (Array.isArray(employees)) {
      // Admin B may have 1 auto-created self-employee (ensureSelfEmployee in authMiddleware),
      // but must NEVER contain empresa A's employees
      const empresaANames = [env.empresaA.empleado1.nombre, env.empresaA.empleado2.nombre];
      const empresaAEmails = [env.empresaA.empleado1.email, env.empresaA.empleado2.email];
      employees.forEach(emp => {
        if (emp.empresa_id) {
          expect(emp.empresa_id).toBe(env.empresaB.id);
        }
        expect(empresaANames).not.toContain(emp.nombre);
        expect(empresaAEmails).not.toContain(emp.email);
      });
    }
  });
});

// ─── INVOICE ISOLATION ─────────────────────────────────────

describe('A4.3 - Invoice Data Isolation', () => {
  let facturaIdA;

  test('Admin A can create invoice in empresa A', async () => {
    const res = await api
      .post('/api/admin/facturacion/facturas')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({
        cliente_id: env.empresaA.cliente1.id,
        fecha: new Date().toISOString().split('T')[0],
        iva_global: 21,
        lineas: [
          { descripcion: 'Test service', cantidad: 1, precio_unitario: 100 }
        ],
      });
    // May be 200 or 201
    expect([200, 201]).toContain(res.status);
    facturaIdA = res.body.factura?.id || res.body.id;
  });

  test('Admin B should NOT see empresa A invoices', async () => {
    const res = await api
      .get('/api/admin/facturacion/facturas')
      .set('Authorization', `Bearer ${env.empresaB.adminToken}`);
    expect(res.status).toBe(200);

    const facturas = res.body.facturas || res.body;
    if (Array.isArray(facturas)) {
      facturas.forEach(f => {
        if (f.empresa_id) {
          expect(f.empresa_id).not.toBe(env.empresaA.id);
        }
        if (facturaIdA && f.id) {
          expect(f.id).not.toBe(facturaIdA);
        }
      });
    }
  });

  test('Admin B should NOT be able to read empresa A invoice by ID', async () => {
    if (!facturaIdA) return;
    const res = await api
      .get(`/api/admin/facturacion/facturas/${facturaIdA}`)
      .set('Authorization', `Bearer ${env.empresaB.adminToken}`);
    expect([403, 404]).toContain(res.status);
  });
});

// ─── EXPENSE ISOLATION ─────────────────────────────────────

describe('A4.4 - Expense Data Isolation', () => {
  test('Admin B should NOT see empresa A expenses', async () => {
    const res = await api
      .get('/api/admin/purchases')
      .set('Authorization', `Bearer ${env.empresaB.adminToken}`);
    expect(res.status).toBe(200);

    const purchases = res.body.gastos || res.body.purchases || res.body;
    if (Array.isArray(purchases)) {
      purchases.forEach(p => {
        if (p.empresa_id) {
          expect(p.empresa_id).not.toBe(env.empresaA.id);
        }
      });
    }
  });
});

// ─── FICHAJE ISOLATION ─────────────────────────────────────

describe('A4.5 - Time Tracking Isolation', () => {
  test('Empleado from A cannot see fichajes from B context', async () => {
    // Empleado A tries to get fichajes - should only see their own empresa
    const res = await api
      .get('/fichajes')
      .set('Authorization', `Bearer ${env.empresaA.empleado1.token}`);
    // fichajes might need role 'empleado' specifically or 'admin' — accept 200 or 403
    expect([200, 403]).toContain(res.status);

    const fichajes = res.body.fichajes || res.body;
    if (Array.isArray(fichajes)) {
      fichajes.forEach(f => {
        if (f.empresa_id) {
          expect(f.empresa_id).toBe(env.empresaA.id);
        }
      });
    }
  });
});

// ─── ASESOR CROSS-TENANT ───────────────────────────────────

describe('A4.6 - Asesor Cross-tenant Protection', () => {
  test('Asesor linked to A cannot switch to B context', async () => {
    if (!env.asesoria?.asesorToken) return;
    const res = await api
      .get('/api/admin/facturacion/facturas')
      .set('Authorization', `Bearer ${env.asesoria.asesorToken}`)
      .set('X-Empresa-Id', env.empresaB.id);
    expect(res.status).toBe(403);
  });

  test('Asesor with forged X-Empresa-Id (random UUID) should get 403', async () => {
    if (!env.asesoria?.asesorToken) return;
    const res = await api
      .get('/api/admin/facturacion/facturas')
      .set('Authorization', `Bearer ${env.asesoria.asesorToken}`)
      .set('X-Empresa-Id', '00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(403);
  });
});

// ─── ACCOUNTING ISOLATION ──────────────────────────────────

describe('A4.7 - Accounting Data Isolation', () => {
  test('Admin B should NOT see empresa A asientos', async () => {
    const res = await api
      .get('/api/admin/contabilidad/asientos')
      .set('Authorization', `Bearer ${env.empresaB.adminToken}`);
    expect(res.status).toBe(200);

    const asientos = res.body.asientos || res.body;
    if (Array.isArray(asientos)) {
      expect(asientos.length).toBe(0);
    }
  });
});

// ─── CONFIG ISOLATION ──────────────────────────────────────

describe('A4.8 - Configuration Isolation', () => {
  test('Admin A config should not expose empresa B data', async () => {
    const res = await api
      .get('/admin/configuracion/emisor')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`);
    if (res.status === 200 && res.body.emisor) {
      expect(res.body.emisor.empresa_id).toBe(env.empresaA.id);
    }
  });
});
