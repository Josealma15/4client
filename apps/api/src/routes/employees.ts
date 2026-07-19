import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

const employeeSchema = z.object({
  name:  z.string().min(1),
  phone: z.string().optional(),
  role:  z.string().default('domiciliario'),
});

export default async function employeeRoutes(fastify: FastifyInstance) {
  // GET /api/v1/employees
  fastify.get('/', { preHandler: [authenticate] }, async (req, reply) => {
    const employees = await fastify.prisma.employee.findMany({
      where: { org_id: req.user.orgId, active: true },
      orderBy: { name: 'asc' },
    });
    return reply.send({ data: employees });
  });

  // POST /api/v1/employees - solo admin
  fastify.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const body = employeeSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const employee = await fastify.prisma.employee.create({
      data: { ...body.data, org_id: req.user.orgId },
    });
    return reply.status(201).send({ data: employee });
  });

  // PATCH /api/v1/employees/:id - solo admin
  fastify.patch('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = employeeSchema.partial().safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    await fastify.prisma.employee.updateMany({ where: { id, org_id: req.user.orgId }, data: body.data });
    return reply.send({ data: { ok: true } });
  });

  // DELETE /api/v1/employees/:id - soft delete, solo admin
  fastify.delete('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await fastify.prisma.employee.updateMany({ where: { id, org_id: req.user.orgId }, data: { active: false } });
    return reply.send({ data: { ok: true } });
  });
}
