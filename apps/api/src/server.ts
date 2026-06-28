import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import prismaPlugin from './plugins/prisma.js';
import socketPlugin from './plugins/socket.js';
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import productRoutes from './routes/products.js';
import employeeRoutes from './routes/employees.js';
import dashboardRoutes from './routes/dashboard.js';
import ticketRoutes from './routes/tickets.js';
import inboxRoutes from './routes/inbox.js';
import cierreRoutes from './routes/cierre.js';
import fileRoutes from './routes/files.js';
import webhookRoutes from './routes/webhook.js';
import userRoutes from './routes/users.js';

const fastify = Fastify({ logger: config.NODE_ENV === 'development' });

async function start() {
  await fastify.register(cors, {
    origin: config.FRONTEND_URL,
    credentials: true,
  });

  await fastify.register(jwt, {
    secret: config.JWT_SECRET,
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await fastify.register(prismaPlugin);
  await fastify.register(socketPlugin);

  // Rutas
  await fastify.register(authRoutes,     { prefix: '/api/v1/auth' });
  await fastify.register(orderRoutes,    { prefix: '/api/v1/orders' });
  await fastify.register(productRoutes,  { prefix: '/api/v1/products' });
  await fastify.register(employeeRoutes, { prefix: '/api/v1/employees' });
  await fastify.register(dashboardRoutes,{ prefix: '/api/v1/dashboard' });
  await fastify.register(ticketRoutes,   { prefix: '/api/v1/tickets' });
  await fastify.register(inboxRoutes,    { prefix: '/api/v1/inbox' });
  await fastify.register(cierreRoutes,   { prefix: '/api/v1/cierre' });
  await fastify.register(fileRoutes,     { prefix: '/api/v1/files' });
  await fastify.register(webhookRoutes,  { prefix: '/api/v1/webhook' });
  await fastify.register(userRoutes,     { prefix: '/api/v1/users' });

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
  console.log(`🚀 API corriendo en http://localhost:${config.PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
