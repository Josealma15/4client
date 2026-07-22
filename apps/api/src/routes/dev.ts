import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../middleware/auth.js';
import { config } from '../config.js';
import { storage } from '../services/storage.js';
import bcrypt from 'bcrypt';

const ALLOWED_TABLES = [
  'users', 'organizations', 'products', 'employees',
  'orders', 'tickets', 'ticket_messages',
  'order_history', 'daily_closes', 'audit_logs',
] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

async function queryTable(
  prisma: FastifyInstance['prisma'],
  table: AllowedTable,
  orgId: string,
  lim: number,
  off: number,
): Promise<{ rows: any[]; total: number }> {
  switch (table) {
    case 'users':
      return {
        // Excludes password_hash - even though this viewer is dev-role-only, there's
        // no reason a bcrypt hash should ever cross the wire, viewable or not.
        rows: await prisma.user.findMany({
          where: { org_id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' },
          select: { id: true, org_id: true, email: true, name: true, role: true, active: true, last_login: true, created_at: true },
        }),
        total: await prisma.user.count({ where: { org_id: orgId } }),
      };
    case 'organizations':
      return {
        // Excludes wpp_meta_token/wpp_meta_app_secret - the token is encrypted at rest
        // but the app secret currently isn't, so this masks both rather than leaking
        // one plaintext and one ciphertext blob through a viewer meant for eyeballing
        // data, not handling credentials.
        rows: await prisma.organization.findMany({
          where: { id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' },
          select: {
            id: true, name: true, slug: true, plan: true, wpp_provider: true, wpp_phone: true,
            wpp_meta_phone_id: true, welcome_message: true, active: true, created_at: true,
          },
        }),
        total: await prisma.organization.count({ where: { id: orgId } }),
      };
    case 'products':
      return {
        rows: await prisma.product.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' } }),
        total: await prisma.product.count({ where: { org_id: orgId } }),
      };
    case 'employees':
      return {
        rows: await prisma.employee.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' } }),
        total: await prisma.employee.count({ where: { org_id: orgId } }),
      };
    case 'orders':
      return {
        rows: await prisma.order.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { fecha: 'desc' } }),
        total: await prisma.order.count({ where: { org_id: orgId } }),
      };
    case 'tickets':
      return {
        rows: await prisma.ticket.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' } }),
        total: await prisma.ticket.count({ where: { org_id: orgId } }),
      };
    case 'ticket_messages':
      return {
        rows: await prisma.ticketMessage.findMany({
          where: { ticket: { org_id: orgId } },
          take: lim, skip: off, orderBy: { sent_at: 'desc' },
        }),
        total: await prisma.ticketMessage.count({ where: { ticket: { org_id: orgId } } }),
      };
    case 'order_history':
      return {
        rows: await prisma.orderHistory.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' } }),
        total: await prisma.orderHistory.count({ where: { org_id: orgId } }),
      };
    case 'daily_closes':
      return {
        rows: await prisma.dailyClose.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { fecha: 'desc' } }),
        total: await prisma.dailyClose.count({ where: { org_id: orgId } }),
      };
    case 'audit_logs':
      return {
        rows: await prisma.auditLog.findMany({ where: { org_id: orgId }, take: lim, skip: off, orderBy: { created_at: 'desc' } }),
        total: await prisma.auditLog.count({ where: { org_id: orgId } }),
      };
  }
}

