import 'dotenv/config';
import * as Sentry from '@sentry/node';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import prismaPlugin from './plugins/prisma.js';
import socketPlugin from './plugins/socket.js';
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import productRoutes from './routes/products.js';
import employeeRoutes from './routes/employees.js';
import dashboardRoutes from './routes/dashboard.js';
import ticketRoutes from './routes/tickets.js';
import inboxRoutes from './routes/inbox.js';
import cierreRoutes from './routes/cierre.js';
import fileRoutes from './routes/files.js';
import webhookRoutes from './routes/webhook.js';
import userRoutes from './routes/users.js';
import configRoutes from './routes/config.js';
import devRoutes from './routes/dev.js';
import publicRoutes from './routes/public.js';
import { authenticate } from './middleware/auth.js';
import type { FastifyRequest, FastifyReply, FastifyError } from 'fastify';

if (config.SENTRY_DSN) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    tracesSampleRate: 0.2,
  });
}

const fastify = Fastify({
  logger: {
    level: config.NODE_ENV === 'production' ? 'warn' : 'info',
    transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  },
  trustProxy: true,
});

// Behind Railway's proxy (trustProxy: true), req.protocol reflects the real
// X-Forwarded-Proto - safe to gate on directly, unlike NODE_ENV which depends on
// the deploy platform's env vars actually being set correctly.
fastify.addHook('onRequest', async (req, reply) => {
  // Excludes /health - Railway's own healthcheck hits the container directly over
  // plain HTTP, bypassing the edge proxy that would set X-Forwarded-Proto: https.
  // Enforcing this there would make the platform mark deploys unhealthy.
  if (config.NODE_ENV === 'production' && req.protocol !== 'https' && req.url !== '/health') {
    return reply.status(400).send({ error: 'HTTPS requerido', code: 'HTTPS_REQUIRED' });
  }
});

fastify.addHook('onSend', async (_req, reply, payload) => {
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  return payload;
});

fastify.setErrorHandler((error: FastifyError, _req, reply) => {
  if (config.SENTRY_DSN) Sentry.captureException(error);
  fastify.log.error(error);
  const status = error.statusCode ?? 500;
  const message = config.NODE_ENV === 'production' && status >= 500
    ? 'Error interno del servidor'
    : (error.message ?? 'Error interno');
  reply.status(status).send({ error: message, code: error.code ?? 'SERVER_ERROR' });
});

async function start() {
  const allowedOrigins = config.FRONTEND_URL.split(',').map((o) => o.trim());
  await fastify.register(cookie);

  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'), false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  await fastify.register(jwt, {
    secret: config.JWT_SECRET,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  await fastify.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    // Per-user instead of per-IP - an office/shared connection shouldn't have every
    // user drawing from the same bucket. This global hook runs before the per-route
    // `authenticate` preHandler, so req.user isn't populated yet; decode (not verify -
    // this is just a bucketing key, not an auth decision) the bearer token directly.
    // Falls back to IP for unauthenticated requests (public form, login - those have
    // their own tighter per-route limits already). 60/min covers the busiest
    // dashboard/inbox polling (30s intervals, several open modals) with headroom for
    // socket-triggered refetches.
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        try {
          const decoded = fastify.jwt.decode(auth.slice(7)) as { userId?: string } | null;
          if (decoded?.userId) return decoded.userId;
        } catch {
          /* fall through to IP */
        }
      }
      return req.ip;
    },
  });

  await fastify.register(prismaPlugin);
  await fastify.register(socketPlugin);

  // Rutas
  await fastify.register(authRoutes,     { prefix: '/api/v1/auth' });
  await fastify.register(orderRoutes,    { prefix: '/api/v1/orders' });
  await fastify.register(productRoutes,  { prefix: '/api/v1/products' });
  await fastify.register(employeeRoutes, { prefix: '/api/v1/employees' });
  await fastify.register(dashboardRoutes,{ prefix: '/api/v1/dashboard' });
  await fastify.register(ticketRoutes,   { prefix: '/api/v1/tickets' });
  await fastify.register(inboxRoutes,    { prefix: '/api/v1/inbox' });
  await fastify.register(cierreRoutes,   { prefix: '/api/v1/cierre' });
  await fastify.register(fileRoutes,     { prefix: '/api/v1/files' });
  await fastify.register(webhookRoutes,  { prefix: '/api/v1/webhook' });
  await fastify.register(userRoutes,     { prefix: '/api/v1/users' });
  await fastify.register(configRoutes,   { prefix: '/api/v1/config' });
  await fastify.register(devRoutes,      { prefix: '/api/v1/dev' });
  await fastify.register(publicRoutes,   { prefix: '/api/v1/public' });

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // WPP status - checks if org has Meta credentials configured
  fastify.get('/api/v1/wpp/status', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const org = await fastify.prisma.organization.findUnique({ where: { id: req.user.orgId } });
    const configured = !!(org?.wpp_meta_phone_id && org?.wpp_meta_token);
    return reply.send({
      data: {
        status: configured ? 'connected' : 'not_configured',
        phone: org?.wpp_phone ?? null,
        phone_number_id: org?.wpp_meta_phone_id ?? null,
      },
    });
  });

  await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
  console.log(`🚀 API corriendo en http://localhost:${config.PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
