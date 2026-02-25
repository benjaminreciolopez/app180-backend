/**
 * Jest Global Setup - runs ONCE in a separate process before all tests.
 * Loads .env.test, seeds data, writes result to __test_env__.json.
 * Test files read from that JSON via setupSeeds.js (setupFiles).
 */
import dotenv from 'dotenv';
import path from 'path';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  // 1. Load .env.test BEFORE importing app/db
  const envPath = path.resolve(__dirname, '..', '.env.test');
  dotenv.config({ path: envPath, override: true });
  process.env.NODE_ENV = 'test';

  if (!process.env.SUPABASE_DB_URL && !process.env.SUPABASE_URL) {
    console.error('❌ FATAL: .env.test must have SUPABASE_DB_URL or SUPABASE_URL');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error('❌ FATAL: .env.test must have JWT_SECRET');
    process.exit(1);
  }

  console.log('🔐 Hacker Ético - Environment validated');

  // 2. Import seeds (which imports app.js and db.js - now using branch DB)
  const { setupCompleteTestEnvironment } = await import('./helpers/seeds.js');

  console.log('🔐 Hacker Ético - Setting up test environment...');
  const env = await setupCompleteTestEnvironment();

  // 3. Write env data to JSON file for test workers to read
  const envFile = path.resolve(__dirname, '..', '__test_env__.json');
  writeFileSync(envFile, JSON.stringify(env, null, 2));

  console.log('✅ Test environment ready');
  console.log(`   Empresa A: ${env.empresaA.id}`);
  console.log(`   Empresa B: ${env.empresaB.id}`);
  console.log(`   Asesoria: ${env.asesoria?.id || 'N/A'}`);

  // 4. Close DB connection (this process is separate from test workers)
  try {
    const { sql } = await import('../src/db.js');
    await sql.end({ timeout: 5 });
  } catch {}
}
