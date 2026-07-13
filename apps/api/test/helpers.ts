// Shared test infrastructure: boots a Fastify instance the same way server.ts does
// (same plugin registrations — cookie, cors, jwt, rate-limit, prisma, socket.io — and
// the same routes under test) but without calling .listen(), plus fixture helpers that
// insert directly via Prisma. Uses fastify.inject() instead of real HTTP requests.
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import type { UserRole } from '@4client/shared';
import { config } from '../src/config.js';
import prismaPlugin from '../src/plugins/prisma.js';
import socketPlugin from '../src/plugins/socket.js';
import authRoutes from '../src/routes/auth.js';
import orderRoutes from '../src/routes/orders.js';
import cierreRoutes from '../src/routes/cierre.js';
import webhookRoutes from '../src/routes/webhook.js';
import dashboardRoutes from '../src/routes/dashboard.js';
import ticketRoutes from '../src/routes/tickets.js';

/**
 * Builds a fully-wired Fastify instance (same plugins as server.ts) with only the
 * route groups under test registered. Call `.close()` in an afterAll to release the
 * Prisma connection and the underlying socket.io server.
 */
export async function buildTestServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });

  const allowedOrigins = config.FRONTEND_URL.split(',').map((o) => o.trim());

  await fastify.register(cookie);

  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  await fastify.register(jwt, {
    secret: config.JWT_SECRET,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await fastify.register(prismaPlugin);
  await fastify.register(socketPlugin);

  await fastify.register(authRoutes, { prefix: '/api/v1/auth' });
  await fastify.register(orderRoutes, { prefix: '/api/v1/orders' });
  await fastify.register(cierreRoutes, { prefix: '/api/v1/cierre' });
  await fastify.register(webhookRoutes, { prefix: '/api/v1/webhook' });
  await fastify.register(dashboardRoutes, { prefix: '/api/v1/dashboard' });
  await fastify.register(ticketRoutes, { prefix: '/api/v1/tickets' });

  fastify.setErrorHandler((error: FastifyError, _req, reply) => {
    const status = error.statusCode ?? 500;
    const message = status >= 500 ? 'Error interno del servidor' : (error.message ?? 'Error interno');
    reply.status(status).send({ error: message, code: error.code ?? 'SERVER_ERROR' });
  });

  await fastify.ready();
  return fastify;
}

/** Creates a test Organization with a random unique slug so repeated test runs never collide. */
export async function createTestOrg(
  prisma: FastifyInstance['prisma'],
  overrides: Partial<{ name: string; slug: string; active: boolean }> = {},
) {
  const suffix = randomUUID().slice(0, 8);
  return prisma.organization.create({
    data: {
      name: overrides.name ?? `Test Org ${suffix}`,
      slug: overrides.slug ?? `test-org-${suffix}`,
      active: overrides.active ?? true,
    },
  });
}

/** Creates a test User with a bcrypt-hashed password (12 rounds, matching routes/users.ts). */
export async function createTestUser(
  prisma: FastifyInstance['prisma'],
  orgId: string,
  role: UserRole,
  password: string,
  overrides: Partial<{ name: string; email: string; active: boolean }> = {},
) {
  const suffix = randomUUID().slice(0, 8);
  const password_hash = await bcrypt.hash(password, 12);
  return prisma.user.create({
    data: {
      org_id: orgId,
      email: overrides.email ?? `test-${role}-${suffix}@example.com`,
      password_hash,
      name: overrides.name ?? `Test ${role} ${suffix}`,
      role,
      active: overrides.active ?? true,
    },
  });
}

/** Extracts the `rf` refresh-token cookie value from a fastify.inject() response, if present. */
export function getRfCookie(res: { cookies: Array<{ name: string; value: string }> }): string | undefined {
  return res.cookies.find((c) => c.name === 'rf')?.value;
}
