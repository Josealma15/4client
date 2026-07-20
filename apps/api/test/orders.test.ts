import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

const ENCARGADO_PASS = 'EncargadoPass1!';
const DOMICILIARIO_PASS = 'DomiciliarioPass1!';

function sampleOrderPayload(overrides: Record<string, unknown> = {}) {
  return {
    customer_name: 'Cliente de Prueba',
    address: 'Calle Falsa 123',
    channel: 'call',
    payment_method: 'cash',
    items: [
      { product_name: 'Papa Criolla', quantity_label: '2 kg', price: 5000, sort_order: 0 },
      { product_name: 'Cebolla Roja', quantity_label: '1 kg', price: 3000, sort_order: 1 },
    ],
    ...overrides,
  };
}

describe('orders routes', () => {
  let app: FastifyInstance;

  // Org A: primary org under test
  let orgAId: string;
  let encargadoToken: string;
  let domiciliarioToken: string;

  // Org B: used only for multi-tenant isolation assertions
  let orgBId: string;
  let orgBEncargadoToken: string;

  beforeAll(async () => {
    app = await buildTestServer();

    const orgA = await createTestOrg(app.prisma);
    orgAId = orgA.id;
    const encargado = await createTestUser(app.prisma, orgAId, 'encargado', ENCARGADO_PASS);
    const domiciliario = await createTestUser(app.prisma, orgAId, 'domiciliario', DOMICILIARIO_PASS);
    encargadoToken = await login(app, encargado.email, ENCARGADO_PASS);
    domiciliarioToken = await login(app, domiciliario.email, DOMICILIARIO_PASS);

    const orgB = await createTestOrg(app.prisma);
    orgBId = orgB.id;
    const orgBEncargado = await createTestUser(app.prisma, orgBId, 'encargado', ENCARGADO_PASS, {
      email: `orgb-encargado-${Date.now()}@example.com`,
    });
    orgBEncargadoToken = await login(app, orgBEncargado.email, ENCARGADO_PASS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an order as encargado -> 201, with sequential num', async () => {
    const fecha = '2026-01-10';

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha }),
    });
    expect(res1.statusCode).toBe(201);
    const order1 = res1.json().data;
    expect(order1.num).toBe('001');

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha }),
    });
    expect(res2.statusCode).toBe(201);
    const order2 = res2.json().data;
    expect(order2.num).toBe('002');
  });

  it('creates an order with no address -> 201 with a placeholder - address is only required to close (cobro), not to open a pedido', async () => {
    const { address, ...rest } = sampleOrderPayload({ fecha: '2026-01-11' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: rest,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.address).toBe('Pendiente de confirmar');
  });

  it('creating an order on a fecha whose only existing order has a "high" num (e.g. carried over from a deferred order) does not collide -> 201, not 500', async () => {
    // Reproduces a real production 500: a deferred order (cierre.ts, decision "manana")
    // keeps its ORIGINAL num when it lands on a new fecha. COUNT(*)+1 has no idea that
    // num already exists, guesses it again, collides, and since count doesn't change
    // between retries with no concurrent insert, every retry recomputed the exact same
    // doomed num - 5 identical collisions, then the raw Prisma error was thrown as a 500.
    const fecha = '2026-01-16';
    await app.prisma.order.create({
      data: {
        org_id: orgAId, num: '002', customer_name: 'Pedido diferido', address: 'Calle 1',
        payment_method: 'cash', status: 'nuevo', registered_by: (await app.prisma.user.findFirstOrThrow({ where: { org_id: orgAId, role: 'encargado' } })).id,
        fecha: new Date(fecha),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.num).not.toBe('002');
  });

  it('forbids creating an order as domiciliario -> 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(domiciliarioToken),
      payload: sampleOrderPayload({ fecha: '2026-01-11' }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('GET /orders?fecha=X only returns orders for the requesting user org (multi-tenant isolation)', async () => {
    const fecha = '2026-01-12';

    const createA = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha, customer_name: 'Cliente Org A' }),
    });
    expect(createA.statusCode).toBe(201);
    const orderAId = createA.json().data.id;

    const createB = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(orgBEncargadoToken),
      payload: sampleOrderPayload({ fecha, customer_name: 'Cliente Org B' }),
    });
    expect(createB.statusCode).toBe(201);
    const orderBId = createB.json().data.id;

    const listA = await app.inject({
      method: 'GET',
      url: `/api/v1/orders?fecha=${fecha}`,
      headers: authHeader(encargadoToken),
    });
    expect(listA.statusCode).toBe(200);
    const idsA: string[] = listA.json().data.map((o: { id: string }) => o.id);
    expect(idsA).toContain(orderAId);
    expect(idsA).not.toContain(orderBId);

    const listB = await app.inject({
      method: 'GET',
      url: `/api/v1/orders?fecha=${fecha}`,
      headers: authHeader(orgBEncargadoToken),
    });
    expect(listB.statusCode).toBe(200);
    const idsB: string[] = listB.json().data.map((o: { id: string }) => o.id);
    expect(idsB).toContain(orderBId);
    expect(idsB).not.toContain(orderAId);
  });

  it('PATCH /orders/:id/status -> 200, creates an OrderHistory entry with correct value_before/value_after', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha: '2026-01-13' }),
    });
    expect(create.statusCode).toBe(201);
    const order = create.json().data;
    expect(order.status).toBe('nuevo');

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}/status`,
      headers: authHeader(encargadoToken),
      payload: { status: 'preparando' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.status).toBe('preparando');

    const historyEntry = await app.prisma.orderHistory.findFirst({
      where: { order_id: order.id, action_type: 'estado' },
    });
    expect(historyEntry).not.toBeNull();
    expect(historyEntry!.value_before).toBe('nuevo');
    expect(historyEntry!.value_after).toBe('preparando');
  });

  it('PATCH /orders/:id with a changed items list logs producto_agregado/producto_eliminado/producto_modificado in OrderHistory', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha: '2026-01-14' }),
    });
    expect(create.statusCode).toBe(201);
    const order = create.json().data;

    // Papa Criolla: price 5000 -> 6000 (modificado). Cebolla Roja: removed (eliminado).
    // Zanahoria: new line (agregado).
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}`,
      headers: authHeader(encargadoToken),
      payload: {
        items: [
          { product_name: 'Papa Criolla', quantity_label: '2 kg', price: 6000, sort_order: 0 },
          { product_name: 'Zanahoria', quantity_label: '1 kg', price: 2000, sort_order: 1 },
        ],
      },
    });
    expect(patch.statusCode).toBe(200);

    const history = await app.prisma.orderHistory.findMany({ where: { order_id: order.id } });

    const modificado = history.find(h => h.action_type === 'producto_modificado');
    expect(modificado).toBeDefined();
    expect(modificado!.value_before).toContain('Papa Criolla - $5.000');
    expect(modificado!.value_after).toContain('Papa Criolla - $6.000');

    const eliminado = history.find(h => h.action_type === 'producto_eliminado');
    expect(eliminado).toBeDefined();
    expect(eliminado!.value_before).toContain('Cebolla Roja');

    // Two producto_agregado entries exist by now: one from order creation (Papa
    // Criolla, Cebolla Roja) and this PATCH's new one (Zanahoria) - match on content,
    // not just the first hit, so this doesn't collide with the creation-time entries.
    const agregado = history.find(h => h.action_type === 'producto_agregado' && h.value_after?.includes('Zanahoria'));
    expect(agregado).toBeDefined();

    // The response from GET /:id (what the modal actually renders) must carry these
    // through too - admin/dev only (buildOrderSelect gates `history` on isAdmin).
    const adminEmail = `hist-admin-${Date.now()}@example.com`;
    const admin = await createTestUser(app.prisma, orgAId, 'admin', 'HistAdminPass1!', { email: adminEmail });
    const adminToken = await login(app, adminEmail, 'HistAdminPass1!');
    const getRes = await app.inject({
      method: 'GET', url: `/api/v1/orders/${order.id}`, headers: authHeader(adminToken),
    });
    expect(getRes.statusCode).toBe(200);
    const returnedTypes = (getRes.json().data.history ?? []).map((h: any) => h.action_type);
    expect(returnedTypes).toEqual(expect.arrayContaining(['producto_modificado', 'producto_eliminado', 'producto_agregado']));
    void admin;
  });

  it('POST /orders/:id/cobro with wrong password -> 403 INVALID_PASSWORD, order not marked paid', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha: '2026-01-14' }),
    });
    const order = create.json().data;

    const cobro = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/cobro`,
      headers: authHeader(encargadoToken),
      payload: { amount_received: 8000, password: 'not-the-real-password' },
    });
    expect(cobro.statusCode).toBe(403);
    expect(cobro.json().code).toBe('INVALID_PASSWORD');

    const fresh = await app.prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh!.paid).toBe(false);
    expect(fresh!.locked).toBe(false);
  });

  it('POST /orders/:id/cobro with correct password -> 200, paid+locked; second cobro -> 409 ORDER_LOCKED', async () => {
    // A pedido now needs every field filled in (name, phone, address, payment method,
    // domiciliario) before it's allowed to close - this fixture must reflect that, not
    // just the bare minimum POST /orders accepts.
    const empleado = await app.prisma.employee.create({
      data: { org_id: orgAId, name: 'Domiciliario de Prueba' },
    });
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha: '2026-01-15', customer_phone: '3001234567', employee_id: empleado.id }),
    });
    const order = create.json().data;

    const cobro = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/cobro`,
      headers: authHeader(encargadoToken),
      payload: { amount_received: 8000, password: ENCARGADO_PASS },
    });
    expect(cobro.statusCode).toBe(200);
    expect(cobro.json().data.paid).toBe(true);
    expect(cobro.json().data.locked).toBe(true);

    const secondCobro = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/cobro`,
      headers: authHeader(encargadoToken),
      payload: { amount_received: 8000, password: ENCARGADO_PASS },
    });
    expect(secondCobro.statusCode).toBe(409);
    expect(secondCobro.json().code).toBe('ORDER_LOCKED');
  });

  it('POST /orders/:id/cobro blocks closing when any single item has no price, even if the order total is > 0 from the other items', async () => {
    const empleado = await app.prisma.employee.create({
      data: { org_id: orgAId, name: 'Domiciliario de Prueba 2' },
    });
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({
        fecha: '2026-01-16', customer_phone: '3009876543', employee_id: empleado.id,
        items: [
          { product_name: 'Papa Criolla', quantity_label: '2 kg', price: 5000, sort_order: 0 },
          { product_name: 'Cebolla Roja', quantity_label: '1 kg', price: 0, sort_order: 1 }, // no price set
        ],
      }),
    });
    const order = create.json().data;

    const cobro = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/cobro`,
      headers: authHeader(encargadoToken),
      payload: { amount_received: 5000, password: ENCARGADO_PASS },
    });
    expect(cobro.statusCode).toBe(400);
    expect(cobro.json().code).toBe('MISSING_FIELDS');
    expect(cobro.json().error).toContain('Cebolla Roja');
  });
});
