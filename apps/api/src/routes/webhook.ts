import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { config } from '../config.js';
import { MetaCloudProvider } from '../services/whatsapp/meta-cloud.js';

interface MetaWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: { phone_number_id: string; display_phone_number: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
        }>;
        // Delivery/read receipts for OUTBOUND messages we sent, keyed by the same
        // `id` Meta gave that message when we sent it (stored as wpp_message_id).
        // `errors` is only present when status === 'failed' (invalid number, phone
        // blocked the business, not on WhatsApp, etc).
        statuses?: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          errors?: Array<{ code?: number; title?: string; message?: string }>;
        }>;
      };
      field: string;
    }>;
  }>;
}

function verifyHmac(rawBody: Buffer, signature: string, appSecret: string): boolean {
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function ingestMessage(
  fastify: FastifyInstance,
  phoneNumberId: string,
  phone: string,
  name: string,
  text: string,
  waMsgId: string,
  sentAt: Date,
) {
  // Find org by phone_number_id
  const org = await fastify.prisma.organization.findFirst({
    where: { wpp_meta_phone_id: phoneNumberId, active: true },
  });
  if (!org) {
    fastify.log.warn({ phoneNumberId }, 'WPP: no org for phone_number_id');
    return;
  }

  // Deduplication: skip if already ingested
  const dup = await fastify.prisma.ticketMessage.findUnique({
    where: { wpp_message_id: waMsgId },
  });
  if (dup) return;

  // Use Colombia local date (UTC-5) derived from the message timestamp
  // so the ticket fecha matches what the frontend shows as "today"
  const localMs = sentAt.getTime() + (-5 * 60 * 60 * 1000);
  const localDateStr = new Date(localMs).toISOString().split('T')[0];
  const todayLocal = new Date(localDateStr);

  // Real Bogota (UTC-5, no DST) calendar-day boundaries, in actual UTC instants - used
  // to find how many INBOUND messages this ticket already got today, so the welcome
  // message can fire once per day rather than only using `todayLocal` (a date-only
  // value with no time-of-day meaning, fine for ticket.fecha but not for a sent_at
  // range query).
  const [y, m, d] = localDateStr.split('-').map(Number);
  const dayStartUtc = new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);

  // One ticket per (org, phone), forever - not per day. A customer who wrote a month
  // ago and writes again today continues the exact same ticket; there's no other
  // ticket for this phone this could possibly collide with (enforced by the
  // @@unique([org_id, phone]) constraint), so this is just find-or-create.
  let ticket = await fastify.prisma.ticket.findFirst({
    where: { org_id: org.id, phone },
  });

  // Gates the welcome auto-reply - must be "first message TODAY", not "first message
  // this ticket ever had". A ticket is now permanent per phone (one row forever, see
  // schema.prisma), so gating on "is this ticket brand new" alone meant a returning
  // customer who wrote last month would never get the welcome message again.
  let isFirstMessageToday: boolean;

  if (!ticket) {
    isFirstMessageToday = true;
    ticket = await fastify.prisma.ticket.create({
      data: {
        org_id: org.id,
        phone,
        customer_name: name,
        fecha: todayLocal,
        last_message_at: sentAt,
        unread_count: 1,
      },
    });
  } else {
    const priorInboundToday = await fastify.prisma.ticketMessage.count({
      where: { ticket_id: ticket.id, direction: 'in', sent_at: { gte: dayStartUtc, lt: dayEndUtc } },
    });
    isFirstMessageToday = priorInboundToday === 0;

    // Roll it forward to today (and drop any stale "queued for a specific day" flag)
    // so the board/informe pick it up wherever the conversation actually is now.
    ticket = await fastify.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        fecha: todayLocal,
        deferred_to: null,
        unread_count: { increment: 1 },
        last_message_at: sentAt,
        customer_name: name,
      },
    });
  }

  const message = await fastify.prisma.ticketMessage.create({
    data: {
      ticket_id: ticket.id,
      direction: 'in',
      text,
      wpp_message_id: waMsgId,
      sent_at: sentAt,
    },
    include: { sender: { select: { id: true, name: true } } },
  });

  const newUnread = (ticket.unread_count ?? 0) + 1;

  // Auto-reply welcome message on first message of the day
  if (isFirstMessageToday && org.welcome_message) {
    const provider = MetaCloudProvider.fromOrg(org);
    if (provider) {
      provider.sendText(phone, org.welcome_message)
        .then(async ({ messageId }) => {
          const autoReply = await fastify.prisma.ticketMessage.create({
            data: {
              ticket_id: ticket.id,
              direction: 'out',
              text: org.welcome_message!,
              wpp_message_id: messageId,
              sent_at: new Date(),
            },
          });
          type MediaType = 'pdf' | 'image' | 'audio' | 'video';
          fastify.io.to(`org:${org.id}`).emit('ticket:message', {
            ticketId: ticket.id,
            message: { ...autoReply, direction: 'out' as const, media_type: null as MediaType | null, sent_at: autoReply.sent_at.toISOString(), sent_by_name: null },
          });
        })
        .catch(err => fastify.log.error({ err, ticketId: ticket.id }, 'WPP: error enviando auto-respuesta'));
    }
  }
  type MediaType = 'pdf' | 'image' | 'audio' | 'video';
  const socketMsg = {
    ...message,
    direction: message.direction as 'in' | 'out',
    media_type: message.media_type as MediaType | null,
    sent_at: message.sent_at.toISOString(),
    sent_by_name: message.sender?.name ?? null,
  };
  fastify.io.to(`org:${org.id}`).emit('ticket:message', { ticketId: ticket.id, message: socketMsg });
  fastify.io.to(`org:${org.id}`).emit('ticket:unread', { ticketId: ticket.id, count: newUnread });
  fastify.log.info({ phone, ticketId: ticket.id }, 'WPP: mensaje entrante ingresado');
}

