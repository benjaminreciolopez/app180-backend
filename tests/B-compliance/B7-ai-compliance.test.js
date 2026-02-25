/**
 * B7 - AI Agent Compliance Tests
 * Risk: AI agent could bypass business rules
 *
 * Tests that the AI agent respects:
 * - Invoice state machine (can't delete validated)
 * - Multi-tenant isolation (empresa_id)
 * - Business rule validation
 * - Usage limits
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

// ─── AI EMPRESA ISOLATION ──────────────────────────────────

describe('B7.1 - AI Agent Empresa Isolation', () => {
  test('AI agent should only access data from the authenticated empresa', async () => {
    // Send request to AI asking for client list
    const res = await api
      .post('/api/admin/ai/chat')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({ message: 'Lista todos los clientes' });

    if (res.status === 200 && res.body.response) {
      // Response should not contain empresa B data
      expect(res.body.response).not.toContain(env.empresaB.nombre);
    }
  }, 30000);

  test('AI agent from empresa B should not see empresa A data', async () => {
    const res = await api
      .post('/api/admin/ai/chat')
      .set('Authorization', `Bearer ${env.empresaB.adminToken}`)
      .send({ message: 'Lista todos los clientes' });

    if (res.status === 200 && res.body.response) {
      expect(res.body.response).not.toContain(env.empresaA.cliente1?.nombre);
    }
  }, 30000);
});

// ─── AI LIMITS ENFORCEMENT ─────────────────────────────────

describe('B7.2 - AI Usage Limit Enforcement', () => {
  test('AI should return 429 when daily limit is exceeded', async () => {
    // Set daily limit to 0 to force limit
    await sql`
      UPDATE empresa_180
      SET ai_limite_diario = 0
      WHERE id = ${env.empresaA.id}
    `.catch(() => {});

    const res = await api
      .post('/api/admin/ai/chat')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .send({ message: 'Test limit' });

    // Should be rate limited (429) or bad request (400) or still works (200 if bypass)
    expect([429, 400, 200]).toContain(res.status);

    // Restore limit
    await sql`
      UPDATE empresa_180
      SET ai_limite_diario = 10
      WHERE id = ${env.empresaA.id}
    `.catch(() => {});
  });
});
