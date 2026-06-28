import fp from 'fastify-plugin';
import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from '@4client/shared';

declare module 'fastify' {
  interface FastifyInstance {
    io: Server<ClientToServerEvents, ServerToClientEvents>;
  }
}

export default fp(async (fastify) => {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(fastify.server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    socket.on('join:org', (orgId) => {
      socket.join(`org:${orgId}`);
    });
    socket.on('join:date', (fecha) => {
      socket.join(`date:${fecha}`);
    });
  });

  fastify.decorate('io', io);
});
