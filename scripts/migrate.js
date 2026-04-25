#!/usr/bin/env node
// CONTENDO migration runner.
// Reads ../migrations/*.sql in lexicographic order and applies each file
// inside its own transaction, recording applied filenames + sha256 in
// schema_migrations_180. Files already recorded are skipped.
// Non-.sql files (.js, .json) in the migrations dir are NOT touched —
// those are ad-hoc scripts and should be moved or deleted manually.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { sql } from '../src/db.js';
import logger from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

const BOOTSTRAP_FILE = '20260425_create_schema_migrations.sql';

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function ensureMigrationsTable() {
  const file = path.join(MIGRATIONS_DIR, BOOTSTRAP_FILE);
  if (!fs.existsSync(file)) {
    throw new Error(`Bootstrap migration missing: ${BOOTSTRAP_FILE}`);
  }
  const content = fs.readFileSync(file, 'utf8');
  await sql.unsafe(content);
}

async function getApplied() {
  const rows = await sql`SELECT filename, checksum FROM schema_migrations_180`;
  const map = new Map();
  for (const r of rows) map.set(r.filename, r.checksum);
  return map;
}

async function applyOne(filename, content) {
  const checksum = sha256(content);
  const start = Date.now();
  await sql.begin(async (tx) => {
    await tx.unsafe(content);
    await tx`
      INSERT INTO schema_migrations_180 (filename, checksum, applied_at, duration_ms)
      VALUES (${filename}, ${checksum}, NOW(), ${Date.now() - start})
      ON CONFLICT (filename) DO NOTHING
    `;
  });
  return Date.now() - start;
}

async function baseline() {
  await ensureMigrationsTable();
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let inserted = 0;
  for (const f of files) {
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    const checksum = sha256(content);
    const r = await sql`
      INSERT INTO schema_migrations_180 (filename, checksum, applied_at, duration_ms)
      VALUES (${f}, ${checksum}, NOW(), 0)
      ON CONFLICT (filename) DO NOTHING
      RETURNING filename
    `;
    if (r.length) inserted++;
  }
  logger.info('baseline complete', { totalFiles: files.length, newlyMarked: inserted });
  await sql.end({ timeout: 5 });
}

async function main() {
  if (process.argv.includes('--baseline')) {
    await baseline();
    return;
  }

  await ensureMigrationsTable();
  const applied = await getApplied();

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const pending = [];
  const drift = [];
  for (const f of files) {
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    const checksum = sha256(content);
    const recorded = applied.get(f);
    if (!recorded) {
      pending.push({ filename: f, content });
    } else if (recorded !== checksum) {
      drift.push({ filename: f, recorded, current: checksum });
    }
  }

  if (drift.length) {
    logger.warn('Migration checksum drift detected (file changed after apply)', { drift });
  }

  if (!pending.length) {
    logger.info('No pending migrations', { totalApplied: applied.size });
    await sql.end({ timeout: 5 });
    return;
  }

  logger.info('Applying migrations', { count: pending.length });
  for (const m of pending) {
    try {
      const ms = await applyOne(m.filename, m.content);
      logger.info('migration applied', { filename: m.filename, ms });
    } catch (e) {
      logger.error('migration failed', { filename: m.filename, message: e.message });
      await sql.end({ timeout: 5 });
      process.exit(1);
    }
  }

  await sql.end({ timeout: 5 });
  logger.info('Migrations complete');
}

main().catch(async (e) => {
  logger.error('Migration runner crashed', { message: e.message, stack: e.stack });
  try { await sql.end({ timeout: 5 }); } catch {}
  process.exit(1);
});
