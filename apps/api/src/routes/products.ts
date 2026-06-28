import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

const productSchema = z.object({
  name:           z.string().min(1),
  category:       z.string().optional(),
  active:         z.boolean().default(true),
  sort_order:     z.number().default(0),
  price_per_unit: z.number().optional(),
  unit_type:      z.string().optional(),
});

export default async function productRoutes(fastify: FastifyInstance) {
  // GET /api/v1/products
  fastify.get('/', { preHandler: [authenticate] }, async (req, reply) => {
    const products = await fastify.prisma.product.findMany({
      where: { org_id: req.user.orgId, active: true },
      orderBy: [{ category: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }],
    });
    return reply.send({ data: products });
  });

  // POST /api/v1/products — solo admin
  fastify.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const body = productSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const product = await fastify.prisma.product.create({
      data: { ...body.data, org_id: req.user.orgId },
    });
    return reply.status(201).send({ data: product });
  });

  // PATCH /api/v1/products/:id — solo admin
  fastify.patch('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = productSchema.partial().safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const product = await fastify.prisma.product.updateMany({
      where: { id, org_id: req.user.orgId },
      data: body.data,
    });
    if (product.count === 0) return reply.status(404).send({ error: 'Producto no encontrado', code: 'NOT_FOUND' });
    return reply.send({ data: { ok: true } });
  });

  // DELETE /api/v1/products/:id — soft delete, solo admin
  fastify.delete('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await fastify.prisma.product.updateMany({
      where: { id, org_id: req.user.orgId },
      data: { active: false },
    });
    return reply.send({ data: { ok: true } });
  });
}
