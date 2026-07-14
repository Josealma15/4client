import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '@prisma/client';
import { MetaCloudProvider } from '../services/whatsapp/meta-cloud.js';
import { sanitizeForWhatsApp } from '../lib/sanitize.js';

interface FormTokenPayload {
  type: string;
  ticketId: string;
  orgId: string;
  clientName: string;
  clientPhone: string;
  orgName: string;
  // Optional — older already-issued tokens (before this field existed) won't have it,
  // so every use of it below falls back to an arbitrary active staff member.
  sentByUserId?: string;
  sentByName?: string;
}

// Max orders a single form link (ticket) may generate — the link is valid for 7 days
// with no revocation, so this caps spam from a leaked/shared link.
const MAX_FORM_ORDERS_PER_TICKET = 3;

// Computes the next sequential order number for org+fecha and creates the order,
// retrying on a unique-constraint collision (@@unique([org_id, num, fecha])).
//
// Uses MAX(num)+1, not COUNT(*)+1 — a deferred order (cierre.ts, decision "manana")
// keeps its ORIGINAL num when its fecha moves to the next day, so COUNT(*)+1 can guess
// a num that's already occupied by one of those, and since count doesn't change
// between retries with no concurrent insert, every retry recomputed the exact same
// doomed num and collided identically until attempts ran out (see orders.ts, same fix).
async function createOrderWithRetryNum<T>(
  prisma: PrismaClient,
  orgId: string,
  fecha: Date,
  createFn: (num: string) => Promise<T>,
): Promise<T> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const existing = await prisma.order.findMany({ where: { org_id: orgId, fecha }, select: { num: true } });
    const maxNum = existing.reduce((max, o) => Math.max(max, parseInt(o.num, 10) || 0), 0);
    const num = String(maxNum + attempt).padStart(3, '0');
    try {
      return await createFn(num);
    } catch (error) {
      const isCollision = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!isCollision || attempt === MAX_ATTEMPTS) throw error;
    }
  }
  // Unreachable, but keeps TS happy about a guaranteed return/throw.
  throw new Error('No se pudo generar un número de pedido único');
}

