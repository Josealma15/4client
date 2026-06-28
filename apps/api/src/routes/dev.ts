import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../middleware/auth.js';
import { config } from '../config.js';
import bcrypt from 'bcrypt';

const ALLOWED_TABLES = ['users', 'organizations', 'products', 'employees', 'orders', 'tickets', 'ticket_messages', 'refresh_tokens', 'order_history', 'daily_closes'] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

const TABLE_SORT: Record<string, string> = {
  ticket_messages: 'sent_at',
  orders: 'id',
};

export default async function devRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole('dev'));

  // GET /dev/db?table=users&limit=20&offset=0
  fastify.get('/db', async (req: any, reply) => {
    if (config.NODE_ENV === 'production') {
      return reply.status(403).send({ error: 'DB browser deshabilitado en producción', code: 'FORBIDDEN' });
    }
    const { table = 'users', limit = '20', offset = '0' } = req.query as Record<string, string>;

    if (!ALLOWED_TABLES.includes(table as AllowedTable)) {
      return reply.status(400).send({ error: `Tabla no permitida. Opciones: ${ALLOWED_TABLES.join(', ')}` });
    }

    const lim = Math.min(parseInt(limit) || 20, 200);
    const off = Math.max(parseInt(offset) || 0, 0);
    const sort = TABLE_SORT[table] ?? 'created_at';

    const [rows, countResult] = await Promise.all([
      fastify.prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM ${table} ORDER BY ${sort} DESC LIMIT $1 OFFSET $2`,
        lim, off,
      ),
      fastify.prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count FROM ${table}`,
      ),
    ]);

    return reply.send({
      data: rows,
      total: Number(countResult[0]?.count ?? 0),
      limit: lim,
      offset: off,
    });
  });

  // POST /dev/seed — idempotent upsert of base data
  fastify.post('/seed', async (_req, reply) => {
    if (config.NODE_ENV === 'production') {
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
      log(`✅ Org: ${org.name} (${org.id})`);

      const [adminHash, devHash] = await Promise.all([
        bcrypt.hash(config.SEED_ADMIN_PASS, 12),
        bcrypt.hash(config.SEED_DEV_PASS, 12),
      ]);

      const admin = await p.user.upsert({
        where: { org_id_email: { org_id: org.id, email: 'admin@fruver.com' } },
        update: {},
        create: { org_id: org.id, email: 'admin@fruver.com', password_hash: adminHash, name: 'Juan Ignasio', role: 'admin' },
      });
      log(`✅ Admin: ${admin.email}`);

      await p.user.upsert({
        where: { org_id_email: { org_id: org.id, email: 'dev@fruver.com' } },
        update: {},
        create: { org_id: org.id, email: 'dev@fruver.com', password_hash: devHash, name: 'Jose Alvarez', role: 'dev' },
      });
      log('✅ Dev: dev@fruver.com');

      const existing = await p.product.findMany({ where: { org_id: org.id }, select: { name: true } });
      const existingNames = new Set(existing.map((p: any) => p.name));
      log(`ℹ️  Productos existentes: ${existingNames.size}`);

      log('─────────────────────────────────');
      log('✅ Seed completado');
      log('  admin@fruver.com   / $SEED_ADMIN_PASS');
      log('  dev@fruver.com     / $SEED_DEV_PASS');

      return reply.send({ success: true, logs });
    } catch (e: any) {
      logs.push(`❌ Error: ${e.message}`);
      return reply.status(500).send({ success: false, logs, error: e.message });
    }
  });

  // GET /dev/health — extended health with DB ping
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
