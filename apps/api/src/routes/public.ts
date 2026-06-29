import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export default async function publicRoutes(fastify: FastifyInstance) {
  // Allow any origin — these endpoints are genuinely public (client-facing form)
  fastify.addHook('onRequest', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
  });
  fastify.options('*', async (_req, reply) => reply.status(204).send());

  // GET /api/v1/public/org/:slug — verify org exists (for the client form)
  fastify.get('/org/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const org = await fastify.prisma.organization.findFirst({
      where: { slug, active: true },
      select: { id: true, name: true, slug: true },
    });
    if (!org) return reply.status(404).send({ error: 'Organización no encontrada', code: 'NOT_FOUND' });
    return reply.send({ data: org });
  });

  // GET /api/v1/public/products?org_slug=SLUG — catálogo público (sin precios)
  fastify.get('/products', async (req, reply) => {
    const query = z.object({ org_slug: z.string().min(1) }).safeParse(req.query);
    if (!query.success) return reply.status(400).send({ error: 'org_slug requerido', code: 'VALIDATION_ERROR' });

    const org = await fastify.prisma.organization.findFirst({
      where: { slug: query.data.org_slug, active: true },
      select: { id: true },
    });
    if (!org) return reply.status(404).send({ error: 'Organización no encontrada', code: 'NOT_FOUND' });

    const products = await fastify.prisma.product.findMany({
      where: { org_id: org.id, active: true },
      select: { id: true, name: true, category: true, unit_type: true, sort_order: true },
      orderBy: [{ category: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }],
    });

    return reply.send({ data: products });
  });

  // POST /api/v1/public/register — cliente envía nombre, teléfono y lista de productos
  fastify.post('/register', async (req, reply) => {
    const body = z.object({
      org_slug:      z.string().min(1).max(50),
      customer_name: z.string().min(1).max(200),
      phone:         z.string().min(7).max(20),
      items:         z.array(z.object({
        product_name:   z.string().min(1).max(200),
        quantity_label: z.string().max(100),
      })).max(100).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const org = await fastify.prisma.organization.findFirst({
      where: { slug: body.data.org_slug, active: true },
    });
    if (!org) return reply.status(404).send({ error: 'Organización no encontrada', code: 'NOT_FOUND' });

    // Colombia UTC-5 local date
    const today = new Date(new Date(Date.now() - 5 * 3600000).toISOString().split('T')[0]);

    const ticket = await fastify.prisma.ticket.upsert({
      where: { org_id_phone_fecha: { org_id: org.id, phone: body.data.phone, fecha: today } },
      update: { customer_name: body.data.customer_name },
      create: {
        org_id: org.id,
        phone: body.data.phone,
        customer_name: body.data.customer_name,
        fecha: today,
        last_message_at: new Date(),
      },
    });

    // Si hay productos seleccionados, crear mensaje en el ticket
    if (body.data.items && body.data.items.length > 0) {
      const lines = body.data.items.map(i =>
        `• ${i.product_name}${i.quantity_label ? `: ${i.quantity_label}` : ''}`
      );
      const text = `🛒 Pedido desde el formulario:\n${lines.join('\n')}`;

      const message = await fastify.prisma.ticketMessage.create({
        data: {
          ticket_id: ticket.id,
          direction: 'in',
          text,
          sent_at: new Date(),
        },
      });

      await fastify.prisma.ticket.update({
        where: { id: ticket.id },
        data: { unread_count: { increment: 1 }, last_message_at: new Date() },
      });

      // Notificar en tiempo real al encargado
      fastify.io.to(`org:${org.id}`).emit('ticket:message', {
        ticketId: ticket.id,
        message: {
          id: message.id,
          ticket_id: ticket.id,
          direction: 'in' as const,
          text: message.text,
          media_url: null,
          media_type: null,
          media_caption: null,
          sent_by: null,
          sent_by_name: null,
          wpp_message_id: null,
          sent_at: message.sent_at.toISOString(),
          delivered: false,
          read_by_client: false,
        },
      });

      fastify.io.to(`org:${org.id}`).emit('ticket:unread', {
        ticketId: ticket.id,
        count: (ticket.unread_count ?? 0) + 1,
      });
    }

    return reply.status(201).send({ data: { ok: true, ticketId: ticket.id } });
  });
}
