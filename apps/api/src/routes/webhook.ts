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
        statuses?: unknown[];
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
  const todayLocal = new Date(new Date(localMs).toISOString().split('T')[0]);

  // Find or create today's ticket for this phone
  let ticket = await fastify.prisma.ticket.findFirst({
    where: { org_id: org.id, phone, fecha: todayLocal },
  });

  let isNewTicket = false;

  if (!ticket) {
    // Check if there's a deferred ticket from a previous day arriving today
    const deferred = await fastify.prisma.ticket.findFirst({
      where: { org_id: org.id, phone, deferred_to: todayLocal },
      orderBy: { created_at: 'desc' },
    });

    if (deferred) {
      // Reuse the deferred ticket: move it to today and clear the deferral
      ticket = await fastify.prisma.ticket.update({
        where: { id: deferred.id },
        data: {
          fecha: todayLocal,
          deferred_to: null,
          customer_name: name,
          unread_count: { increment: 1 },
          last_message_at: sentAt,
        },
      });
    } else {
      isNewTicket = true;
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
    }
  } else {
    await fastify.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
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
  if (isNewTicket && org.welcome_message) {
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

export default async function webhookRoutes(fastify: FastifyInstance) {
  if (!config.META_APP_SECRET) {
    if (config.NODE_ENV === 'production') {
      // Fail closed: without HMAC verification the webhook would accept forged messages.
      throw new Error('META_APP_SECRET es obligatorio en producción — configúralo antes de desplegar');
    }
    fastify.log.warn('⚠️  META_APP_SECRET no configurado — webhook acepta solicitudes sin verificar firma HMAC (solo permitido fuera de producción)');
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

  // GET — Meta webhook verification handshake
  fastify.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === config.META_WEBHOOK_VERIFY_TOKEN) {
      fastify.log.info('WPP webhook verificado por Meta');
      return reply.status(200).send(q['hub.challenge']);
    }
    return reply.status(403).send({ error: 'Token inválido' });
  });

  // POST — incoming messages from Meta
  fastify.post('/', {
    config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    // HMAC-SHA256 signature validation — mandatory when META_APP_SECRET is set
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

    // Always return 200 fast — Meta retries if we're slow or error
    reply.status(200).send({ ok: true });

    if (payload?.object !== 'whatsapp_business_account') return;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;

        const { metadata, contacts, messages } = change.value;
        if (!messages?.length) continue;

        for (const msg of messages) {
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
      }
    }
  });
}
