#!/usr/bin/env node
// Re-encrypts ENCRYPTION_KEY-protected columns from the dev fallback to a new
// production key. Run once before pushing the new ENCRYPTION_KEY to Render.
//
// Usage:
//   NEW_ENCRYPTION_KEY='<new-32-char-key>' node scripts/reencrypt-config.js
//
// Idempotent: rows that fail to decrypt with the OLD fallback are assumed to
// already be in the new format and are left untouched.

import crypto from 'crypto';
import { poolSql } from '../src/db.js';

const OLD_KEY = 'default-32-char-key-change-me!!';
const NEW_KEY = process.env.NEW_ENCRYPTION_KEY;

if (!NEW_KEY || NEW_KEY.length < 32) {
  console.error('NEW_ENCRYPTION_KEY env var required (>=32 chars)');
  process.exit(1);
}

const ALGORITHM = 'aes-256-cbc';

function dec(text, key) {
  if (!text) return null;
  const [ivHex, payload] = text.split(':');
  if (!ivHex || !payload) throw new Error('bad format');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(key.slice(0, 32)), iv);
  let out = decipher.update(payload, 'hex', 'utf8');
  out += decipher.final('utf8');
  return out;
}

function enc(text, key) {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(key.slice(0, 32)), iv);
  let out = cipher.update(text, 'utf8', 'hex');
  out += cipher.final('hex');
  return `${iv.toString('hex')}:${out}`;
}

async function migrateColumn(table, idCol, ...cols) {
  const rows = await poolSql.unsafe(
    `SELECT ${idCol}, ${cols.join(', ')} FROM ${table}`
  );
  let migrated = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    const updates = {};
    for (const col of cols) {
      const val = row[col];
      if (!val) continue;
      try {
        const plain = dec(val, OLD_KEY);
        updates[col] = enc(plain, NEW_KEY);
      } catch {
        // No descifrable con OLD_KEY → presumiblemente ya re-cifrado
        skipped++;
      }
    }

    if (Object.keys(updates).length === 0) continue;

    try {
      const setExpr = Object.keys(updates)
        .map((c, i) => `${c} = $${i + 2}`)
        .join(', ');
      await poolSql.unsafe(
        `UPDATE ${table} SET ${setExpr} WHERE ${idCol} = $1`,
        [row[idCol], ...Object.values(updates)]
      );
      migrated++;
    } catch (e) {
      console.error(`UPDATE failed on ${table} ${idCol}=${row[idCol]}:`, e.message);
      failed++;
    }
  }

  console.log(`${table}: migrated=${migrated} skipped=${skipped} failed=${failed}`);
}

async function main() {
  console.log('Re-encrypting columns from dev fallback to new key…\n');
  await migrateColumn('empresa_email_config_180', 'id', 'oauth2_refresh_token', 'smtp_password');
  await migrateColumn('empresa_calendar_config_180', 'id', 'oauth2_refresh_token');
  console.log('\nDone. Now set ENCRYPTION_KEY in your .env and Render to:', NEW_KEY);
  await poolSql.end({ timeout: 5 });
}

main().catch(async (e) => {
  console.error('FATAL:', e.message);
  try { await poolSql.end({ timeout: 5 }); } catch {}
  process.exit(1);
});
