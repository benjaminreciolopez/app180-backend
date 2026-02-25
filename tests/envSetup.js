/**
 * Runs BEFORE any module imports in the test worker.
 * Loads .env.test so that config.js picks up the branch DATABASE_URL.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env.test');

// Force load .env.test (override=true ensures it wins over any .env)
dotenv.config({ path: envPath, override: true });
process.env.NODE_ENV = 'test';
