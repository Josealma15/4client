import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

const ADMIN_PASS = 'InboxTestAdmin1!';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

describe('inbox routes', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminId: string;
  let adminToken: string;

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

  it('GET /:ticketId/messages?fecha=X only returns that day\'s order, not every order this ticket ever had', async () => {
    const ticket = await app.prisma.ticket.create({
      data: { org_id: orgId, phone: '573009990001', customer_name: 'Cliente Multi Dia' },
    });

    const orderYesterday = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '001', customer_name: 'Cliente Multi Dia',
        address: 'Calle 1', payment_method: 'cash', registered_by: adminId, fecha: new Date('2026-01-10'),
      },
    });
    const orderToday = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '001', customer_name: 'Cliente Multi Dia',
        address: 'Calle 2', payment_method: 'cash', registered_by: adminId, fecha: new Date('2026-01-11'),
      },
    });

    const today = await app.inject({
      method: 'GET',
      url: `/api/v1/inbox/${ticket.id}/messages?fecha=2026-01-11`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(today.statusCode).toBe(200);
    const todayOrderIds = today.json().data.orders.map((o: any) => o.id);
    expect(todayOrderIds).toEqual([orderToday.id]);
    expect(todayOrderIds).not.toContain(orderYesterday.id);

    const yesterday = await app.inject({
      method: 'GET',
      url: `/api/v1/inbox/${ticket.id}/messages?fecha=2026-01-10`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const yesterdayOrderIds = yesterday.json().data.orders.map((o: any) => o.id);
    expect(yesterdayOrderIds).toEqual([orderYesterday.id]);

    // No fecha given (older/other callers) - unscoped, backward-compatible: both show.
    const unscoped = await app.inject({
      method: 'GET',
      url: `/api/v1/inbox/${ticket.id}/messages`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const unscopedIds = unscoped.json().data.orders.map((o: any) => o.id);
    expect(unscopedIds.sort()).toEqual([orderToday.id, orderYesterday.id].sort());
  });
});
