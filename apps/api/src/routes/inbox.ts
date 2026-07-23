import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { MetaCloudProvider } from '../services/whatsapp/meta-cloud.js';
import { config } from '../config.js';

export default async function inboxRoutes(fastify: FastifyInstance) {
  // GET /api/v1/inbox - lista de todas las conversaciones, solo admin
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

  // GET /api/v1/inbox/:ticketId/messages - historial completo del chat (todos los roles pueden ver)
  // Orders attached to the ticket are scoped to `fecha` when given - a chat opened
  // from a given day on the board must only show that day's pedido, not every order
  // this customer ever placed (a ticket is one row per phone forever, see schema).
  // No `fecha` (older/other callers) falls back to the previous unscoped behavior.
  fastify.get('/:ticketId/messages', { preHandler: [authenticate] }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    const query = z.object({ fecha: z.string().optional() }).safeParse(req.query);
    const fecha = query.success && query.data.fecha ? new Date(query.data.fecha) : undefined;

    const ticket = await fastify.prisma.ticket.findFirst({
      where: { id: ticketId, org_id: req.user.orgId },
      include: {
        messages: {
          orderBy: { sent_at: 'asc' },
          take: 500,
          include: { sender: { select: { id: true, name: true } } },
        },
        orders: {
          where: fecha ? { status: { not: 'papelera' }, fecha } : { status: { not: 'papelera' } },
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

  // POST /api/v1/inbox/:ticketId/reply - responder desde 4Client, todos los roles
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

    // Do NOT update last_message_at on outgoing replies - only incoming customer messages should
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

  // GET /api/v1/inbox/:ticketId/form-link - genera link firmado para el formulario del cliente
  fastify.get('/:ticketId/form-link', { preHandler: [authenticate] }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };

    const ticket = await fastify.prisma.ticket.findFirst({ where: { id: ticketId, org_id: req.user.orgId } });
    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    // Expires at the end of the current Colombia calendar day (UTC-5), not a flat N
    // days from now - a link generated at 11pm and one generated at 8am must both die
    // at the same midnight, so "the link only works today" actually means today, and
    // staff sending a fresh one tomorrow is what lets that new order find/merge with
    // whatever's already open from today (see public.ts's open-orders lookup).
    // Colombia has no DST, so "Colombia midnight" is always UTC 05:00 of that date.
    const nowCol = new Date(Date.now() - 5 * 3600000);
    const tomorrowColMidnightUtcMs = Date.UTC(nowCol.getUTCFullYear(), nowCol.getUTCMonth(), nowCol.getUTCDate() + 1, 5, 0, 0);
    const expiresInSeconds = Math.max(60, Math.floor((tomorrowColMidnightUtcMs - Date.now()) / 1000));

    // Explicit iat (instead of leaving jsonwebtoken to stamp its own "now") so it
    // matches exactly what's written to form_token_min_iat below - the two must
    // agree down to the millisecond-rounded-to-second for THIS token to still pass
    // its own supersede check (public.ts's assertLinkStillValid: strictly-older
    // tokens are rejected, this one must not count as older than itself).
    const issuedAt = new Date();
    const issuedAtSec = Math.floor(issuedAt.getTime() / 1000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (fastify.jwt.sign as any)(
      {
        type: 'form_link',
        iat: issuedAtSec,
        ticketId: ticket.id,
        orgId: req.user.orgId,
        sentByUserId: req.user.userId,
      },
      { expiresIn: expiresInSeconds },
    ) as string;

    // A fresh link supersedes any earlier revocation AND every previously-issued
    // still-unexpired link on this ticket - bumping form_token_min_iat makes
    // public.ts's assertLinkStillValid reject any older token automatically, so
    // staff no longer has to separately "Bloquear link" the old one before sending
    // a new one. Also clears any device lock (public.ts's FormLinkSession) -
    // sending a new link is a deliberate "start over" action, e.g. to fix a
    // false-positive lockout from the wrong device claiming an earlier link.
    // form_link_opened_at resets too - this new link has its own fresh 10-minute
    // unopened-dies window (public.ts's assertLinkStillValid), independent of
    // whether the previous link was ever opened.
    // link_failed_attempts resets too - sending a fresh link is exactly the "give
    // them another chance" action that clears the ticket-wide soft wrong-guess
    // block (linkSecurity.ts's clearSoftLinkBlock does the same thing; inlined here
    // since this update was already happening anyway). Un-blocks the factura link(s)
    // for this ticket too, not just this form link - the soft block is shared.
    // link_failed_total (the cumulative count behind the 24h hard block) is NOT
    // reset here on purpose - that's what makes it actually cumulative instead of
    // something a new link resets for free.
    await fastify.prisma.ticket.update({ where: { id: ticket.id }, data: { form_token_min_iat: issuedAt, form_link_opened_at: null, link_failed_attempts: 0 } });
    await fastify.prisma.revokedFormToken.deleteMany({ where: { ticket_id: ticket.id, org_id: req.user.orgId } });
    await fastify.prisma.formLinkSession.deleteMany({ where: { ticket_id: ticket.id } });

    const frontendUrl = config.FRONTEND_URL.split(',')[0].trim();
    // Percent-encode underscores - base64url tokens routinely contain them, and
    // WhatsApp's renderer treats a pair of underscores as italic-markdown delimiters.
    // An odd one anywhere in the URL leaves WhatsApp "waiting for a closing
    // underscore", which silently truncates how much of the link is actually
    // tappable (matches the exact issue files.ts's invoice filenames hit before -
    // this is the same fix, applied to the query string instead of a filename).
    // %5F round-trips transparently: the browser decodes it back to `_` before the
    // app ever reads `?t=`, so nothing downstream needs to know this happened.
    const safeToken = token.replace(/_/g, '%5F');
    const url = `${frontendUrl}/form?t=${safeToken}`;
    return reply.send({ data: { url } });
  });

  // POST /api/v1/inbox/:ticketId/form-link/revoke - invalidates the currently
  // outstanding form-link token for this ticket (e.g. sent to the wrong number).
  fastify.post('/:ticketId/form-link/revoke', { preHandler: [authenticate] }, async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    const body = z.object({ reason: z.string().max(255).optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const ticket = await fastify.prisma.ticket.findFirst({ where: { id: ticketId, org_id: req.user.orgId } });
    if (!ticket) return reply.status(404).send({ error: 'Conversación no encontrada', code: 'NOT_FOUND' });

    await fastify.prisma.revokedFormToken.upsert({
      where: { ticket_id: ticket.id },
      update: { reason: body.data.reason, revoked_at: new Date(), revoked_by: req.user.userId },
      create: { org_id: req.user.orgId, ticket_id: ticket.id, reason: body.data.reason, revoked_by: req.user.userId },
    });

    // A factura sent to this same conversation must die with the form link, not
    // stay quietly downloadable through files.ts's separate mechanism - only
    // touches ones not already opened+expired-out on their own; harmless either way.
    await fastify.prisma.invoiceLink.updateMany({
      where: { ticket_id: ticket.id, org_id: req.user.orgId, revoked_at: null },
      data: { revoked_at: new Date() },
    });

    return reply.send({ data: { ok: true } });
  });

  // POST /api/v1/inbox/form-links/block-all - org-wide kill switch, admin only.
  // Instantly invalidates every currently-outstanding form link across every ticket
  // in the org (e.g. the store closes early one day) - no need to revoke one ticket
  // at a time. A fresh link issued AFTER this moment works normally again; this
  // isn't a permanent shutdown, just "everything sent out as of right now is dead."
  fastify.post('/form-links/block-all', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    await fastify.prisma.organization.update({
      where: { id: req.user.orgId },
      data: { form_links_blocked_at: new Date() },
    });
    return reply.send({ data: { ok: true } });
  });
}
