import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { authenticate, requireRole } from '../middleware/auth.js';
import { passwordSchema } from '../lib/password.js';
import { audit } from '../lib/audit.js';

const createUserSchema = z.object({
  name:     z.string().min(2),
  email:    z.string().email(),
  password: passwordSchema,
  role:     z.enum(['admin', 'encargado', 'domiciliario']),
});

const updateUserSchema = z.object({
  name:   z.string().min(2).optional(),
  email:  z.string().email().optional(),
  role:   z.enum(['admin', 'encargado', 'domiciliario']).optional(),
  active: z.boolean().optional(),
});

const resetPassSchema = z.object({
  password: passwordSchema,
});

export default async function userRoutes(fastify: FastifyInstance) {
  // GET /api/v1/users - list org users, admin only
  fastify.get('/', { preHandler: [authenticate, requireRole('admin', 'dev')] }, async (req, reply) => {
    const users = await fastify.prisma.user.findMany({
      // An admin (not dev) never sees dev-role accounts at all - not just blocked
      // from acting on them, they don't appear in the list in the first place, so
      // there's nothing to even suggest they could be edited/reset/deactivated.
      where: { org_id: req.user.orgId, ...(req.user.role !== 'dev' ? { role: { not: 'dev' } } : {}) },
      select: { id: true, name: true, email: true, role: true, active: true, last_login: true, created_at: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    return reply.send({ data: users });
  });

  // POST /api/v1/users - create user in org, admin only
  fastify.post('/', { preHandler: [authenticate, requireRole('admin', 'dev')] }, async (req, reply) => {
    const body = createUserSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const existing = await fastify.prisma.user.findFirst({
      where: { org_id: req.user.orgId, email: body.data.email.toLowerCase() },
    });
    if (existing) return reply.status(409).send({ error: 'Email ya registrado en esta organización', code: 'DUPLICATE_EMAIL' });

    const password_hash = await bcrypt.hash(body.data.password, 12);
    const user = await fastify.prisma.user.create({
      data: {
        org_id: req.user.orgId,
        name: body.data.name,
        email: body.data.email.toLowerCase(),
        password_hash,
        role: body.data.role,
      },
      select: { id: true, name: true, email: true, role: true, active: true, created_at: true },
    });
    await audit(fastify.prisma, {
      orgId: req.user.orgId, actorId: req.user.userId, action: 'user.create',
      targetId: user.id, metadata: { email: user.email, role: user.role },
    });
    return reply.status(201).send({ data: user });
  });

  // PATCH /api/v1/users/:id - update user (name, role, active), admin only
  fastify.patch('/:id', { preHandler: [authenticate, requireRole('admin', 'dev')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateUserSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    // Prevent admin from deactivating themselves
    if (id === req.user.userId && body.data.active === false) {
      return reply.status(400).send({ error: 'No puedes desactivarte a ti mismo', code: 'SELF_DEACTIVATE' });
    }

    // Check email uniqueness if changing email
    if (body.data.email) {
      const conflict = await fastify.prisma.user.findFirst({
        where: { org_id: req.user.orgId, email: body.data.email.toLowerCase(), id: { not: id } },
      });
      if (conflict) return reply.status(409).send({ error: 'Email ya registrado en esta organización', code: 'DUPLICATE_EMAIL' });
    }

    const updateData = { ...body.data, ...(body.data.email ? { email: body.data.email.toLowerCase() } : {}) };
    const result = await fastify.prisma.user.updateMany({
      // An admin can never touch a dev-role account (only another dev can) - matched
      // out here the same way the list above hides it, so this 404s exactly like a
      // nonexistent id instead of a distinguishable "forbidden".
      where: { id, org_id: req.user.orgId, ...(req.user.role !== 'dev' ? { role: { not: 'dev' } } : {}) },
      data: updateData,
    });
    if (result.count === 0) return reply.status(404).send({ error: 'Usuario no encontrado', code: 'NOT_FOUND' });
    await audit(fastify.prisma, {
      orgId: req.user.orgId, actorId: req.user.userId, action: 'user.update',
      targetId: id, metadata: updateData,
    });
    return reply.send({ data: { ok: true } });
  });

  // POST /api/v1/users/:id/reset-password - admin resets any user's password
  fastify.post('/:id/reset-password', { preHandler: [authenticate, requireRole('admin', 'dev')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = resetPassSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'La contraseña debe tener mínimo 12 caracteres, con mayúscula, minúscula y número', code: 'VALIDATION_ERROR' });

    const password_hash = await bcrypt.hash(body.data.password, 12);
    const result = await fastify.prisma.user.updateMany({
      where: { id, org_id: req.user.orgId, ...(req.user.role !== 'dev' ? { role: { not: 'dev' } } : {}) },
      data: { password_hash },
    });
    if (result.count === 0) return reply.status(404).send({ error: 'Usuario no encontrado', code: 'NOT_FOUND' });
    await audit(fastify.prisma, {
      orgId: req.user.orgId, actorId: req.user.userId, action: 'user.reset_password', targetId: id,
    });
    return reply.send({ data: { ok: true } });
  });
}
