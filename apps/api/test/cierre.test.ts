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

const ENCARGADO_PASS = 'CierreEncargado1!';

function sampleOrderPayload(overrides: Record<string, unknown> = {}) {
  return {
    customer_name: 'Cliente Cierre',
    address: 'Av. Siempre Viva 742',
    channel: 'call',
    payment_method: 'cash',
    items: [{ product_name: 'Aguacate', quantity_label: '1 kg', price: 6000, sort_order: 0 }],
    ...overrides,
  };
}

// Colombia local date (UTC-5, no DST) - matches exactly what cierre.ts's own
// "only today" check computes, so tests actually land on the day the server
// considers "today" regardless of the machine/CI runner's own timezone.
function todayColombiaStr(): string {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().split('T')[0];
}

describe('cierre routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  // Cierre can now only ever target TODAY (see cierre.ts's NOT_TODAY check) - a
  // DailyClose row is unique per (org, fecha), so every test below that closes
  // "today" needs its OWN org, or it'd collide with another test's close of the
  // same org+day and get a false 409 ALREADY_CLOSED instead of testing what it means to.
  async function freshOrgAndEncargado() {
    const org = await createTestOrg(app.prisma);
    const encargado = await createTestUser(app.prisma, org.id, 'encargado', ENCARGADO_PASS);
    const token = await login(app, encargado.email, ENCARGADO_PASS);
    return { orgId: org.id, encargadoToken: token };
  }

  it('cierre on a date other than today -> 400 NOT_TODAY (neither future nor past can be closed)', async () => {
    const { encargadoToken } = await freshOrgAndEncargado();
    const yesterday = new Date(Date.now() - 5 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() - 5 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const pastAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha: yesterday, decisions: {} },
    });
    expect(pastAttempt.statusCode).toBe(400);
    expect(pastAttempt.json().code).toBe('NOT_TODAY');

    const futureAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha: tomorrow, decisions: {} },
    });
    expect(futureAttempt.statusCode).toBe(400);
    expect(futureAttempt.json().code).toBe('NOT_TODAY');
  });

  it('moving a pending order to "manana" moves its fecha to tomorrow and PRESERVES original notes with the pasado_manana marker appended (B3 fix)', async () => {
    const { encargadoToken } = await freshOrgAndEncargado();
    const fecha = todayColombiaStr();
    const originalNotes = 'Entregar por la puerta trasera, tocar el timbre dos veces';

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha, notes: originalNotes }),
    });
    expect(create.statusCode).toBe(201);
    const order = create.json().data;
    expect(order.notes).toBe(originalNotes);

    const cierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: {
        fecha,
        decisions: { [order.id]: 'manana' },
      },
    });
    expect(cierre.statusCode).toBe(200);

    const updated = await app.prisma.order.findUnique({ where: { id: order.id } });
    expect(updated).not.toBeNull();

    // fecha moved to tomorrow
    const expectedTomorrow = new Date(fecha);
    expectedTomorrow.setDate(expectedTomorrow.getDate() + 1);
    expect(updated!.fecha.toISOString().split('T')[0]).toBe(expectedTomorrow.toISOString().split('T')[0]);

    // original notes preserved, marker appended - NOT overwritten
    const marker = `pasado_manana:${fecha}`;
    expect(updated!.notes).toContain(originalNotes);
    expect(updated!.notes).toContain(marker);
    expect(updated!.notes).toBe(`${originalNotes}\n${marker}`);
  });

  it('a phone can only ever have one ticket per org (@@unique(org_id, phone)) - deferring to "manana" just re-flags the same row, never forks a second one', async () => {
    const { orgId, encargadoToken } = await freshOrgAndEncargado();
    const fecha = todayColombiaStr();
    const tomorrow = new Date(fecha);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const phone = '573001112233';

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha, customer_phone: phone }),
    });
    expect(create.statusCode).toBe(201);
    const order = create.json().data;

    const ticket = await app.prisma.ticket.create({
      data: { org_id: orgId, phone, customer_name: 'Cliente Cierre', fecha: new Date(fecha) },
    });
    await app.prisma.order.update({ where: { id: order.id }, data: { ticket_id: ticket.id } });

    // A second ticket for the same org+phone is a DB-level impossibility now, not just
    // something the app happens to avoid - this is what actually prevents the
    // "Pedidos"/"Ver conversación" vs "Chats WPP" split from ever recurring.
    await expect(
      app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Cierre', fecha: tomorrow } })
    ).rejects.toThrow();

    const cierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha, decisions: { [order.id]: 'manana' } },
    });
    expect(cierre.statusCode).toBe(200);

    const stillOneTicket = await app.prisma.ticket.findMany({ where: { org_id: orgId, phone } });
    expect(stillOneTicket).toHaveLength(1);
    expect(stillOneTicket[0].id).toBe(ticket.id);
    expect(stillOneTicket[0].deferred_to?.toISOString().split('T')[0]).toBe(tomorrow.toISOString().split('T')[0]);
  });

  it('cierre without a decision for a pending order -> 400 MISSING_DECISIONS', async () => {
    const { encargadoToken } = await freshOrgAndEncargado();
    const fecha = todayColombiaStr();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha }),
    });
    expect(create.statusCode).toBe(201);
    const order = create.json().data;

    const cierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: {
        fecha,
        decisions: {},
      },
    });
    expect(cierre.statusCode).toBe(400);
    expect(cierre.json().code).toBe('MISSING_DECISIONS');
    const pendingIds: string[] = cierre.json().pending.map((p: { id: string }) => p.id);
    expect(pendingIds).toContain(order.id);
  });

  it('closing an already-closed day again -> 409 ALREADY_CLOSED, and the day stays closed', async () => {
    const { encargadoToken } = await freshOrgAndEncargado();
    const fecha = todayColombiaStr();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha }),
    });
    expect(create.statusCode).toBe(201);
    const order = create.json().data;

    const firstCierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha, decisions: { [order.id]: 'forzar_cierre' } },
    });
    expect(firstCierre.statusCode).toBe(200);

    const secondCierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha, decisions: {} },
    });
    expect(secondCierre.statusCode).toBe(409);
    expect(secondCierre.json().code).toBe('ALREADY_CLOSED');
  });

  it('GET /cierre/status reflects whether the day has been closed, and "forzar_cierre" (cerrar sin cobro) closes the order WITHOUT marking it paid', async () => {
    const { encargadoToken } = await freshOrgAndEncargado();
    const fecha = todayColombiaStr();

    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/cierre/status?fecha=${fecha}`,
      headers: authHeader(encargadoToken),
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().data.cerrado).toBe(false);

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha }),
    });
    const order = create.json().data;

    const cierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha, decisions: { [order.id]: 'forzar_cierre' } },
    });
    expect(cierre.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/cierre/status?fecha=${fecha}`,
      headers: authHeader(encargadoToken),
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().data.cerrado).toBe(true);
    expect(after.json().data.closedAt).not.toBeNull();

    // "Cerrar sin cobro" means exactly that - closed/dead, but never marked as paid.
    const closedOrder = await app.prisma.order.findUnique({ where: { id: order.id } });
    expect(closedOrder!.status).toBe('cerrado');
    expect(closedOrder!.paid).toBe(false);
    expect(closedOrder!.paid_at).toBeNull();
  });

  it('once a day is closed, EVERY order on it is frozen - even one that was never individually locked, purely because the day itself closed', async () => {
    const { orgId, encargadoToken } = await freshOrgAndEncargado();
    const fecha = todayColombiaStr();

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha }),
    });
    const order = create.json().data;

    // A second order on the same day that's already 'cerrado' but was never
    // individually locked (e.g. seeded/imported another way) - not part of
    // "pendientes" (paid:false + status not in cerrado/papelera), so it needs no
    // cierre decision of its own. This is exactly the case a plain `existing.locked`
    // check on PATCH /orders/:id would let through - only the DAY_CLOSED check
    // (independent of any one order's own `locked` flag) catches it.
    const admin = await app.prisma.user.findFirstOrThrow({ where: { org_id: orgId, role: 'encargado' } });
    const unlockedClosedOrder = await app.prisma.order.create({
      data: {
        org_id: orgId, num: '999', customer_name: 'Pedido ya cerrado sin lock',
        address: 'Calle 1', payment_method: 'cash', status: 'cerrado', locked: false,
        registered_by: admin.id, fecha: new Date(fecha),
      },
    });

    const cierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha, decisions: { [order.id]: 'forzar_cierre' } },
    });
    expect(cierre.statusCode).toBe(200);

    const stillUnlocked = await app.prisma.order.findUnique({ where: { id: unlockedClosedOrder.id } });
    expect(stillUnlocked!.locked).toBe(false);

    const editAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${unlockedClosedOrder.id}`,
      headers: authHeader(encargadoToken),
      payload: { address: 'Nueva dirección después de cerrado' },
    });
    expect(editAttempt.statusCode).toBe(409);
    expect(editAttempt.json().code).toBe('DAY_CLOSED');

    const statusAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${unlockedClosedOrder.id}/status`,
      headers: authHeader(encargadoToken),
      payload: { status: 'preparando' },
    });
    expect(statusAttempt.statusCode).toBe(409);
    expect(statusAttempt.json().code).toBe('DAY_CLOSED');

    const createAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authHeader(encargadoToken),
      payload: sampleOrderPayload({ fecha }),
    });
    expect(createAttempt.statusCode).toBe(409);
    expect(createAttempt.json().code).toBe('DAY_CLOSED');
  });
});