// Updates delivered/read_by_client/failed_reason on an OUTBOUND message we already
// sent, matched by wpp_message_id - a status can arrive well after the message was
// created (Meta doesn't know delivery/read timing in advance), so this is always a
// separate event from ingestMessage above, never inline with sending.
async function ingestStatus(
  fastify: FastifyInstance,
  waMsgId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  errors: Array<{ code?: number; title?: string; message?: string }> | undefined,
) {
  const message = await fastify.prisma.ticketMessage.findUnique({
    where: { wpp_message_id: waMsgId },
    select: { id: true, ticket_id: true, ticket: { select: { org_id: true } } },
  });
  // Not every status update corresponds to a message we actually stored (e.g. one
  // for the auto-reply welcome message sent before this feature existed) - nothing
  // to update, safe to just skip.
  if (!message) return;

  // Never regresses - 'read' implies 'delivered' already happened even if that
  // specific status update got lost/arrived out of order, and once true these only
  // ever stay true (Meta doesn't un-deliver or un-read a message).
  const data: { delivered?: boolean; read_by_client?: boolean; failed_reason?: string } = {};
  if (status === 'delivered' || status === 'read') data.delivered = true;
  if (status === 'read') data.read_by_client = true;
  if (status === 'failed') {
    const first = errors?.[0];
    data.failed_reason = (first?.title ?? first?.message ?? 'Error desconocido').slice(0, 255);
  }
  if (Object.keys(data).length === 0) return; // 'sent' alone - nothing new to record

  // Read back the actual row instead of trusting just this call's own partial
  // `data` - a later 'failed' event (network issue after an earlier successful
  // delivery, rare but real) must not make the emitted payload look like it
  // regressed delivered/read_by_client back to false for clients already showing them true.
  const updated = await fastify.prisma.ticketMessage.update({
    where: { id: message.id },
    data,
    select: { delivered: true, read_by_client: true, failed_reason: true },
  });

  fastify.io.to(`org:${message.ticket.org_id}`).emit('ticket:message-status', {
    ticketId: message.ticket_id,
    messageId: message.id,
    delivered: updated.delivered,
    read_by_client: updated.read_by_client,
    failed_reason: updated.failed_reason,
  });
}

