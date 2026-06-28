import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';

export default async function ticketRoutes(fastify: FastifyInstance) {
  // GET /api/v1/tickets?fecha=2026-06-15
  fastify.get('/', { preHandler: [authenticate] }, async (req, reply) => {
    const query = z.object({ fecha: z.string().optional() }).parse(req.query);
    const fecha = query.fecha ? new Date(query.fecha) : new Date();

    const tickets = await fastify.prisma.ticket.findMany({
      where: { org_id: req.user.orgId, OR: [{ fecha }, { deferred_to: fecha }] },
      include: {
        messages: { orderBy: { sent_at: 'asc' } },
        orders: {
          where: { status: { not: 'papelera' } },
          select: { id: true, num: true, status: true, paid: true },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    return reply.send({ data: tickets });
  });

  // POST /api/v1/tickets — crear ticket manual
  fastify.post('/', { preHandler: [authenticate] }, async (req, reply) => {
    const body = z.object({
      phone:         z.string().min(7),
      customer_name: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    // Colombia UTC-5: derive local business date from UTC
    const today = new Date(new Date(Date.now() - 5 * 3600000).toISOString().split('T')[0]);

    const ticket = await fastify.prisma.ticket.upsert({
      where: { org_id_phone_fecha: { org_id: req.user.orgId, phone: body.data.phone, fecha: today } },
      update: {},
      create: {
        org_id: req.user.orgId,
        phone: body.data.phone,
        customer_name: body.data.customer_name ?? body.data.phone,
        fecha: today,
        last_message_at: new Date(),
      },
    });

    return reply.status(201).send({ data: ticket });
  });
}
