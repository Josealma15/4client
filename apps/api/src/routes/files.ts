import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { storage } from '../services/storage.js';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

// 10 minutes - same reasoning and same value as the form link's UNOPENED_LINK_TTL_SECONDS
// (public.ts): a factura URL nobody opens promptly dies on its own, shrinking how long a
// misdirected one (wrong number, forwarded by mistake) stays usable.
const UNOPENED_INVOICE_TTL_SECONDS = 10 * 60;

export default async function fileRoutes(fastify: FastifyInstance) {
  const MAX_BASE64_BYTES = 28_000_000; // ~20 MB decoded

  // POST /api/v1/files/invoice - save base64 PDF, return download URL
  fastify.post('/invoice', { preHandler: [authenticate], bodyLimit: MAX_BASE64_BYTES + 1_000_000 }, async (req, reply) => {
    const body = z.object({
      data: z.string().min(1).max(MAX_BASE64_BYTES),
      num: z.string().regex(/^[a-zA-Z0-9_-]{1,20}$/, 'num inválido'),
      order_id: z.string().uuid(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos' });

    // The factura is shared over WhatsApp exactly like a form link, so it gets the
    // same phone_last4 gate (below) - needs the customer's real number, which only
    // the order itself (never the client) can supply.
    const order = await fastify.prisma.order.findFirst({
      where: { id: body.data.order_id, org_id: req.user.orgId },
      select: { customer_phone: true },
    });
    if (!order) return reply.status(404).send({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
    const phoneLast4 = (order.customer_phone ?? '').replace(/\D/g, '').slice(-4);
    if (phoneLast4.length !== 4) {
      return reply.status(400).send({ error: 'El pedido no tiene un teléfono válido para proteger la factura', code: 'NO_PHONE' });
    }

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
    // bucket are self-describing for an audit - the bucket's own "uploaded at" metadata
    // reflects when this request happened, not what day/hour the invoice is actually for.
    const bogotaMs = Date.now() - 5 * 3600000;
    const stamp = new Date(bogotaMs).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
    const filename = `Factura-${stamp}-${orgPrefix}-${safeNum}-${id}.pdf`;

    await fastify.prisma.invoiceLink.create({
      data: { org_id: req.user.orgId, filename, phone_last4: phoneLast4 },
    });

    // Points at the FRONTEND app now, not directly at this API - GET /:filename below
    // requires phone_last4 on every request, which only a page that can prompt for it
    // (ClientFormPage-style verify screen) can supply. A bare API link opened straight
    // from WhatsApp would have nowhere to collect those digits.
    const frontendUrl = config.FRONTEND_URL.split(',')[0].trim();
    const publicUrl = `${frontendUrl}/factura?f=${encodeURIComponent(filename)}`;

    if (storage.isConfigured()) {
      try {
        await storage.upload(`invoices/${filename}`, decoded);
        return reply.status(201).send({ url: publicUrl });
      } catch (err: any) {
        req.log.error({ err }, 'R2 upload failed for invoice');
        // Staff-only route - safe to surface the AWS/R2 error name (e.g. NoSuchBucket,
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

  // GET /api/v1/files/:filename?phone_last4=XXXX - public (no staff auth - this is the
  // client's own download), but gated the same way a form link is: the caller must
  // prove they know the customer's phone, and a factura nobody opens within 10 minutes
  // of being generated dies on its own. Still capped at 24h total even once opened -
  // if someone needs it again after that, staff just hits "Enviar factura" again (it
  // regenerates fresh from the order's current items every time, nothing is cached).
  fastify.get('/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string };
    const q = z.object({ phone_last4: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'Verificación requerida', code: 'VALIDATION_ERROR' });

    // Deliberately not tied to the exact current segment layout (timestamp/org/num/id)
    // - only what actually matters for safety: starts with "Factura", ends in ".pdf",
    // and the middle can't contain a path separator or traversal. This way every past
    // filename shape we've generated (and any future one) keeps resolving without
    // needing this regex to be revised in lockstep every time that layout changes.
    if (!/^Factura[_-][a-zA-Z0-9_-]+\.pdf$/.test(filename)) {
      return reply.status(400).send({ error: 'Archivo inválido' });
    }

    const link = await fastify.prisma.invoiceLink.findUnique({ where: { filename } });
    // No row = either a pre-hardening invoice link (nothing to check against) or a
    // bogus filename - both dead ends the same way: ask staff to resend, which always
    // regenerates a fresh, fully-protected link.
    if (!link) {
      return reply.status(404).send({ error: 'Archivo no encontrado. Pide que te reenvíen la factura.', code: 'NOT_FOUND' });
    }
    if (Date.now() - link.created_at.getTime() > 24 * 3600 * 1000) {
      return reply.status(410).send({ error: 'Este link de factura ya expiró (válido 24 horas). Pide que te reenvíen la factura.', code: 'INVOICE_EXPIRED' });
    }
    if (!link.opened_at && Date.now() - link.created_at.getTime() > UNOPENED_INVOICE_TTL_SECONDS * 1000) {
      return reply.status(410).send({ error: 'Este link de factura expiró por no abrirse a tiempo. Pide que te reenvíen la factura.', code: 'INVOICE_EXPIRED' });
    }
    if (q.data.phone_last4 !== link.phone_last4) {
      return reply.status(401).send({ error: 'Número incorrecto. Verifica los últimos 4 dígitos.', code: 'PHONE_MISMATCH' });
    }
    if (!link.opened_at) {
      await fastify.prisma.invoiceLink.update({ where: { filename }, data: { opened_at: new Date() } });
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
