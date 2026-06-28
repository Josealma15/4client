import fp from 'fastify-plugin';
import { Server } from 'socket.io';
import { config } from '../config.js';
import type { ServerToClientEvents, ClientToServerEvents } from '@4client/shared';

declare module 'fastify' {
  interface FastifyInstance {
    io: Server<ClientToServerEvents, ServerToClientEvents>;
  }
}

export default fp(async (fastify) => {
  const allowedOrigins = config.FRONTEND_URL.split(',').map((o) => o.trim());

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(fastify.server, {
    cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  });

  // Verify JWT on every socket connection
  io.use((socket, next) => {
    const token =
      (socket.handshake.auth as Record<string, string>)?.token ??
      (socket.handshake.headers?.authorization ?? '').replace('Bearer ', '');

    if (!token) return next(new Error('No autorizado'));

    try {
      const payload = fastify.jwt.verify<{ userId: string; orgId: string; role: string }>(token);
      socket.data.user = payload;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    const userOrgId: string = socket.data.user?.orgId;

    socket.on('join:org', (orgId) => {
      // Only allow joining the org the user actually belongs to
      if (!userOrgId || userOrgId !== orgId) return;
      socket.join(`org:${orgId}`);
    });

    socket.on('join:date', (fecha) => {
      // Scope date rooms to the user's org to prevent cross-org eavesdropping
      if (!userOrgId) return;
      socket.join(`org:${userOrgId}:date:${fecha}`);
    });
  });

  fastify.decorate('io', io);
});
