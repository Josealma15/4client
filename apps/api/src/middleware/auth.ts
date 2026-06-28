import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthPayload, UserRole } from '@4client/shared';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthPayload;
    user: AuthPayload;
  }
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    req.user = req.user as AuthPayload;
  } catch {
    reply.status(401).send({ error: 'No autorizado', code: 'UNAUTHORIZED' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(req.user.role as UserRole)) {
      return reply.status(403).send({ error: 'Acceso denegado', code: 'FORBIDDEN' });
    }
  };
}
