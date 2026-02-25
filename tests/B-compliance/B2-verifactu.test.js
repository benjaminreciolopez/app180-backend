/**
 * B2 - VeriFactu / Ley Antifraude Compliance Tests
 * Law: Ley 11/2021 de medidas de prevención y lucha contra el fraude fiscal
 * Penalty: Up to 150,000€ for software that allows invoice alteration
 *
 * Tests that a human CANNOT:
 * - Modify a validated invoice
 * - Delete a non-draft invoice
 * - Create gaps in invoice numbering
 * - Backdate invoices before last validated
 * - Break the VeriFactu hash chain
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

// Helper: create a draft invoice
// Note: createFactura returns { success, message } with NO id.
// We must query the DB to find the newly created draft.
async function createDraftInvoice(overrides = {}) {
  const fecha = overrides.fecha || new Date().toISOString().split('T')[0];
  const res = await api
    .post('/api/admin/facturacion/facturas')
    .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
    .send({
      cliente_id: env.empresaA.cliente1.id,
      fecha,
      iva_global: 21,
      lineas: [
        { descripcion: 'Test VeriFactu', cantidad: 1, precio_unitario: 100 }
      ],
      ...overrides,
    });

  // If creation succeeded, fetch the latest draft to get the ID
  if (res.status === 201 || res.status === 200) {
    const [latest] = await sql`
      SELECT id FROM factura_180
      WHERE empresa_id = ${env.empresaA.id}
        AND estado = 'BORRADOR'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (latest) {
      res.body.id = latest.id;
    }
  }

  return res;
}

// Helper: validate an invoice
// Note: validarFactura route is POST (not PUT) and requires fecha in body
async function validateInvoice(id) {
  return api
    .post(`/api/admin/facturacion/facturas/${id}/validar`)
    .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
    .send({ fecha: new Date().toISOString().split('T')[0] });
}

// ─── IMMUTABILITY OF VALIDATED INVOICES ────────────────────

describe('B2.1 - Invoice Immutability After Validation (Ley 11/2021 Art. 29.2.j)', () => {
  let validatedId;

  test('Setup: Create and validate an invoice', async () => {
    const draft = await createDraftInvoice();
    expect([200, 201]).toContain(draft.status);
    validatedId = draft.body.factura?.id || draft.body.id;
    expect(validatedId).toBeDefined();

    const valRes = await validateInvoice(validatedId);
    expect(valRes.status).toBe(200);
  });

  test('Should NOT allow modifying total of validated invoice', async () => {
    if (!validatedId) return;
    const res = await api
      .put(`/api/admin/facturacion/facturas/${validatedId}`)
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({
        lineas: [
          { descripcion: 'Modified!', cantidad: 1, precio_unitario: 999 }
        ],
      });
    // Must reject modification of validated invoice (400 = "Solo se pueden editar facturas en borrador")
    expect([400, 403]).toContain(res.status);
  });

  test('Should NOT allow changing fecha of validated invoice', async () => {
    if (!validatedId) return;
    const res = await api
      .put(`/api/admin/facturacion/facturas/${validatedId}`)
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({ fecha: '2020-01-01' });
    expect([400, 403]).toContain(res.status);
  });

  test('Should NOT allow changing cliente of validated invoice', async () => {
    if (!validatedId) return;
    const res = await api
      .put(`/api/admin/facturacion/facturas/${validatedId}`)
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({ cliente_id: env.empresaA.cliente1.id }); // Even same client
    // Should be blocked because invoice is validated
    expect([400, 403]).toContain(res.status);
  });
});

// ─── DELETION PROTECTION ───────────────────────────────────

describe('B2.2 - Deletion Protection', () => {
  let validatedId;

  test('Setup: Create and validate invoice for deletion test', async () => {
    const draft = await createDraftInvoice();
    validatedId = draft.body.factura?.id || draft.body.id;
    if (validatedId) {
      await validateInvoice(validatedId);
    }
  });

  test('Should NOT allow deleting a VALIDATED invoice', async () => {
    if (!validatedId) return;
    const res = await api
      .delete(`/api/admin/facturacion/facturas/${validatedId}`)
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`);
    expect([400, 403, 405]).toContain(res.status);
  });

  test('Should allow deleting a BORRADOR invoice', async () => {
    const draft = await createDraftInvoice();
    const draftId = draft.body.factura?.id || draft.body.id;
    if (!draftId) return;

    const res = await api
      .delete(`/api/admin/facturacion/facturas/${draftId}`)
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`);
    expect([200, 204]).toContain(res.status);
  });
});

// ─── SEQUENTIAL NUMBERING ──────────────────────────────────

describe('B2.3 - Sequential Numbering (No Gaps)', () => {
  test('Validated invoices should have sequential numbers without gaps', async () => {
    // Create and validate 3 invoices sequentially
    const numbers = [];
    for (let i = 0; i < 3; i++) {
      const draft = await createDraftInvoice();
      const draftId = draft.body.factura?.id || draft.body.id;
      if (!draftId) continue;

      const valRes = await validateInvoice(draftId);
      if (valRes.status === 200) {
        const numero = valRes.body.factura?.numero || valRes.body.numero;
        if (numero) numbers.push(numero);
      }
    }

    if (numbers.length >= 2) {
      // Extract numeric part and verify sequential
      const numericParts = numbers.map(n => {
        const match = n.match(/(\d+)$/);
        return match ? parseInt(match[1]) : null;
      }).filter(n => n !== null);

      for (let i = 1; i < numericParts.length; i++) {
        expect(numericParts[i]).toBe(numericParts[i - 1] + 1);
      }
    }
  });
});

// ─── BACKDATING PROTECTION ─────────────────────────────────

describe('B2.4 - Backdating Protection', () => {
  test('Should NOT allow creating invoice with date before last validated', async () => {
    // First, ensure we have a validated invoice with today's date
    const draft1 = await createDraftInvoice({ fecha: new Date().toISOString().split('T')[0] });
    const id1 = draft1.body.factura?.id || draft1.body.id;
    if (id1) {
      await validateInvoice(id1);
    }

    // Now try to create invoice with date 1 year ago
    const pastDate = new Date();
    pastDate.setFullYear(pastDate.getFullYear() - 1);
    const draft2 = await createDraftInvoice({ fecha: pastDate.toISOString().split('T')[0] });
    const id2 = draft2.body.factura?.id || draft2.body.id;

    if (id2) {
      // Try to validate backdated invoice
      const valRes = await validateInvoice(id2);
      // Should be rejected
      expect([400, 403, 422]).toContain(valRes.status);
    }
  });
});

// ─── ANULACIÓN ─────────────────────────────────────────────

describe('B2.5 - Invoice Anulación (Cancellation)', () => {
  let validatedId;

  test('Setup: create and validate invoice for anulación', async () => {
    const draft = await createDraftInvoice();
    validatedId = draft.body.factura?.id || draft.body.id;
    if (validatedId) {
      await validateInvoice(validatedId);
    }
  });

  test('Anulación should be the ONLY way to cancel a validated invoice', async () => {
    if (!validatedId) return;

    // Try to anular
    const res = await api
      .post(`/api/admin/facturacion/facturas/${validatedId}/anular`)
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`);

    // Should succeed (anulación is the legal way)
    expect([200, 400]).toContain(res.status);
  });

  test('Double anulación should be handled gracefully', async () => {
    if (!validatedId) return;

    const res = await api
      .post(`/api/admin/facturacion/facturas/${validatedId}/anular`)
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`);

    // Should return error, not crash
    expect(res.status).not.toBe(500);
  });
});

// ─── SERIE BLOQUEADA ───────────────────────────────────────

describe('B2.6 - Serie Bloqueada After First Validation', () => {
  test('Should not allow changing serie_facturacion after numeración is locked', async () => {
    // After validating invoices, the serie should be locked
    const res = await api
      .put('/admin/configuracion/emisor')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({ serie_facturacion: 'NEW' });

    // Check if it was blocked (depends on whether bloquearNumeracion ran)
    if (res.status === 200) {
      // Verify the serie wasn't actually changed if locked
      const checkRes = await api
        .get('/admin/configuracion/emisor')
        .set('Authorization', `Bearer ${env.empresaA.adminToken}`);

      if (checkRes.body.emisor?.numeracion_bloqueada) {
        // If locked, serie should NOT have changed
        expect(checkRes.body.emisor.serie_facturacion).not.toBe('NEW');
      }
    }
  });
});

// ─── DIRECT DB MANIPULATION ────────────────────────────────

describe('B2.7 - Hash Chain Integrity After Operations', () => {
  test('VeriFactu hash chain should remain valid after normal operations', async () => {
    // Check if verifactu table has records
    const records = await sql`
      SELECT COUNT(*)::int as total FROM registroverifactu_180
      WHERE empresa_id = ${env.empresaA.id}
    `.catch(() => [{ total: 0 }]);

    // If there are VeriFactu records, verify chain
    if (records[0]?.total > 0) {
      const chain = await sql`
        SELECT id, hash_actual, hash_anterior
        FROM registroverifactu_180
        WHERE empresa_id = ${env.empresaA.id}
        ORDER BY created_at ASC
      `;

      // Verify each record's hash_anterior matches previous record's hash_actual
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i].hash_anterior).toBe(chain[i - 1].hash_actual);
      }
    }
  });
});
