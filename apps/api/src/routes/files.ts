import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { storage } from '../services/storage.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config.js';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

export default async function fileRoutes(fastify: FastifyInstance) {
  // POST /api/v1/files/invoice — save base64 PDF, return download URL
  fastify.post('/invoice', { preHandler: [authenticate] }, async (req, reply) => {
    const body = z.object({
      data: z.string().min(1),
      num: z.string(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos' });

    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    const orgPrefix = req.user.orgId.replace(/-/g, '').slice(0, 12);
    const filename = `Factura_${orgPrefix}_${body.data.num}_${id}.pdf`;
    const buffer = Buffer.from(body.data.data, 'base64');

    if (storage.isConfigured()) {
      const url = await storage.upload(`invoices/${filename}`, buffer);
      return reply.status(201).send({ url });
    }

    // Local fallback (dev / pre-R2 prod)
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
    const base = config.FRONTEND_URL.replace('5173', String(config.PORT));
    return reply.status(201).send({ url: `${base}/api/v1/files/${filename}` });
  });

  // GET /api/v1/files/:filename — serve PDF (local fallback only; R2 uses direct URL)
  fastify.get('/:filename', { preHandler: [authenticate] }, async (req, reply) => {
    const { filename } = req.params as { filename: string };
    if (!/^Factura_[a-f0-9]{12}_[a-zA-Z0-9_]+\.pdf$/.test(filename)) {
      return reply.status(400).send({ error: 'Archivo inválido' });
    }
    const orgPrefix = req.user.orgId.replace(/-/g, '').slice(0, 12);
    if (!filename.startsWith(`Factura_${orgPrefix}_`)) {
      return reply.status(403).send({ error: 'Acceso denegado', code: 'FORBIDDEN' });
    }

    if (storage.isConfigured()) {
      // Stream from R2
      const buf = await storage.download(`invoices/${filename}`);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="${filename}"`);
      return reply.send(buf);
    }

    // Local fallback
    const filepath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filepath)) return reply.status(404).send({ error: 'Archivo no encontrado' });
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="${filename}"`);
    return reply.send(fs.createReadStream(filepath));
  });
}
