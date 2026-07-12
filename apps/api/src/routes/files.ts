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
  fastify.post('/invoice', { preHandler: [authenticate], bodyLimit: MAX_BASE64_BYTES + 1_000_000 }, async (req, reply) => {
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
    // Hyphens, not underscores: WhatsApp's message renderer treats a pair of
    // underscores as italic-markdown delimiters, so a URL containing them gets
    // cut in the middle and only part of the link becomes tappable on the client's phone.
    const safeNum = body.data.num.replace(/_/g, '-');
    // Colombia local time (UTC-5) baked into the filename so invoices sitting in the R2
    // bucket are self-describing for an audit — the bucket's own "uploaded at" metadata
    // reflects when this request happened, not what day/hour the invoice is actually for.
    const bogotaMs = Date.now() - 5 * 3600000;
    const stamp = new Date(bogotaMs).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
    const filename = `Factura-${stamp}-${orgPrefix}-${safeNum}-${id}.pdf`;

    const r = req as FastifyRequest;
    const host = (r.headers['x-forwarded-host'] as string | undefined) ?? r.hostname;
    const proto = (r.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? r.protocol;
    // Always hand back OUR OWN url (proxied through GET /files/:filename below), never
    // the raw R2 object URL — R2 buckets aren't public by default, and even a "public
    // dev URL" would mean the file is genuinely public to anyone on the internet who
    // guesses/finds it, forever. Proxying through our server means: a) it works
    // immediately without needing R2's bucket-level public access config touched at
    // all, and b) any future access control (client-only tokens, expiry) lives in one
    // place — this route — instead of in Cloudflare's dashboard.
    const publicUrl = `${proto}://${host}/api/v1/files/${filename}`;

    if (storage.isConfigured()) {
      try {
        await storage.upload(`invoices/${filename}`, decoded);
        return reply.status(201).send({ url: publicUrl });
      } catch (err: any) {
        req.log.error({ err }, 'R2 upload failed for invoice');
        // Staff-only route — safe to surface the AWS/R2 error name (e.g. NoSuchBucket,
        // AccessDenied, InvalidAccessKeyId) so whoever configured R2 can actually fix it
        // instead of staring at a generic 502.
        const reason = err?.name ?? err?.Code ?? err?.message ?? 'desconocido';
        return reply.status(502).send({
          error: `No se pudo subir la factura al almacenamiento (${reason}). Revisa la configuración de R2 en DevTools.`,
          code: 'STORAGE_UPLOAD_FAILED',
        });
      }
    }

    // Local fallback (dev / pre-R2 prod)
    try {
      if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), decoded);
    } catch (err: any) {
      req.log.error({ err }, 'Local invoice write failed');
      const reason = err?.code ?? err?.message ?? 'desconocido';
      return reply.status(502).send({ error: `No se pudo guardar la factura (${reason}). Intenta de nuevo.`, code: 'STORAGE_WRITE_FAILED' });
    }
    return reply.status(201).send({ url: publicUrl });
  });

  // GET /api/v1/files/:filename — public (no auth: filename is unguessable org+UUID combo)
  fastify.get('/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string };
    // Deliberately not tied to the exact current segment layout (timestamp/org/num/id)
    // — only what actually matters for safety: starts with "Factura", ends in ".pdf",
    // and the middle can't contain a path separator or traversal. This way every past
    // filename shape we've generated (and any future one) keeps resolving without
    // needing this regex to be revised in lockstep every time that layout changes.
    if (!/^Factura[_-][a-zA-Z0-9_-]+\.pdf$/.test(filename)) {
      return reply.status(400).send({ error: 'Archivo inválido' });
    }

    if (storage.isConfigured()) {
      const buf = await storage.download(`invoices/${filename}`);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="${filename}"`);
      return reply.send(buf);
    }

    const filepath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filepath)) {
      return reply.status(404).send({ error: 'Archivo no encontrado' });
    }
    // Prevent symlink traversal
    const isInsideUploads = fs.realpathSync(filepath).startsWith(fs.realpathSync(UPLOADS_DIR));
    if (!isInsideUploads) {
      return reply.status(404).send({ error: 'Archivo no encontrado' });
    }
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="${filename}"`);
    return reply.send(fs.createReadStream(filepath));
  });
}
