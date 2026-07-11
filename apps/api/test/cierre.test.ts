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
