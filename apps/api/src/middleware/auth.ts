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
    // Form-link tokens (routes/public.ts) are signed with the same JWT_SECRET but carry
    // a different payload shape ({ type: 'form_link', ticketId, orgId, ... }, no userId/role).
    // Without this check, a client's form link could be replayed as a Bearer token against
    // any staff route that only requires `authenticate` (no role check) - e.g. GET /orders -
    // and, since it still has an `orgId` field, would pass org-scoping and leak every order.
    if (!req.user.userId || !req.user.role) {
      return reply.status(401).send({ error: 'No autorizado', code: 'UNAUTHORIZED' });
    }
  } catch {
    reply.status(401).send({ error: 'No autorizado', code: 'UNAUTHORIZED' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const role = req.user.role as UserRole;
    // dev is a super-role that passes all role checks
    if (role === 'dev' || roles.includes(role)) return;
    return reply.status(403).send({ error: 'Acceso denegado', code: 'FORBIDDEN' });
  };
}
