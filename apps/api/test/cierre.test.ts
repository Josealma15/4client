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

    // original notes preserved, marker appended — NOT overwritten
    const marker = `pasado_manana:${fecha}`;
    expect(updated!.notes).toContain(originalNotes);
    expect(updated!.notes).toContain(marker);
    expect(updated!.notes).toBe(`${originalNotes}\n${marker}`);
  });

  it('deferring a ticket to "manana" merges into a same-phone ticket that already exists for that date, instead of leaving a dead duplicate (fragmentation fix)', async () => {
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

    // Ticket A: today's ticket, holds the order and an older message.
    const ticketA = await app.prisma.ticket.create({
      data: { org_id: orgId, phone, customer_name: 'Cliente Cierre', fecha: new Date(fecha) },
    });
    await app.prisma.order.update({ where: { id: order.id }, data: { ticket_id: ticketA.id } });
    await app.prisma.ticketMessage.create({
      data: { ticket_id: ticketA.id, direction: 'out', text: 'Mensaje de ayer' },
    });

    // Ticket B: the customer already texted again on "tomorrow" before this cierre ran,
    // so the webhook (which only checks exact-fecha / already-deferred matches) had no
    // choice but to open a second ticket for the same phone+day.
    const ticketB = await app.prisma.ticket.create({
      data: { org_id: orgId, phone, customer_name: 'Cliente Cierre', fecha: tomorrow, unread_count: 1 },
    });
    await app.prisma.ticketMessage.create({
      data: { ticket_id: ticketB.id, direction: 'in', text: 'Mensaje de mañana' },
    });

    const cierre = await app.inject({
      method: 'POST',
      url: '/api/v1/cierre',
      headers: authHeader(encargadoToken),
      payload: { fecha, decisions: { [order.id]: 'manana' } },
    });
    expect(cierre.statusCode).toBe(200);

    // Ticket A is gone — nothing should still point new messages there.
    const staleTicket = await app.prisma.ticket.findUnique({ where: { id: ticketA.id } });
    expect(staleTicket).toBeNull();

    // The order now follows the conversation to wherever it actually landed.
    const updatedOrder = await app.prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder!.ticket_id).toBe(ticketB.id);

    // Both messages — the old one and the one that arrived "tomorrow" — live on the
    // single surviving ticket, so every view (Pedidos, Ver conversación, Chats WPP)
    // resolves to the same complete thread instead of splitting across two rows.
    const messages = await app.prisma.ticketMessage.findMany({ where: { ticket_id: ticketB.id } });
    expect(messages.map(m => m.text).sort()).toEqual(['Mensaje de ayer', 'Mensaje de mañana'].sort());
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
});
