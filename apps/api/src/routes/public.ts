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
  // Optional - older already-issued tokens (before this field existed) won't have it,
  // so every use of it below falls back to an arbitrary active staff member.
  sentByUserId?: string;
  sentByName?: string;
  // Always present (jsonwebtoken sets it automatically, and inbox.ts's /form-link
  // route now sets it explicitly too) - seconds since epoch this specific token was
  // signed, used to detect a superseded link. See assertLinkStillValid below.
  iat?: number;
}

// Max orders a single form link (ticket) may generate - the link is valid for 7 days
// with no revocation, so this caps spam from a leaked/shared link.
const MAX_FORM_ORDERS_PER_TICKET = 3;

// Computes the next sequential order number for org+fecha and creates the order,
// retrying on a unique-constraint collision (@@unique([org_id, num, fecha])).
//
// Uses MAX(num)+1, not COUNT(*)+1 - a deferred order (cierre.ts, decision "manana")
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
  // Allow any origin - these endpoints are genuinely public (client-facing form)
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
  // well-formed and unexpired) - two ways a structurally-valid token can still be
  // dead: (1) explicitly revoked via POST /inbox/:ticketId/form-link/revoke, or
  // (2) superseded - staff sent a NEWER link for this same ticket since this one was
  // issued (inbox.ts's GET /form-link stamps `form_token_min_iat` every time it
  // mints a token), so this older one is silently retired without needing a
  // separate manual revoke. Both fail the same generic way on every public
  // endpoint below - never reveals which of the two it was.
  async function assertLinkStillValid(ticketId: string, tokenIat: number | undefined): Promise<void> {
    const ticket = await fastify.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { form_token_min_iat: true, revoked_form_token: { select: { id: true } } },
    });
    if (!ticket) throw new Error('ticket not found');
    if (ticket.revoked_form_token) throw new Error('revoked');
    if (ticket.form_token_min_iat) {
      // Compare at whole-second resolution on both sides - `iat` is JWT-standard
      // seconds-since-epoch, but form_token_min_iat is stored with millisecond
      // precision, so comparing raw ms would make a token superseded by the very
      // same issuance that minted it (its `iat` always floors to <= that instant).
      const minIatSec = Math.floor(ticket.form_token_min_iat.getTime() / 1000);
      if (!tokenIat || tokenIat < minIatSec) throw new Error('superseded');
    }
  }

  // Claims this ticket's form-link for whichever browser opens it first. There's no
  // real device identity reachable from a web page - deviceToken is a random value
  // the client generates once and keeps in its own localStorage (ClientFormPage.tsx),
  // sent on every request. First caller for a ticket with no session yet claims it;
  // anyone presenting a different deviceToken afterward is rejected the same way an
  // expired/revoked token is (never reveals *why*, just "link inválido"). The
  // find-then-create dance (instead of a plain upsert) is so a second, genuinely
  // legitimate request racing the very first one (form-info + products fire together
  // on page load) reads back whatever the winner actually claimed instead of erroring.
  async function assertDeviceOk(ticketId: string, deviceToken: string): Promise<void> {
    if (!deviceToken) throw new Error('device token required');
    let session = await fastify.prisma.formLinkSession.findUnique({ where: { ticket_id: ticketId } });
    if (!session) {
      try {
        session = await fastify.prisma.formLinkSession.create({ data: { ticket_id: ticketId, device_token: deviceToken } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          session = await fastify.prisma.formLinkSession.findUnique({ where: { ticket_id: ticketId } });
        } else {
          throw err;
        }
      }
    }
    if (!session || session.device_token !== deviceToken) throw new Error('device mismatch');
  }

  // Orders a client may see/act on via the form are scoped to TODAY (Colombia local) -
  // matches the link's own <=24h lifetime, and "editable" mirrors what staff can still
  // change too: once an order is 'camino' or 'cerrado', only staff can touch it from
  // here on, the client's copy becomes view-only.
  const EDITABLE_STATUSES = ['nuevo', 'preparando', 'listo'] as const;

  // GET /api/v1/public/form-info?t=TOKEN&device_token=X - verifica token y devuelve
  // info del cliente + sus pedidos activos de hoy
  fastify.get('/form-info', async (req, reply) => {
    const q = z.object({ t: z.string().min(1), device_token: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'Token requerido', code: 'VALIDATION_ERROR' });
    try {
      const payload = verifyFormToken(q.data.t);
      await assertLinkStillValid(payload.ticketId, payload.iat);
      await assertDeviceOk(payload.ticketId, q.data.device_token);

      // Colombia UTC-5 local date - same "today" the client's own submissions land on.
      const todayLocal = new Date(new Date(Date.now() - 5 * 3600000).toISOString().split('T')[0]);

      // Only orders still in play today - cerrado (and papelera) are excluded outright,
      // not just marked non-editable. An order deferred INTO today (e.g. left open
      // overnight) still shows here if it's genuinely still active; once it's closed,
      // whether that happened today or it arrived already closed from a prior day,
      // there's nothing left for the client to see or do with it.
      const todaysOrders = await fastify.prisma.order.findMany({
        where: { ticket_id: payload.ticketId, org_id: payload.orgId, fecha: todayLocal, status: { notIn: ['cerrado', 'papelera'] } },
        select: {
          id: true, num: true, address: true, payment_method: true, status: true, created_at: true,
          items: { select: { id: true, product_name: true, quantity_label: true }, orderBy: { sort_order: 'asc' } },
        },
        orderBy: { created_at: 'desc' },
        take: 20,
      });

      return reply.send({
        data: {
          clientName: payload.clientName,
          orgName: payload.orgName,
          orgId: payload.orgId,
          orders: todaysOrders.map(o => ({
            id: o.id,
            num: o.num,
            address: o.address === 'Pendiente de confirmar' ? '' : o.address,
            paymentMethod: o.payment_method === 'sin_asignar' ? '' : o.payment_method,
            status: o.status,
            editable: (EDITABLE_STATUSES as readonly string[]).includes(o.status),
            items: o.items.map(i => ({ id: i.id, product_name: i.product_name, quantity_label: i.quantity_label ?? '' })),
            createdAt: o.created_at,
          })),
        },
      });
    } catch {
      return reply.status(401).send({ error: 'Link inválido o expirado', code: 'INVALID_TOKEN' });
    }
  });

  // GET /api/v1/public/products?t=TOKEN&device_token=X - catálogo público (sin precios)
  fastify.get('/products', async (req, reply) => {
    const q = z.object({ t: z.string().min(1), device_token: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'Token requerido', code: 'VALIDATION_ERROR' });
    try {
      const payload = verifyFormToken(q.data.t);
      await assertLinkStillValid(payload.ticketId, payload.iat);
      await assertDeviceOk(payload.ticketId, q.data.device_token);
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

  // POST /api/v1/public/submit - cliente envía su pedido → crea Order directamente
  // Rate limited per FORM LINK (token), not per IP - a per-IP key means every phone
  // behind the same shared connection (mobile carrier CGNAT, mall/office wifi) draws
  // from the same bucket, so unrelated customers' submissions - or even one person
  // testing a couple of different chats' links back to back - can exhaust it for
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
      device_token: z.string().min(1),
      address: z.string().max(500).optional(),
      payment_method: z.enum(['cash', 'transfer', 'cod']).optional(),
      // Set when the client chose "add to my active order" instead of a new one.
      // Re-validated below (not trusted blindly) - if it's gone stale (e.g. staff
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
      await assertLinkStillValid(payload.ticketId, payload.iat);
      await assertDeviceOk(payload.ticketId, body.data.device_token);
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
    // (embedded in the token when it was generated - see inbox.ts's /form-link route),
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

    // Fetch product prices from catalog - needed either way (new order or merge)
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

    // ── Merge path: replace this order's items with the client's current full list
    // instead of just appending - the form now shows everything already on the order
    // (not a blank slate), so "submit" means "this is the whole order now", items the
    // client removed included. Only orders still in an editable status (nuevo/
    // preparando/listo) qualify; once 'camino' or 'cerrado' only staff can touch it.
    if (body.data.merge_order_id) {
      // Looked up WITHOUT the status/locked filter first, on purpose - the client had
      // the order open (and its full item list loaded into the form) as of form-info,
      // but staff can move it to 'camino' or close it out any time before submit
      // actually lands. The old behavior silently fell through to "create a new
      // order" here, which - since the form now carries the target's ENTIRE existing
      // item list, not just newly-typed ones - duplicated the whole pedido as a
      // brand-new one instead of just failing loudly. Now it never falls through:
      // not-found is a real 404, and no-longer-editable is a real 409 explaining why.
      const target = await fastify.prisma.order.findFirst({
        where: { id: body.data.merge_order_id, ticket_id: ticket.id, org_id: payload.orgId },
        include: { items: true },
      });

      if (!target) {
        return reply.status(404).send({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
      }

      const isEditable = (EDITABLE_STATUSES as readonly string[]).includes(target.status) && !target.locked;
      if (!isEditable) {
        const STATUS_LABEL_ES: Record<string, string> = { camino: 'en camino', entregado: 'entregado', cerrado: 'cerrado', papelera: 'cancelado' };
        return reply.status(409).send({
          error: `Tu pedido #${target.num} ya está ${STATUS_LABEL_ES[target.status] ?? target.status} y no se puede modificar. Si necesitas hacer un cambio, contáctanos directamente.`,
          code: 'ORDER_NOT_EDITABLE',
        });
      }

      {
        const priorByName = new Map(target.items.map(i => [i.product_name, i]));
        const submittedNames = new Set(body.data.items.map(i => i.product_name));
        const mergedItemsData = body.data.items.map((item, idx) => {
          const prior = priorByName.get(item.product_name);
          const changed = !prior || prior.quantity_label !== item.quantity_label;
          return {
            product_name: item.product_name,
            quantity_label: item.quantity_label,
            price: priceMap.get(item.product_name) ?? Number(prior?.price ?? 0),
            sort_order: idx,
            // Sticky once true - an item the client already touched before stays
            // flagged even if this particular submission left it untouched.
            added_by_client: changed || (prior?.added_by_client ?? false),
          };
        });
        const anyItemChange = mergedItemsData.length !== target.items.length
          || mergedItemsData.some(it => { const prior = priorByName.get(it.product_name); return !prior || prior.quantity_label !== it.quantity_label; })
          || target.items.some(i => !submittedNames.has(i.product_name));
        const addressChanged = !!body.data.address?.trim() && body.data.address.trim() !== target.address;
        const paymentChanged = !!body.data.payment_method && body.data.payment_method !== target.payment_method;

        // Nothing actually changed (client opened the form and resubmitted as-is) -
        // no-op rather than spamming a "tu pedido fue actualizado" WhatsApp message
        // and flipping the staff-facing bell for a non-change.
        if (!anyItemChange && !addressChanged && !paymentChanged) {
          return reply.status(200).send({ data: { ok: true, orderId: target.id, num: target.num, merged: true, unchanged: true } });
        }

        const updated = await fastify.prisma.order.update({
          where: { id: target.id },
          data: {
            ...(addressChanged ? { address: body.data.address!.trim() } : {}),
            ...(paymentChanged ? { payment_method: body.data.payment_method } : {}),
            client_modified: true,
            items: { deleteMany: {}, create: mergedItemsData },
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
            notes: `Pedido actualizado por el cliente desde el formulario (enviado por ${actorUser.name})`,
          },
        });

        const lines = updated.items.map(i => `• ${sanitizeForWhatsApp(i.product_name)}: ${sanitizeForWhatsApp(i.quantity_label ?? '')}`);
        const msgText = `*Tu pedido #${updated.num} fue actualizado*\n${lines.join('\n')}\n\n_El encargado revisará los cambios._`;

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
    }

    // ── New order path ──
    // Colombia UTC-5 local date for fecha
    const todayLocal = new Date(new Date(Date.now() - 5 * 3600000).toISOString().split('T')[0]);

    // Cap NEW orders generated per form link, PER DAY - the token stays valid for 7
    // days with no revocation, so without this a single leaked/shared link could
    // spam-create orders. Scoped to `fecha`, not the ticket's whole lifetime: a
    // ticket is one row per phone forever now (not per day, see schema.prisma), so a
    // lifetime cap meant any regular customer would eventually place their 4th-ever
    // form order and be permanently locked out of the link, forever, with no way to
    // recover short of staff editing the DB. Doesn't apply to the merge path above
    // since that never creates a new order.
    const existingFormOrdersToday = await fastify.prisma.order.count({
      where: { ticket_id: ticket.id, source: 'form', fecha: todayLocal },
    });
    if (existingFormOrdersToday >= MAX_FORM_ORDERS_PER_TICKET) {
      return reply.status(429).send({ error: 'Límite de pedidos alcanzado para este link por hoy. Contáctanos directamente si necesitas hacer otro.', code: 'FORM_LIMIT_REACHED' });
    }

    const orderItems = newItemsData.map((item, idx) => ({ ...item, sort_order: idx }));

    const order = await createOrderWithRetryNum(fastify.prisma, payload.orgId, todayLocal, (num) =>
      fastify.prisma.order.create({
        data: {
          org_id: payload.orgId,
          ticket_id: ticket.id,
          num,
          customer_name: payload.clientName,
          customer_phone: payload.clientPhone,
          // Placeholders when the client left these blank - dirección/método de pago
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
    // not a real total - labeled as a rough reference, not a firm estimate.
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

    // Actually deliver the confirmation to the client's WhatsApp - previously this only
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

  // Legacy: GET /api/v1/public/org/:slug - kept for backward compat
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
