import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

describe('public form routes', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminId: string;
  let ticketId: string;
  let token: string;
  const phone = '573001112200';

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', 'PublicFormAdmin1!');
    adminId = admin.id;

    await app.prisma.product.create({
      data: { org_id: orgId, name: 'Mango', category: 'Frutas', price_per_unit: 3000 },
    });
    await app.prisma.product.create({
      data: { org_id: orgId, name: 'Piña', category: 'Frutas', price_per_unit: 4000 },
    });

    const ticket = await app.prisma.ticket.create({
      data: { org_id: orgId, phone, customer_name: 'Cliente Formulario' },
    });
    ticketId = ticket.id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    token = (app.jwt.sign as any)(
      { type: 'form_link', ticketId, orgId, clientName: 'Cliente Formulario', clientPhone: phone, orgName: org.name },
      { expiresIn: '7d' },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /form-info reports no open orders before any pedido exists', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.openOrders).toEqual([]);
  });

  let firstOrderId: string;

  it('POST /submit with no merge_order_id creates a new order (address/payment optional)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token, items: [{ product_name: 'Mango', quantity_label: '2 kg' }] },
    });
    expect(res.statusCode).toBe(201);
    firstOrderId = res.json().data.orderId;

    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId } });
    expect(order.address).toBe('Pendiente de confirmar');
    expect(order.payment_method).toBe('sin_asignar');
  });

  it('GET /form-info now lists that order as open', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}` });
    const orders = res.json().data.openOrders;
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(firstOrderId);
    expect(orders[0].itemCount).toBe(1);
  });

  it('POST /submit with merge_order_id appends items to the existing order instead of creating a new one, and only overwrites address/payment when a new value is actually sent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token,
        merge_order_id: firstOrderId,
        address: 'Calle 123 #45-67',
        // payment_method intentionally omitted — should NOT clear the existing value
        items: [{ product_name: 'Piña', quantity_label: '1 unidad' }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.merged).toBe(true);
    expect(res.json().data.orderId).toBe(firstOrderId);

    const order = await app.prisma.order.findUniqueOrThrow({
      where: { id: firstOrderId },
      include: { items: true },
    });
    expect(order.items.map(i => i.product_name).sort()).toEqual(['Mango', 'Piña'].sort());
    expect(order.address).toBe('Calle 123 #45-67'); // overwritten — a new value was sent
    expect(order.payment_method).toBe('sin_asignar'); // untouched — nothing new was sent

    // Merging must never count against the per-link new-order cap.
    const formOrderCount = await app.prisma.order.count({ where: { ticket_id: ticketId, source: 'form' } });
    expect(formOrderCount).toBe(1);
  });

  it('POST /submit with a merge_order_id that is no longer open (closed in the meantime) falls back to creating a new order instead of blocking the client', async () => {
    await app.prisma.order.update({
      where: { id: firstOrderId },
      data: { status: 'cerrado', paid: true, locked: true, paid_by: adminId, paid_at: new Date() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token, merge_order_id: firstOrderId, items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.merged).toBeUndefined();
    expect(res.json().data.orderId).not.toBe(firstOrderId);
  });
});