export default async function publicRoutes(fastify: FastifyInstance) {
  // Allow any origin — these endpoints are genuinely public (client-facing form)
  fastify.addHook('onRequest', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
  });
  fastify.options('*', async (_req, reply) => reply.status(204).send());

  function verifyFormToken(token: string): FormTokenPayload {
    const payload = fastify.jwt.verify(token) as FormTokenPayload;
    if (payload.type !== 'form_link') throw new Error('invalid type');
    return payload;
  }

  // Checked separately from JWT verification (which only proves the token is
  // well-formed and unexpired) — staff can revoke a link early (e.g. sent to the
  // wrong number) via POST /inbox/:ticketId/form-link/revoke, well before its
  // midnight expiry. A revoked link fails closed on every public endpoint below.
  async function assertNotRevoked(ticketId: string): Promise<void> {
    const revoked = await fastify.prisma.revokedFormToken.findUnique({ where: { ticket_id: ticketId } });
    if (revoked) throw new Error('revoked');
  }

  // GET /api/v1/public/form-info?t=TOKEN — verifica token y devuelve info del cliente
  fastify.get('/form-info', async (req, reply) => {
    const q = z.object({ t: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'Token requerido', code: 'VALIDATION_ERROR' });
    try {
      const payload = verifyFormToken(q.data.t);
      await assertNotRevoked(payload.ticketId);

      // So the form can offer "add to my active order" instead of always forking a
      // new one — capped at the most recent 20, which is already far more than any
      // real customer would ever have open at once (an "open" order only stays that
      // way until someone closes it, so this can't grow unbounded in practice).
      const openOrders = await fastify.prisma.order.findMany({
        where: { ticket_id: payload.ticketId, org_id: payload.orgId, status: { notIn: ['cerrado', 'papelera'] } },
        select: { id: true, num: true, address: true, payment_method: true, created_at: true, items: { select: { id: true } } },
        orderBy: { created_at: 'desc' },
        take: 20,
      });

      return reply.send({
        data: {
          clientName: payload.clientName,
          orgName: payload.orgName,
          orgId: payload.orgId,
          openOrders: openOrders.map(o => ({
            id: o.id,
            num: o.num,
            address: o.address === 'Pendiente de confirmar' ? '' : o.address,
            paymentMethod: o.payment_method === 'sin_asignar' ? '' : o.payment_method,
            itemCount: o.items.length,
            createdAt: o.created_at,
          })),
        },
      });
    } catch {
      return reply.status(401).send({ error: 'Link inválido o expirado', code: 'INVALID_TOKEN' });
    }
  });

  // GET /api/v1/public/products?t=TOKEN — catálogo público (sin precios)
  fastify.get('/products', async (req, reply) => {
    const q = z.object({ t: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'Token requerido', code: 'VALIDATION_ERROR' });
    try {
      const payload = verifyFormToken(q.data.t);
      await assertNotRevoked(payload.ticketId);
      const products = await fastify.prisma.product.findMany({
        where: { org_id: payload.orgId, active: true },
        select: { id: true, name: true, category: true, unit_type: true, sort_order: true },
        orderBy: [{ category: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }],
      });
      return reply.send({ data: products });
    } catch {
      return reply.status(401).send({ error: 'Link inválido o expirado', code: 'INVALID_TOKEN' });
    }
  });

  // POST /api/v1/public/submit — cliente envía su pedido → crea Order directamente
  // Rate limited per FORM LINK (token), not per IP — a per-IP key means every phone
  // behind the same shared connection (mobile carrier CGNAT, mall/office wifi) draws
  // from the same bucket, so unrelated customers' submissions — or even one person
  // testing a couple of different chats' links back to back — can exhaust it for
  // everyone sharing that IP, with no way to tell it apart from real abuse. Keying by
  // token instead means only repeated hits on *that specific* link count against it.
  // `hook: 'preHandler'` runs after body parsing so the token is actually readable
  // here (the default 'onRequest' hook fires before that). MAX_FORM_ORDERS_PER_TICKET
  // below is the real anti-abuse guard (caps actual orders created per link); this is
  // just a backstop against a script hammering one specific link's submit endpoint.
  fastify.post('/submit', {
    config: {
      rateLimit: {
        max: 15,
        timeWindow: '1 minute',
        hook: 'preHandler',
        keyGenerator: (req) => (req.body as { token?: string } | undefined)?.token || req.ip,
      },
    },
  }, async (req, reply) => {
    const body = z.object({
      token: z.string().min(1),
      address: z.string().max(500).optional(),
      payment_method: z.enum(['cash', 'transfer', 'cod']).optional(),
      // Set when the client chose "add to my active order" instead of a new one.
      // Re-validated below (not trusted blindly) — if it's gone stale (e.g. staff
      // closed it while the client was filling the form) this just falls through to
      // creating a new order instead of blocking the submission.
      merge_order_id: z.string().uuid().optional(),
      items: z.array(z.object({
        product_name:   z.string().min(1).max(200),
        quantity_label: z.string().max(100),
      })).min(1).max(100),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    let payload: FormTokenPayload;
    try {
      payload = verifyFormToken(body.data.token);
      await assertNotRevoked(payload.ticketId);
    } catch {
      return reply.status(401).send({ error: 'Link inválido o expirado', code: 'INVALID_TOKEN' });
    }

    // Fetch ticket to get org and validate it still exists
    const ticket = await fastify.prisma.ticket.findFirst({
      where: { id: payload.ticketId, org_id: payload.orgId },
      include: { org: true },
    });
    if (!ticket) return reply.status(404).send({ error: 'Ticket no encontrado', code: 'NOT_FOUND' });

    // Attribute the order to whichever staff member actually sent this specific link
    // (embedded in the token when it was generated — see inbox.ts's /form-link route),
    // so history/registered_by shows a real name instead of an arbitrary admin. Falls
    // back to the first active admin/encargado for tokens issued before this existed.
    let actorUser = payload.sentByUserId
      ? await fastify.prisma.user.findFirst({ where: { id: payload.sentByUserId, org_id: payload.orgId } })
      : null;
    if (!actorUser) {
      actorUser = await fastify.prisma.user.findFirst({
        where: { org_id: payload.orgId, active: true, role: { in: ['admin', 'encargado'] } },
        orderBy: { created_at: 'asc' },
      });
    }
    if (!actorUser) return reply.status(500).send({ error: 'Organización sin usuarios activos', code: 'NO_USER' });

    // Fetch product prices from catalog — needed either way (new order or merge)
    const productNames = body.data.items.map(i => i.product_name);
    const catalogProducts = await fastify.prisma.product.findMany({
      where: { org_id: payload.orgId, name: { in: productNames }, active: true },
      select: { name: true, price_per_unit: true },
    });
    const priceMap = new Map(catalogProducts.map(p => [p.name, Number(p.price_per_unit ?? 0)]));
    const newItemsData = body.data.items.map(item => ({
      product_name: item.product_name,
      quantity_label: item.quantity_label,
      price: priceMap.get(item.product_name) ?? 0,
    }));

    // ── Merge path: append to an existing open order instead of creating a new one ──
    if (body.data.merge_order_id) {
      const target = await fastify.prisma.order.findFirst({
        where: {
          id: body.data.merge_order_id, ticket_id: ticket.id, org_id: payload.orgId,
          status: { notIn: ['cerrado', 'papelera'] }, locked: false,
        },
        include: { items: { select: { sort_order: true } } },
      });

      if (target) {
        const maxSort = target.items.reduce((m, i) => Math.max(m, i.sort_order), -1);
        const updated = await fastify.prisma.order.update({
          where: { id: target.id },
          data: {
            // Only overwrite if the client actually typed something new this time —
            // an empty field means "leave what's already there," not "clear it."
            ...(body.data.address?.trim() ? { address: body.data.address.trim() } : {}),
            ...(body.data.payment_method ? { payment_method: body.data.payment_method } : {}),
            items: { create: newItemsData.map((it, idx) => ({ ...it, sort_order: maxSort + 1 + idx })) },
          },
          include: {
            items: { orderBy: { sort_order: 'asc' } },
            employee: { select: { id: true, name: true } },
            registeredBy: { select: { id: true, name: true } },
            paidBy: { select: { id: true, name: true } },
          },
        });

        await fastify.prisma.orderHistory.create({
          data: {
            org_id: payload.orgId, order_id: updated.id, actor_id: actorUser.id,
            action_type: 'edit',
            notes: `${newItemsData.length} producto(s) agregado(s) desde el formulario (enviado por ${actorUser.name})`,
          },
        });

        const lines = body.data.items.map(i => `• ${sanitizeForWhatsApp(i.product_name)}: ${sanitizeForWhatsApp(i.quantity_label)}`);
        const msgText = `*Se agregaron productos a tu pedido #${updated.num}*\n${lines.join('\n')}\n\n_El encargado revisará y confirmará el pedido._`;

        const message = await fastify.prisma.ticketMessage.create({
          data: { ticket_id: ticket.id, direction: 'out', text: msgText, sent_at: new Date(), sent_by: actorUser.id },
        });
        await fastify.prisma.ticket.update({ where: { id: ticket.id }, data: { last_message_at: new Date() } });

        const provider = MetaCloudProvider.fromOrg(ticket.org);
        if (provider) {
          try {
            await provider.sendText(ticket.phone, msgText);
          } catch (err: any) {
            fastify.log.error({ err, ticketId: ticket.id }, 'WPP: error enviando confirmación de items agregados');
          }
        } else {
          fastify.log.warn({ ticketId: ticket.id }, 'WPP: org sin credenciales Meta, confirmación solo guardada en BD');
        }

        fastify.io.to(`org:${payload.orgId}`).emit('order:updated', updated as any);
        fastify.io.to(`org:${payload.orgId}`).emit('ticket:message', {
          ticketId: ticket.id,
          message: {
            id: message.id, ticket_id: ticket.id, direction: 'out' as const, text: message.text,
            media_url: null, media_type: null, media_caption: null,
            sent_by: actorUser.id, sent_by_name: actorUser.name, wpp_message_id: null,
            sent_at: message.sent_at.toISOString(), delivered: false, read_by_client: false,
          },
        });

        return reply.status(200).send({ data: { ok: true, orderId: updated.id, num: updated.num, merged: true } });
      }
      // target missing/closed/locked by the time we got here — fall through and
      // create a fresh order below instead of leaving the client stuck.
    }

    // ── New order path ──
    // Cap orders generated per form link — the token stays valid for 7 days with no
    // revocation, so without this a single leaked/shared link could spam-create orders.
    // Doesn't apply to the merge path above since that never creates a new order.
    const existingFormOrders = await fastify.prisma.order.count({
      where: { ticket_id: ticket.id, source: 'form' },
    });
    if (existingFormOrders >= MAX_FORM_ORDERS_PER_TICKET) {
      return reply.status(429).send({ error: 'Límite de pedidos alcanzado para este link', code: 'FORM_LIMIT_REACHED' });
    }

    // Colombia UTC-5 local date for fecha
    const todayLocal = new Date(new Date(Date.now() - 5 * 3600000).toISOString().split('T')[0]);

    const orderItems = newItemsData.map((item, idx) => ({ ...item, sort_order: idx }));

    const order = await createOrderWithRetryNum(fastify.prisma, payload.orgId, todayLocal, (num) =>
      fastify.prisma.order.create({
        data: {
          org_id: payload.orgId,
          ticket_id: ticket.id,
          num,
          customer_name: payload.clientName,
          customer_phone: payload.clientPhone,
          // Placeholders when the client left these blank — dirección/método de pago
          // are optional on the form, only the products are required.
          address: body.data.address?.trim() || 'Pendiente de confirmar',
          channel: 'whatsapp',
          payment_method: body.data.payment_method ?? 'sin_asignar',
          status: 'nuevo',
          source: 'form',
          registered_by: actorUser.id,
          fecha: todayLocal,
          items: { create: orderItems },
        },
        include: {
          items: { orderBy: { sort_order: 'asc' } },
          employee: { select: { id: true, name: true } },
          registeredBy: { select: { id: true, name: true } },
          paidBy: { select: { id: true, name: true } },
        },
      }),
    );
    const num = order.num;

    // Mensaje en el chat del ticket
    const total = orderItems.reduce((s, i) => s + i.price, 0);
    const lines = body.data.items.map(i => `• ${sanitizeForWhatsApp(i.product_name)}: ${sanitizeForWhatsApp(i.quantity_label)}`);
    // "quantity_label" is free text (e.g. "2 kg"), so this sum is per-unit catalog price,
    // not a real total — labeled as a rough reference, not a firm estimate.
    const msgText = `*Pedido #${num} recibido desde el formulario*\n${lines.join('\n')}${total > 0 ? `\n\n_Precio referencial (según catálogo, sin confirmar cantidades): $${total.toLocaleString('es-CO')}_` : ''}\n\n_El encargado revisará y confirmará el pedido._`;

    const message = await fastify.prisma.ticketMessage.create({
      data: {
        ticket_id: ticket.id,
        direction: 'out',
        text: msgText,
        sent_at: new Date(),
        sent_by: actorUser.id,
      },
    });

    await fastify.prisma.ticket.update({
      where: { id: ticket.id },
      data: { last_message_at: new Date() },
    });

    // Actually deliver the confirmation to the client's WhatsApp — previously this only
    // wrote the message to the DB and broadcast it to staff views, so staff saw a
    // "recibido" message in the chat but the client's phone never got anything.
    const provider = MetaCloudProvider.fromOrg(ticket.org);
    if (provider) {
      try {
        await provider.sendText(ticket.phone, msgText);
      } catch (err: any) {
        fastify.log.error({ err, ticketId: ticket.id }, 'WPP: error enviando confirmación de pedido desde formulario');
      }
    } else {
      fastify.log.warn({ ticketId: ticket.id }, 'WPP: org sin credenciales Meta, confirmación de formulario solo guardada en BD');
    }

    // Historial del pedido
    await fastify.prisma.orderHistory.create({
      data: {
        org_id: payload.orgId,
        order_id: order.id,
        actor_id: actorUser.id,
        action_type: 'create',
        notes: `Pedido creado desde formulario (enviado por ${actorUser.name})`,
      },
    });

    // Socket events
    fastify.io.to(`org:${payload.orgId}`).emit('order:created', order as any);
    fastify.io.to(`org:${payload.orgId}`).emit('ticket:message', {
      ticketId: ticket.id,
      message: {
        id: message.id,
        ticket_id: ticket.id,
        direction: 'out' as const,
        text: message.text,
        media_url: null, media_type: null, media_caption: null,
        sent_by: actorUser.id, sent_by_name: actorUser.name, wpp_message_id: null,
        sent_at: message.sent_at.toISOString(),
        delivered: false, read_by_client: false,
      },
    });

    return reply.status(201).send({ data: { ok: true, orderId: order.id, num: order.num } });
  });

  // Legacy: GET /api/v1/public/org/:slug — kept for backward compat
  fastify.get('/org/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const org = await fastify.prisma.organization.findFirst({
      where: { slug, active: true },
      select: { id: true, name: true, slug: true },
    });
    if (!org) return reply.status(404).send({ error: 'Organización no encontrada', code: 'NOT_FOUND' });
    return reply.send({ data: org });
  });
}
