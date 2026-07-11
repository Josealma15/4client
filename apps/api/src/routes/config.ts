import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { encryptSecret } from '../lib/crypto.js';

export default async function configRoutes(fastify: FastifyInstance) {
  // GET /api/v1/config/org — get org config visible to admin/dev
  fastify.get('/org', { preHandler: [authenticate, requireRole('admin', 'dev')] }, async (req, reply) => {
    const org = await fastify.prisma.organization.findUnique({
      where: { id: req.user.orgId },
      select: {
        id: true, name: true, slug: true, plan: true,
        wpp_provider: true, wpp_phone: true,
        wpp_meta_phone_id: true,
        welcome_message: true,
        active: true, created_at: true,
      },
    });
    return reply.send({ data: org });
  });

  // PATCH /api/v1/config/wpp — update WPP credentials + welcome message
  fastify.patch('/wpp', { preHandler: [authenticate, requireRole('admin', 'dev')] }, async (req, reply) => {
    const body = z.object({
      wpp_meta_phone_id: z.string().min(1).optional(),
      wpp_meta_token:    z.string().min(1).optional(),
      wpp_phone:         z.string().optional(),
      welcome_message:   z.string().max(1000).optional().nullable(),
    }).safeParse(req.body);

    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const { wpp_meta_token, ...rest } = body.data;

    const updated = await fastify.prisma.organization.update({
      where: { id: req.user.orgId },
      data: {
        ...rest,
        ...(wpp_meta_token !== undefined ? { wpp_meta_token: encryptSecret(wpp_meta_token) } : {}),
      },
      select: {
        wpp_meta_phone_id: true, wpp_phone: true, welcome_message: true,
      },
    });

    return reply.send({ data: updated });
  });
}
