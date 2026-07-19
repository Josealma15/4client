import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the test environment (test DB, test secrets) so it's available both to
// this config file (e.g. if we needed it here) and - via `test.env` below -
// to every test worker process. Values already present in process.env win,
// same behavior as dotenv everywhere else in this repo.
const testEnv = dotenv.config({ path: path.resolve(__dirname, '.env.test') }).parsed ?? {};

export default defineConfig({
  test: {
    globalSetup: [path.resolve(__dirname, 'test/globalSetup.ts')],
    testTimeout: 15000,
    hookTimeout: 20000,
    // Run test files sequentially: fixtures use unique random data per test,
    // but sharing one Postgres instance across parallel workers still risks
    // pool exhaustion / lock contention. Sequential keeps this simple and fast
    // enough for the current suite size.
    fileParallelism: false,
    env: {
      ...testEnv,
      NODE_ENV: 'test',
    },
  },
});
