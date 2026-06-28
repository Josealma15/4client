import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { storage } from '../services/storage.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

export default async function fileRoutes(fastify: FastifyInstance) {
  const MAX_BASE64_BYTES = 28_000_000; // ~20 MB decoded

  // POST /api/v1/files/invoice — save base64 PDF, return download URL
  fastify.post('/invoice', { preHandler: [authenticate] }, async (req, reply) => {
    const body = z.object({
      data: z.string().min(1).max(MAX_BASE64_BYTES),
      num: z.string().regex(/^[a-zA-Z0-9_-]{1,20}$/, 'num inválido'),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos' });

    const decoded = Buffer.from(body.data.data, 'base64');
    if (decoded.length > 20 * 1024 * 1024) {
      return reply.status(400).send({ error: 'Archivo demasiado grande (máx 20 MB)' });
    }

    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    const orgPrefix = req.user.orgId.replace(/-/g, '').slice(0, 12);
    const filename = `Factura_${orgPrefix}_${body.data.num}_${id}.pdf`;

    if (storage.isConfigured()) {
      const url = await storage.upload(`invoices/${filename}`, decoded);
      return reply.status(201).send({ url });
    }

    // Local fallback (dev / pre-R2 prod)
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), decoded);
    const r = req as FastifyRequest;
    const host = (r.headers['x-forwarded-host'] as string | undefined) ?? r.hostname;
    const proto = (r.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? r.protocol;
    return reply.status(201).send({ url: `${proto}://${host}/api/v1/files/${filename}` });
  });

  // GET /api/v1/files/:filename — public (no auth: filename is unguessable org+UUID combo)
  fastify.get('/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string };
    if (!/^Factura_[a-f0-9]{12}_[a-zA-Z0-9_-]+\.pdf$/.test(filename)) {
      return reply.status(400).send({ error: 'Archivo inválido' });
    }

    if (storage.isConfigured()) {
      const buf = await storage.download(`invoices/${filename}`);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(buf);
    }

    const filepath = path.join(UPLOADS_DIR, filename);
    // Prevent symlink traversal
    const realpath = fs.realpathSync(filepath).startsWith(fs.realpathSync(UPLOADS_DIR))
      ? filepath : null;
    if (!realpath || !fs.existsSync(filepath)) {
      return reply.status(404).send({ error: 'Archivo no encontrado' });
    }
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(fs.createReadStream(filepath));
  });
}
