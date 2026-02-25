/** @type {import('jest').Config} */
export default {
  transform: {},
  testMatch: ["**/tests/**/*.test.js"],
  testTimeout: 60000, // 60s to handle slow Supabase branch + catch-all route overhead
  maxWorkers: 1, // Sequential to avoid DB conflicts
  globalSetup: "./tests/globalSetup.js",
  globalTeardown: "./tests/globalTeardown.js",
  // setupFiles runs IN the test worker process before each test suite
  // envSetup loads .env.test, setupSeeds does one-time seeding via top-level await
  setupFiles: ["./tests/envSetup.js", "./tests/setupSeeds.js"],
  reporters: [
    "default",
    "./tests/helpers/reporter.js",
  ],
};
