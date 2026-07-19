// Vitest globalSetup - runs once before the whole suite.
// Points Prisma at the dedicated test database and applies all migrations,
// so every test file starts against an up-to-date schema.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');

// Load .env.test directly (don't rely on process.env already being populated -
// globalSetup runs in its own context before test.env is guaranteed to apply).
dotenv.config({ path: path.resolve(apiRoot, '.env.test'), override: true });

export async function setup() {
  const dbUrl = process.env.DATABASE_URL ?? '';

  // Hard safety guard: refuse to run migrations against anything that isn't
  // clearly the test database. This must never touch the real dev DB
  // (postgresql://.../fourclient with real seeded org data).
  if (!dbUrl.includes('fourclient_test')) {
    throw new Error(
      `Refusing to run "prisma migrate deploy": DATABASE_URL does not look like the test database.\n` +
      `Got: ${dbUrl}\n` +
      `Expected it to contain "fourclient_test". Check apps/api/.env.test.`,
    );
  }

  console.log(`[globalSetup] Applying migrations to test DB: ${dbUrl.replace(/:[^:@]*@/, ':***@')}`);
  execSync('pnpm exec prisma migrate deploy', {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'inherit',
  });
}
