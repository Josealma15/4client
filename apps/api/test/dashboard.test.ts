import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

const ADMIN_PASS = 'DashboardAdmin1!';

describe('dashboard routes', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', ADMIN_PASS);
    adminId = admin.id;
    adminToken = await login(app, admin.email, ADMIN_PASS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('"chats completados"/"con pedido activo" only count orders from the day being viewed, not the ticket\'s entire history (a ticket is now one row per phone forever)', async () => {
    const today = new Date('2026-03-05');
    const yesterday = new Date('2026-03-04');
    const phone = '573009998877';

    const ticket = await app.prisma.ticket.create({
      data: { org_id: orgId, phone, customer_name: 'Cliente Informe', fecha: today, last_message_at: today },
    });

    // Today's order: fully closed — this chat should read as "completado" for today.
    await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '001', customer_name: 'Cliente Informe',
        address: 'Calle 1', payment_method: 'cash', status: 'cerrado', paid: true, locked: true,
        registered_by: adminId, fecha: today,
        items: { create: [{ product_name: 'Mango', price: 5000, sort_order: 0 }] },
      },
    });

    // An OLDER order on the same ticket (same phone, different day) that was never
    // closed — before tickets were one-per-phone-forever this simply couldn't attach
    // to today's ticket; now it lives on the same row and must NOT leak into today's count.
    await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '001', customer_name: 'Cliente Informe',
        address: 'Calle 1', payment_method: 'cash', status: 'nuevo', paid: false,
        registered_by: adminId, fecha: yesterday,
        items: { create: [{ product_name: 'Piña', price: 4000, sort_order: 0 }] },
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard?fecha=${today.toISOString().split('T')[0]}`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);

    const { chats } = res.json().data;
    expect(chats.completos).toBe(1);
    expect(chats.activos).toBe(0);
  });
});
