/**
 * Jest Global Teardown - runs in a SEPARATE process after all tests.
 * Cleanup happens via --forceExit since the test worker has the DB connection.
 */
export default async function globalTeardown() {
  console.log('🧹 Hacker Ético - Tests complete');
}