export default async function devRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole('dev'));

  // GET /dev/db?table=users&limit=20&offset=0 - scoped to own org only
  fastify.get('/db', async (req: any, reply) => {
    const { table = 'users', limit = '20', offset = '0' } = req.query as Record<string, string>;

    if (!ALLOWED_TABLES.includes(table as AllowedTable)) {
      return reply.status(400).send({ error: `Tabla no permitida. Opciones: ${ALLOWED_TABLES.join(', ')}` });
    }

    const lim = Math.min(parseInt(limit) || 20, 200);
    const off = Math.max(parseInt(offset) || 0, 0);

    const { rows, total } = await queryTable(fastify.prisma, table as AllowedTable, req.user.orgId, lim, off);

    return reply.send({ data: rows, total, limit: lim, offset: off });
  });

  // POST /dev/seed - idempotent upsert of base data
  fastify.post('/seed', async (_req, reply) => {
    // RAILWAY_ENVIRONMENT_NAME, not NODE_ENV - see webhook.ts for why. NODE_ENV is
    // "production" on the dev Railway environment too, which blocked seeding there
    // even though it's exactly the environment this is meant for.
    if (config.RAILWAY_ENVIRONMENT_NAME === 'production') {
      return reply.status(403).send({ error: 'Seed deshabilitado en producción', code: 'FORBIDDEN' });
    }

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    try {
      const p = fastify.prisma;

      const org = await p.organization.upsert({
        where: { slug: 'fruver-san-gabriel' },
        update: {},
        create: {
          name: 'Fruver San Gabriel',
          slug: 'fruver-san-gabriel',
          plan: 'starter',
          wpp_provider: 'meta_api',
          active: true,
        },
      });
      log(`Org: ${org.name} (${org.id})`);

      const [adminHash, devHash] = await Promise.all([
        bcrypt.hash(config.SEED_ADMIN_PASS, 12),
        bcrypt.hash(config.SEED_DEV_PASS, 12),
      ]);

      const admin = await p.user.upsert({
        where: { org_id_email: { org_id: org.id, email: 'admin@fruver.com' } },
        update: { password_hash: adminHash, role: 'admin', active: true },
        create: { org_id: org.id, email: 'admin@fruver.com', password_hash: adminHash, name: 'Juan Ignasio', role: 'admin' },
      });
      log(`Admin: ${admin.email}`);

      await p.user.upsert({
        where: { org_id_email: { org_id: org.id, email: 'dev@fruver.com' } },
        update: { password_hash: devHash, role: 'dev', active: true },
        create: { org_id: org.id, email: 'dev@fruver.com', password_hash: devHash, name: 'Jose Alvarez', role: 'dev' },
      });
      log('Dev: dev@fruver.com');

      const existingCount = await p.product.count({ where: { org_id: org.id } });
      log(`Productos existentes: ${existingCount}`);
      log('Seed completado. Contrasenas: ver vars SEED_ADMIN_PASS y SEED_DEV_PASS');

      return reply.send({ success: true, logs });
    } catch (e: any) {
      logs.push(`Error: ${e.message}`);
      return reply.status(500).send({ success: false, logs, error: e.message });
    }
  });

  // GET /dev/env-status - which optional env vars are configured (boolean only, no values)
  fastify.get('/env-status', async (_req, reply) => {
    return reply.send({
      data: {
        NODE_ENV:                  config.NODE_ENV,
        PORT:                      config.PORT,
        META_WEBHOOK_VERIFY_TOKEN: !!config.META_WEBHOOK_VERIFY_TOKEN,
        META_PHONE_NUMBER_ID:      !!config.META_PHONE_NUMBER_ID,
        META_ACCESS_TOKEN:         !!config.META_ACCESS_TOKEN,
        META_APP_SECRET:           !!config.META_APP_SECRET,
        R2_ACCOUNT_ID:             !!config.R2_ACCOUNT_ID,
        R2_ACCESS_KEY_ID:          !!config.R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY:      !!config.R2_SECRET_ACCESS_KEY,
        R2_BUCKET_NAME:            !!config.R2_BUCKET_NAME,
        R2_PUBLIC_URL:             !!config.R2_PUBLIC_URL,
        SENTRY_DSN:                !!config.SENTRY_DSN,
      },
    });
  });

  // GET /dev/storage-test - actually tries to upload a tiny test file to R2 (or the
  // local fallback) and reports the real error, instead of just checking env vars are
  // set. env-status only shows booleans - this catches wrong bucket name, bad
  // credentials, etc. that env-status can't see.
  fastify.get('/storage-test', async (_req, reply) => {
    const configured = storage.isConfigured();
    if (!configured) {
      return reply.send({ data: { configured: false, ok: false, detail: 'R2 no configurado - usando almacenamiento local (uploads/)' } });
    }
    try {
      const testKey = `_healthcheck/${Date.now()}.txt`;
      const url = await storage.upload(testKey, Buffer.from('4client storage test'), 'text/plain');
      return reply.send({ data: { configured: true, ok: true, url } });
    } catch (err: any) {
      return reply.send({
        data: {
          configured: true, ok: false,
          error_name: err?.name ?? err?.Code ?? null,
          error_message: err?.message ?? String(err),
        },
      });
    }
  });

  // GET /dev/health - extended health with DB ping
  fastify.get('/health', async (_req, reply) => {
    const start = Date.now();
    const [orgCount, userCount] = await Promise.all([
      fastify.prisma.organization.count(),
      fastify.prisma.user.count(),
    ]);
    return reply.send({
      status: 'ok',
      db_latency_ms: Date.now() - start,
      counts: { organizations: orgCount, users: userCount },
      timestamp: new Date().toISOString(),
      node_version: process.version,
      uptime_s: Math.floor(process.uptime()),
    });
  });
}
