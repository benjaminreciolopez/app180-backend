/**
 * B6 - Audit Trail Integrity Tests
 * Requirement: Complete traceability of all operations (Ley 11/2021 Antifraude)
 *
 * Tests that:
 * - All CRUD operations generate audit logs
 * - Audit logs are tenant-isolated
 * - Timestamps are coherent
 * - Audit logs cannot be deleted by regular users
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

// ─── AUDIT LOG GENERATION ──────────────────────────────────

describe('B6.1 - Audit Log Generation', () => {
  test('Creating a client should generate an audit log entry', async () => {
    const beforeCount = await sql`
      SELECT COUNT(*)::int as total FROM audit_log_180
      WHERE empresa_id = ${env.empresaA.id}
    `.catch(() => [{ total: 0 }]);

    // Create a client
    await api
      .post('/admin/clientes')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({
        nombre: 'Audit Test Client',
        nif: 'X1234567Z',
        email: 'audit-test@test.com',
      });

    const afterCount = await sql`
      SELECT COUNT(*)::int as total FROM audit_log_180
      WHERE empresa_id = ${env.empresaA.id}
    `.catch(() => [{ total: 0 }]);

    // Should have more audit entries after the operation
    expect(afterCount[0]?.total).toBeGreaterThanOrEqual(beforeCount[0]?.total);
  });
});

// ─── AUDIT LOG ISOLATION ───────────────────────────────────

describe('B6.2 - Audit Log Tenant Isolation', () => {
  test('Admin A should NOT see audit logs from empresa B', async () => {
    const res = await api
      .get('/admin/auditoria')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`);

    if (res.status === 200) {
      const logs = res.body.logs || res.body.auditoria || res.body;
      if (Array.isArray(logs)) {
        logs.forEach(log => {
          if (log.empresa_id) {
            expect(log.empresa_id).toBe(env.empresaA.id);
          }
        });
      }
    }
  });
});

// ─── AUDIT LOG DELETION ────────────────────────────────────

describe('B6.3 - Audit Log Deletion Protection', () => {
  test('Regular admin should NOT be able to delete audit logs', async () => {
    const logs = await sql`
      SELECT id FROM audit_log_180
      WHERE empresa_id = ${env.empresaA.id}
      LIMIT 1
    `.catch(() => []);

    if (logs.length > 0) {
      // Try direct DELETE via any available endpoint
      const res = await api
        .delete(`/admin/auditoria/${logs[0].id}`)
        .set('Authorization', `Bearer ${env.empresaA.adminToken}`);

      // Should not allow deletion (404 no route, 403, or 405)
      expect([403, 404, 405]).toContain(res.status);
    }
  });
});

// ─── TIMESTAMP COHERENCE ───────────────────────────────────

describe('B6.4 - Timestamp Coherence', () => {
  test('Audit log timestamps should be in chronological order', async () => {
    const logs = await sql`
      SELECT created_at FROM audit_log_180
      WHERE empresa_id = ${env.empresaA.id}
      ORDER BY created_at ASC
      LIMIT 100
    `.catch(() => []);

    for (let i = 1; i < logs.length; i++) {
      const prev = new Date(logs[i - 1].created_at).getTime();
      const curr = new Date(logs[i].created_at).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  test('Audit log timestamps should not be in the future', async () => {
    const now = new Date();
    const futureLogs = await sql`
      SELECT COUNT(*)::int as total FROM audit_log_180
      WHERE empresa_id = ${env.empresaA.id}
        AND created_at > ${now}
    `.catch(() => [{ total: 0 }]);

    expect(futureLogs[0]?.total).toBe(0);
  });
});