export default async function webhookRoutes(fastify: FastifyInstance) {
  if (!config.META_APP_SECRET) {
    // RAILWAY_ENVIRONMENT_NAME, not NODE_ENV - NODE_ENV is "production" on every
    // Railway environment (build/runtime optimization flag, not environment
    // identity), so gating on it here made a dev/staging deploy with no Meta
    // credentials configured (the normal case - it has no real WhatsApp number)
    // crash-loop forever instead of just warning, exactly like a genuine prod
    // misconfiguration would. Only the actual "production" environment enforces this.
    if (config.RAILWAY_ENVIRONMENT_NAME === 'production') {
      // Fail closed: without HMAC verification the webhook would accept forged messages.
      throw new Error('META_APP_SECRET es obligatorio en producción - configúralo antes de desplegar');
    }
    fastify.log.warn('⚠️  META_APP_SECRET no configurado - webhook acepta solicitudes sin verificar firma HMAC (solo permitido fuera de producción)');
  }
  // Capture raw body for HMAC validation before JSON parsing
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    try {
      const parsed = JSON.parse((body as Buffer).toString());
      (_req as FastifyRequest & { rawBody: Buffer }).rawBody = body as Buffer;
      done(null, parsed);
    } catch (err) {
      done(err as Error);
    }
  });

  // GET - Meta webhook verification handshake
  fastify.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === config.META_WEBHOOK_VERIFY_TOKEN) {
      fastify.log.info('WPP webhook verificado por Meta');
      return reply.status(200).send(q['hub.challenge']);
    }
    return reply.status(403).send({ error: 'Token inválido' });
  });

  // POST - incoming messages from Meta
  fastify.post('/', {
    config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    // HMAC-SHA256 signature validation - mandatory when META_APP_SECRET is set
    const signature = (req.headers['x-hub-signature-256'] as string) ?? '';
    const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;

    if (config.META_APP_SECRET) {
      if (!rawBody || !signature) {
        fastify.log.warn('WPP: request sin firma X-Hub-Signature-256');
        return reply.status(403).send({ error: 'Firma requerida', code: 'MISSING_SIGNATURE' });
      }
      if (!verifyHmac(rawBody, signature, config.META_APP_SECRET)) {
        fastify.log.warn('WPP: firma HMAC inválida');
        return reply.status(403).send({ error: 'Firma inválida', code: 'INVALID_SIGNATURE' });
      }
    }

    const payload = req.body as MetaWebhookPayload;

    // Always return 200 fast - Meta retries if we're slow or error
    reply.status(200).send({ ok: true });

    if (payload?.object !== 'whatsapp_business_account') return;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;

        const { metadata, contacts, messages, statuses } = change.value;

        for (const msg of messages ?? []) {
          if (msg.type !== 'text' || !msg.text?.body) continue;

          const sentAt = new Date(parseInt(msg.timestamp) * 1000);
          // Reject replayed messages older than 10 minutes
          if (Date.now() - sentAt.getTime() > 10 * 60 * 1000) continue;

          const phone  = String(msg.from ?? '').slice(0, 20);
          const name   = String(contacts?.find(c => c.wa_id === msg.from)?.profile.name ?? msg.from ?? '').slice(0, 200);
          const text   = String(msg.text.body).slice(0, 4096);

          ingestMessage(fastify, metadata.phone_number_id, phone, name, text, msg.id, sentAt)
            .catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo mensaje'));
        }

        // Delivery/read/failure receipts arrive as their own webhook events
        // (Meta doesn't send `messages` and `statuses` together in practice), so
        // this must never be gated on `messages` being present.
        for (const s of statuses ?? []) {
          ingestStatus(fastify, s.id, s.status, s.errors)
            .catch(err => fastify.log.error({ err }, 'WPP: error ingiriendo status'));
        }
      }
    }
  });
}
