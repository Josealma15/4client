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

describe('cierre routes', () => {
  let app: FastifyInstance;
  let orgId: string;
  let encargadoToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const encargado = await createTestUser(app.prisma, orgId, 'encargado', ENCARGADO_PASS);
    encargadoToken = await login(app, encargado.email, ENCARGADO_PASS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('moving a pending order to "manana" moves its fecha to tomorrow and PRESERVES original notes with the pasado_manana marker appended (B3 fix)', async () => {
    const fecha = '2026-02-10';
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
    const fecha = '2026-02-12';
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
    const fecha = '2026-02-11';

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
    // A date not touched by any other test in this file (avoids colliding with
    // orders that other tests' "manana" decisions shift onto the following day).
    const fecha = '2026-02-20';

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

  it('GET /cierre/status reflects whether the day has been closed', async () => {
    const fecha = '2026-02-21';

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
  });

  it('once a day is closed, its orders are frozen - even one left "dejar_activo" (not locked) can no longer be created, edited, or moved', async () => {
    const fecha = '2026-02-22';

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
      payload: { fecha, decisions: { [order.id]: 'dejar_activo' } },
    });
    expect(cierre.statusCode).toBe(200);

    // Left deliberately open, not locked - this is exactly the case a plain
    // `existing.locked` check would let through.
    const stillOpen = await app.prisma.order.findUnique({ where: { id: order.id } });
    expect(stillOpen!.locked).toBe(false);

    const editAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}`,
      headers: authHeader(encargadoToken),
      payload: { address: 'Nueva dirección después de cerrado' },
    });
    expect(editAttempt.statusCode).toBe(409);
    expect(editAttempt.json().code).toBe('DAY_CLOSED');

    const statusAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}/status`,
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
