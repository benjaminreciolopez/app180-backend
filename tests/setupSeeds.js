/**
 * Runs via setupFiles before each test suite.
 * Loads the pre-seeded test env from the JSON file written by globalSetup.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(__dirname, '..', '__test_env__.json');

try {
  const data = readFileSync(envFile, 'utf-8');
  globalThis.__TEST_ENV__ = JSON.parse(data);
} catch {
  // Will be created by globalSetup on first run
}
