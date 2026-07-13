import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { MetaCloudProvider } from '../services/whatsapp/meta-cloud.js';
import { config } from '../config.js';

export default async function inboxRoutes(fastify: FastifyInstance) {
  // GET /api/v1/inbox — lista de todas las conversaciones, solo admin
  fastify.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const query = z.object({ page: z.coerce.number().default(1) }).parse(req.query);

    const allTickets = await fastify.prisma.ticket.findMany({
      where: { org_id: req.user.orgId },
      include: {
        messages: { orderBy: { sent_at: 'desc' }, take: 1 },
        orders: {
          where: { status: { not: 'papelera' } },
          select: { id: true, num: true, status: true, paid: true },
        },
      },
      orderBy: { last_message_at: 'desc' },
      take: 500,
    });

    // Deduplicate by phone: keep only the most recent ticket per customer
    const seenPhones = new Set<string>();
    const tickets = allTickets.filter(t => {
      if (seenPhones.has(t.phone)) return false;
      seenPhones.add(t.phone);
      return true;
    });

    return reply.send({ data: tickets });
  });

  // GET /api/v1/inbox/:ticketId/messages — historial completo del chat (todos los roles pueden ver)
  fastify.get('/:ticketId/messages', { preHandler: [authenticate] }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };

    const ticket = await fastify.prisma.ticket.findFirst({
      where: { id: ticketId, org_id: req.user.orgId },
      include: {
        messages: {
          orderBy: { sent_at: 'asc' },
          take: 500,
          include: { sender: { select: { id: true, name: true } } },
        },
        orders: {
          where: { status: { not: 'papelera' } },
          include: { items: true, employee: { select: { id: true, name: true } } },
        },
      },
    });

    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    if (ticket.unread_count > 0) {
      await fastify.prisma.ticket.update({ where: { id: ticketId }, data: { unread_count: 0 } });
      fastify.io.to(`org:${req.user.orgId}`).emit('ticket:unread', { ticketId, count: 0 });
    }

    return reply.send({ data: ticket });
  });

  // POST /api/v1/inbox/:ticketId/reply — responder desde 4Client, todos los roles
  fastify.post('/:ticketId/reply', { preHandler: [authenticate] }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    const body = z.object({ text: z.string().min(1).max(4096) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Mensaje requerido', code: 'VALIDATION_ERROR' });

    const ticket = await fastify.prisma.ticket.findFirst({
      where: { id: ticketId, org_id: req.user.orgId },
      include: { org: true },
    });
    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    const message = await fastify.prisma.ticketMessage.create({
      data: {
        ticket_id: ticketId,
        direction: 'out',
        text: body.data.text,
        sent_by: req.user.userId,
      },
      include: { sender: { select: { id: true, name: true } } },
    });

    // Do NOT update last_message_at on outgoing replies — only incoming customer messages should
    // move a ticket up in the queue, so the inbox order stays stable when agents reply.
    fastify.io.to(`org:${req.user.orgId}`).emit('ticket:message', { ticketId, message: message as any });

    // Enviar via Meta Cloud API
    const provider = MetaCloudProvider.fromOrg(ticket.org);
    let wpp_status: 'sent' | 'no_credentials' | 'failed' = 'no_credentials';
    let wpp_error: string | undefined;

    if (provider) {
      try {
        await provider.sendText(ticket.phone, body.data.text);
        wpp_status = 'sent';
      } catch (err: any) {
        wpp_status = 'failed';
        wpp_error = err?.message ?? 'Error desconocido Meta API';
        fastify.log.error({ err, ticketId }, 'WPP: error enviando respuesta via Meta API');
      }
    } else {
      fastify.log.warn({ ticketId }, 'WPP: org sin credenciales Meta, mensaje solo guardado en BD');
    }

    return reply.status(201).send({ data: message, wpp_status, wpp_error });
  });

  // GET /api/v1/inbox/:ticketId/form-link — genera link firmado para el formulario del cliente
  fastify.get('/:ticketId/form-link', { preHandler: [authenticate] }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };

    const ticket = await fastify.prisma.ticket.findFirst({
      where: { id: ticketId, org_id: req.user.orgId },
      include: { org: { select: { name: true, slug: true } } },
    });
    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    const sender = await fastify.prisma.user.findUnique({ where: { id: req.user.userId }, select: { name: true } });

    // Expires at the end of the current Colombia calendar day (UTC-5), not a flat N
    // days from now — a link generated at 11pm and one generated at 8am must both die
    // at the same midnight, so "the link only works today" actually means today, and
    // staff sending a fresh one tomorrow is what lets that new order find/merge with
    // whatever's already open from today (see public.ts's open-orders lookup).
    // Colombia has no DST, so "Colombia midnight" is always UTC 05:00 of that date.
    const nowCol = new Date(Date.now() - 5 * 3600000);
    const tomorrowColMidnightUtcMs = Date.UTC(nowCol.getUTCFullYear(), nowCol.getUTCMonth(), nowCol.getUTCDate() + 1, 5, 0, 0);
    const expiresInSeconds = Math.max(60, Math.floor((tomorrowColMidnightUtcMs - Date.now()) / 1000));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (fastify.jwt.sign as any)(
      {
        type: 'form_link',
        ticketId: ticket.id,
        orgId: req.user.orgId,
        clientName: ticket.customer_name,
        clientPhone: ticket.phone,
        orgName: ticket.org.name,
        sentByUserId: req.user.userId,
        sentByName: sender?.name ?? null,
      },
      { expiresIn: expiresInSeconds },
    ) as string;

    const frontendUrl = config.FRONTEND_URL.split(',')[0].trim();
    const url = `${frontendUrl}/form?t=${token}`;
    return reply.send({ data: { url } });
  });
}
