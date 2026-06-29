import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import crypto from 'crypto';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Pre-computed dummy hash — prevents timing attack revealing user existence.
// bcrypt.compare always runs regardless of whether user was found.
const DUMMY_HASH = '$2b$12$LzVFpXDW.jkMhGlXb2WiIeq3rAhnWPvVRqSRLCLdTT0W5HjCMfBtm';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60, // 7 days
};

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /api/v1/auth/login — rate limited to 10 attempts/min per IP
  fastify.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });
    }

    const { email, password } = body.data;

    const user = await fastify.prisma.user.findFirst({
      where: { email: email.toLowerCase(), active: true },
      include: { org: true },
    });

    // Always run bcrypt to prevent timing-based user enumeration
    const hashToCheck = user?.password_hash ?? DUMMY_HASH;
    const valid = await bcrypt.compare(password, hashToCheck);

    if (!user || !user.org.active || !valid) {
      return reply.status(401).send({ error: 'Credenciales incorrectas', code: 'INVALID_CREDENTIALS' });
    }

    const payload = { userId: user.id, orgId: user.org_id, role: user.role as import('@4client/shared').UserRole };
    const accessToken = fastify.jwt.sign(payload, { expiresIn: '15m' });

    const rawRefresh = crypto.randomBytes(40).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawRefresh).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await fastify.prisma.refreshToken.create({
      data: { user_id: user.id, token_hash: tokenHash, expires_at: expiresAt },
    });

    await fastify.prisma.user.update({
      where: { id: user.id },
      data: { last_login: new Date() },
    });

    reply.setCookie('rf', rawRefresh, COOKIE_OPTS);

    return reply.send({
      data: {
        accessToken,
        user: {
          id: user.id,
          org_id: user.org_id,
          org_name: user.org.name,
          org_slug: user.org.slug,
          email: user.email,
          name: user.name,
          role: user.role,
          active: user.active,
          last_login: user.last_login,
          created_at: user.created_at,
        },
      },
    });
  });

  // POST /api/v1/auth/refresh — reads refresh token from HttpOnly cookie
  fastify.post('/refresh', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const rawRefresh = (req.cookies as Record<string, string>)?.rf;
    if (!rawRefresh) {
      return reply.status(401).send({ error: 'Token requerido', code: 'VALIDATION_ERROR' });
    }

    const tokenHash = crypto.createHash('sha256').update(rawRefresh).digest('hex');

    const stored = await fastify.prisma.refreshToken.findFirst({
      where: { token_hash: tokenHash, revoked: false },
      include: { user: { include: { org: true } } },
    });

    if (!stored || stored.expires_at <= new Date()) {
      reply.clearCookie('rf', { path: '/api/v1/auth' });
      return reply.status(401).send({ error: 'Token inválido o expirado', code: 'INVALID_REFRESH_TOKEN' });
    }

    if (!stored.user.active || !stored.user.org.active) {
      await fastify.prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
      reply.clearCookie('rf', { path: '/api/v1/auth' });
      return reply.status(401).send({ error: 'Usuario inactivo', code: 'USER_INACTIVE' });
    }

    // Rotate refresh token
    await fastify.prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });

    const newRaw = crypto.randomBytes(40).toString('hex');
    const newHash = crypto.createHash('sha256').update(newRaw).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await fastify.prisma.refreshToken.create({
      data: { user_id: stored.user_id, token_hash: newHash, expires_at: expiresAt },
    });

    const payload = { userId: stored.user.id, orgId: stored.user.org_id, role: stored.user.role as import('@4client/shared').UserRole };
    const accessToken = fastify.jwt.sign(payload, { expiresIn: '15m' });

    reply.setCookie('rf', newRaw, COOKIE_OPTS);
    return reply.send({ data: { accessToken } });
  });

  // POST /api/v1/auth/logout
  fastify.post('/logout', { preHandler: [authenticate] }, async (req, reply) => {
    const rawRefresh = (req.cookies as Record<string, string>)?.rf;
    if (rawRefresh) {
      const tokenHash = crypto.createHash('sha256').update(rawRefresh).digest('hex');
      await fastify.prisma.refreshToken.updateMany({
        where: { token_hash: tokenHash },
        data: { revoked: true },
      });
    }
    reply.clearCookie('rf', { path: '/api/v1/auth' });
    return reply.send({ data: { ok: true } });
  });

  // GET /api/v1/auth/me
  fastify.get('/me', { preHandler: [authenticate] }, async (req, reply) => {
    const user = await fastify.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, org_id: true, email: true, name: true, role: true, active: true, last_login: true, created_at: true },
    });
    if (!user) return reply.status(404).send({ error: 'Usuario no encontrado', code: 'NOT_FOUND' });
    return reply.send({ data: user });
  });
}
