/**
 * A6 - File Upload Tests
 * Tests file upload edge cases and security
 *
 * Covers: oversized files, fake MIME types, path traversal,
 * empty files, special characters in filenames
 */
import { describe, test, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import app from '../../src/app.js';
import { getTestEnv } from '../helpers/seeds.js';
import path from 'path';

const api = supertest(app);
let env;

beforeAll(() => {
  env = getTestEnv();
});

// ─── FILE SIZE LIMITS ──────────────────────────────────────

describe('A6.1 - File Size Limits', () => {
  test('File >10MB should be rejected on standard upload', async () => {
    // Create a 11MB buffer
    const bigBuffer = Buffer.alloc(11 * 1024 * 1024, 'A');

    const res = await api
      .post('/api/admin/purchases')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .attach('documento', bigBuffer, 'big-file.pdf')
      .field('descripcion', 'Big file test')
      .field('fecha_compra', new Date().toISOString().split('T')[0])
      .field('base_imponible', '100')
      .field('iva_importe', '21')
      .field('categoria', 'test');

    // Should be rejected (413 or 400)
    expect([400, 413]).toContain(res.status);
  });
});

// ─── EMPTY FILES ───────────────────────────────────────────

describe('A6.2 - Empty Files', () => {
  test('Empty file (0 bytes) should be handled', async () => {
    const emptyBuffer = Buffer.alloc(0);

    const res = await api
      .post('/api/admin/purchases')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .attach('documento', emptyBuffer, 'empty.pdf')
      .field('descripcion', 'Empty file test')
      .field('fecha_compra', new Date().toISOString().split('T')[0])
      .field('base_imponible', '100')
      .field('iva_importe', '21');

    // Should not crash
    expect(res.status).not.toBe(500);
  });
});

// ─── PATH TRAVERSAL ────────────────────────────────────────

describe('A6.3 - Path Traversal Prevention', () => {
  const traversalNames = [
    '../../etc/passwd',
    '..\\..\\windows\\system32\\config\\sam',
    '../../../src/config.js',
    'file%2F..%2F..%2Fetc%2Fpasswd',
    '\x00malicious.pdf',
  ];

  test.each(traversalNames)('Path traversal filename: %s', async (filename) => {
    const smallBuffer = Buffer.from('fake pdf content');

    const res = await api
      .post('/api/admin/purchases')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .attach('documento', smallBuffer, filename)
      .field('descripcion', 'Path traversal test')
      .field('fecha_compra', new Date().toISOString().split('T')[0])
      .field('base_imponible', '100')
      .field('iva_importe', '21');

    // Should not crash - either reject (400) or sanitize filename
    expect(res.status).not.toBe(500);
  });
});

// ─── SPECIAL CHARACTERS IN FILENAMES ───────────────────────

describe('A6.4 - Special Characters in Filenames', () => {
  const specialNames = [
    'file<script>alert(1)</script>.pdf',
    'file;rm -rf /.pdf',
    'file$(whoami).pdf',
    'file`id`.pdf',
    'file|ls.pdf',
    "file'OR 1=1'.pdf",
  ];

  test.each(specialNames)('Special filename: %s', async (filename) => {
    const buffer = Buffer.from('%PDF-1.4 fake');

    const res = await api
      .post('/api/admin/purchases')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .attach('documento', buffer, filename)
      .field('descripcion', 'Special char test')
      .field('fecha_compra', new Date().toISOString().split('T')[0])
      .field('base_imponible', '50')
      .field('iva_importe', '10.5');

    expect(res.status).not.toBe(500);
  });
});

// ─── FAKE MIME TYPES ───────────────────────────────────────

describe('A6.5 - Fake MIME Type Detection', () => {
  test('EXE content with PDF extension should be handled', async () => {
    // MZ header = Windows executable
    const exeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00');

    const res = await api
      .post('/api/admin/purchases')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .attach('documento', exeBuffer, 'malicious.pdf')
      .field('descripcion', 'Fake MIME test')
      .field('fecha_compra', new Date().toISOString().split('T')[0])
      .field('base_imponible', '100')
      .field('iva_importe', '21');

    // Should either reject (400) or accept (storing safely)
    // The key is it should NOT crash (500)
    expect(res.status).not.toBe(500);
  });

  test('HTML content disguised as image should be handled', async () => {
    const htmlBuffer = Buffer.from('<html><body><script>alert(1)</script></body></html>');

    const res = await api
      .post('/admin/configuracion/emisor/logo')
      .set('Authorization', `Bearer ${env.empresaA.adminToken}`)
      .attach('logo', htmlBuffer, 'logo.jpg');

    expect(res.status).not.toBe(500);
  });
});
