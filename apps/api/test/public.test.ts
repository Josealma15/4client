import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';
import { isWithinFormHours } from '../src/routes/public.js';

const ADMIN_PASS = 'PublicFormAdmin1!';
const DEVICE = 'device-token-001';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

// Pure function of an explicit `now`, not the real clock - the route wiring itself
// (`if (shouldBlockForHours()) return sendFormClosed(reply)`, public.ts) is disabled
// under NODE_ENV=test specifically so the rest of this file's app.inject calls don't
// pass or fail depending on what hour it happens to be when the suite runs. This is
// what actually verifies the 8pm Colombia boundary is correct.
describe('isWithinFormHours - form links only work between 4am and 8pm Colombia time', () => {
  it('7:59pm Colombia -> still within hours', () => {
    expect(isWithinFormHours(new Date('2026-01-15T19:59:00-05:00').getTime())).toBe(true);
  });
  it('exactly 8:00pm Colombia -> closed', () => {
    expect(isWithinFormHours(new Date('2026-01-15T20:00:00-05:00').getTime())).toBe(false);
  });
  it('11:59pm Colombia -> closed', () => {
    expect(isWithinFormHours(new Date('2026-01-15T23:59:00-05:00').getTime())).toBe(false);
  });
  it('midnight / pre-4am Colombia -> closed', () => {
    expect(isWithinFormHours(new Date('2026-01-15T00:00:00-05:00').getTime())).toBe(false);
    expect(isWithinFormHours(new Date('2026-01-15T03:59:00-05:00').getTime())).toBe(false);
  });
  it('exactly 4:00am Colombia -> within hours', () => {
    expect(isWithinFormHours(new Date('2026-01-15T04:00:00-05:00').getTime())).toBe(true);
  });
  it('mid-morning Colombia -> within hours', () => {
    expect(isWithinFormHours(new Date('2026-01-15T07:00:00-05:00').getTime())).toBe(true);
  });
});

describe('public form routes', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminId: string;
  let adminName: string;
  let adminToken: string;
  let ticketId: string;
  let token: string;
  const phone = '573001112200';
  const PHONE4 = '2200';

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', ADMIN_PASS);
    adminId = admin.id;
    adminName = admin.name;
    adminToken = await login(app, admin.email, ADMIN_PASS);

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

  it('GET /form-info reports no orders before any pedido exists', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}&phone_last4=${PHONE4}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.orders).toEqual([]);
  });

  let firstOrderId: string;

  it('POST /submit without an address is rejected - address is required, payment method is not', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token, device_token: DEVICE, phone_last4: PHONE4, items: [{ product_name: 'Mango', quantity_label: '2 kg' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('POST /submit with no merge_order_id creates a new order (address required, payment optional), items not flagged as client-added', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token, device_token: DEVICE, phone_last4: PHONE4, address: 'Calle 1 #2-34', items: [{ product_name: 'Mango', quantity_label: '2 kg' }] },
    });
    expect(res.statusCode).toBe(201);
    firstOrderId = res.json().data.orderId;

    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId }, include: { items: true } });
    expect(order.address).toBe('Calle 1 #2-34');
    expect(order.payment_method).toBe('sin_asignar');
    expect(order.client_modified).toBe(false);
    // The client's OWN first submission is the original order, not a later edit -
    // never flagged red even though the client is who created it.
    expect(order.items.every(i => i.added_by_client === false)).toBe(true);
  });

  it('GET /form-info now lists that order, editable (status nuevo), with its item', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}&phone_last4=${PHONE4}` });
    const orders = res.json().data.orders;
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(firstOrderId);
    expect(orders[0].editable).toBe(true);
    expect(orders[0].status).toBe('nuevo');
    expect(orders[0].items).toEqual([{ id: expect.any(String), product_name: 'Mango', quantity_label: '2 kg', price: 3000 }]);
  });

  it('the device lock only guards /submit - viewing form-info/products from a different device_token still works, only submitting from one does not', async () => {
    // Merely looking (GET) never claims or checks a device - only a real submit does
    // (see public.ts's assertDeviceOk comment: this used to run on every request,
    // which broke iPhone links whose first "open" was WhatsApp's own in-app browser
    // previewing it before the customer ever reached Safari).
    const formInfo = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=some-other-device&phone_last4=${PHONE4}` });
    expect(formInfo.statusCode).toBe(200);

    const products = await app.inject({ method: 'GET', url: `/api/v1/public/products?t=${token}&device_token=some-other-device&phone_last4=${PHONE4}` });
    expect(products.statusCode).toBe(200);

    // firstOrderId's earlier submit (above) already claimed the ticket for DEVICE -
    // a different device_token submitting now is rejected.
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token, device_token: 'some-other-device', phone_last4: PHONE4, address: 'Calle Test 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    expect(submit.statusCode).toBe(401);

    // The original device is unaffected - still works fine.
    const stillOk = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}&phone_last4=${PHONE4}` });
    expect(stillOk.statusCode).toBe(200);
  });

  it('wrong phone_last4 is rejected with its own distinct error, not the generic "link inválido" - the right digits still work', async () => {
    const wrong = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}&phone_last4=9999` });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe('PHONE_MISMATCH');

    const right = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}&phone_last4=${PHONE4}` });
    expect(right.statusCode).toBe(200);
  });

  it('GET /link-status answers "is this link alive" with no phone_last4 at all - a revoked link is caught here before the visitor ever sees the digit-entry screen', async () => {
    const statusTicket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001117700', customer_name: 'Cliente Status' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statusToken = (app.jwt.sign as any)({ type: 'form_link', ticketId: statusTicket.id, orgId }, { expiresIn: '7d' });

    const alive = await app.inject({ method: 'GET', url: `/api/v1/public/link-status?t=${statusToken}` });
    expect(alive.statusCode).toBe(200);
    expect(alive.json().data.valid).toBe(true);

    const revoke = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/${statusTicket.id}/form-link/revoke`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    expect(revoke.statusCode).toBe(200);

    const dead = await app.inject({ method: 'GET', url: `/api/v1/public/link-status?t=${statusToken}` });
    expect(dead.statusCode).toBe(401);
    expect(dead.json().code).toBe('INVALID_TOKEN');
  });

  it('a link nobody opens within 10 minutes of being issued dies on its own - one opened in time keeps working past that mark', async () => {
    const staleTicket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001112233', customer_name: 'Cliente Nunca Abrio' } });
    const openedTicket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001112234', customer_name: 'Cliente Si Abrio' } });
    const oldIat = Math.floor(Date.now() / 1000) - 700; // 11m40s ago
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sign = (tId: string) => (app.jwt.sign as any)(
      { type: 'form_link', ticketId: tId, orgId, iat: oldIat },
      { expiresIn: '7d' },
    );
    const staleToken = sign(staleTicket.id);
    const openedToken = sign(openedTicket.id);

    // Simulates openedTicket's link having been opened (a real form-info call) well
    // within its first 10 minutes, before this old `iat` would otherwise matter -
    // once form_link_opened_at is set, assertLinkStillValid never re-checks the
    // 10-minute window for this link again, no matter how stale `iat` gets from here.
    await app.prisma.ticket.update({ where: { id: openedTicket.id }, data: { form_link_opened_at: new Date(oldIat * 1000 + 60_000) } });

    const staleRes = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${staleToken}&device_token=stale-device&phone_last4=2233` });
    expect(staleRes.statusCode).toBe(401);
    expect(staleRes.json().code).toBe('INVALID_TOKEN');

    const openedRes = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${openedToken}&device_token=opened-device&phone_last4=2234` });
    expect(openedRes.statusCode).toBe(200);
  });

  it('POST /submit with merge_order_id replaces the order\'s items with the full submitted list (not append-only), flags only the new/changed line, and sets client_modified', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token, device_token: DEVICE, phone_last4: PHONE4,
        merge_order_id: firstOrderId,
        address: 'Calle 123 #45-67',
        // payment_method intentionally omitted - should NOT clear the existing value
        // Resubmits the ORIGINAL "Mango: 2 kg" unchanged, plus a new "Piña" line.
        items: [{ product_name: 'Mango', quantity_label: '2 kg' }, { product_name: 'Piña', quantity_label: '1 unidad' }],
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
    expect(order.address).toBe('Calle 123 #45-67'); // overwritten - a new value was sent
    expect(order.payment_method).toBe('sin_asignar'); // untouched - nothing new was sent
    expect(order.client_modified).toBe(true);

    const mango = order.items.find(i => i.product_name === 'Mango')!;
    const pina = order.items.find(i => i.product_name === 'Piña')!;
    expect(mango.added_by_client).toBe(false); // unchanged from the original submission
    expect(pina.added_by_client).toBe(true); // brand new line added via this edit

    // Merging must never count against the per-link new-order cap.
    const formOrderCount = await app.prisma.order.count({ where: { ticket_id: ticketId, source: 'form' } });
    expect(formOrderCount).toBe(1);
  });

  it('staff saving the order does NOT clear client_modified - it stays permanently, same as the per-item added_by_client flag', async () => {
    const saveRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${firstOrderId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        items: [
          { product_name: 'Mango', quantity_label: '2 kg', price: 3000, sort_order: 0, added_by_client: false },
          { product_name: 'Piña', quantity_label: '1 unidad', price: 4000, sort_order: 1, added_by_client: true },
        ],
      },
    });
    expect(saveRes.statusCode).toBe(200);

    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId }, include: { items: true } });
    expect(order.client_modified).toBe(true); // stays set - a staff save no longer clears it
    const pina = order.items.find(i => i.product_name === 'Piña')!;
    expect(pina.added_by_client).toBe(true); // provenance survives the staff save untouched
  });

  it('a client resubmit NEVER overwrites an existing item\'s price with the catalog price, even when the catalog has one - only a brand-new line gets the catalog price', async () => {
    // Mango has a real catalog price_per_unit (3000, set in beforeAll) - staff
    // hand-overrides it on THIS specific order to something different (say, a
    // bulk discount), matching a real "encargado adjusts the price" scenario.
    await app.prisma.orderItem.updateMany({
      where: { order_id: firstOrderId, product_name: 'Mango' },
      data: { price: 2500 },
    });

    // Client resubmits with only the address changed (even a single-letter edit is
    // the exact bug report) - Mango isn't touched at all, just resent as part of
    // "this is the whole order now".
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token, device_token: DEVICE, phone_last4: PHONE4,
        merge_order_id: firstOrderId,
        address: 'Calle 123 #45-67x',
        items: [{ product_name: 'Mango', quantity_label: '2 kg' }, { product_name: 'Piña', quantity_label: '1 unidad' }],
      },
    });
    expect(res.statusCode).toBe(200);

    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId }, include: { items: true } });
    const mango = order.items.find(i => i.product_name === 'Mango')!;
    // Still 2500 - the catalog's 3000 must NOT have silently won.
    expect(Number(mango.price)).toBe(2500);
  });

  it('resubmitting the exact same items/address/payment is a no-op - does not touch client_modified or items', async () => {
    const before = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId }, include: { items: true } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token, device_token: DEVICE, phone_last4: PHONE4,
        merge_order_id: firstOrderId,
        address: before.address,
        items: before.items.map(i => ({ product_name: i.product_name, quantity_label: i.quantity_label })),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.unchanged).toBe(true);

    const after = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId } });
    expect(after.client_modified).toBe(before.client_modified);
  });

  it('POST /submit with a merge_order_id whose order became "camino" (out for delivery) while the client was editing is rejected with 409 - NOT silently duplicated as a new order', async () => {
    // Dedicated ticket - isolates this from the shared ticketId's per-link order cap
    // (MAX_FORM_ORDERS_PER_TICKET), which later tests below still rely on being unspent.
    const caminoPhone = '573001112288';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: caminoPhone, customer_name: 'Cliente Camino' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caminoToken = (app.jwt.sign as any)(
      { type: 'form_link', ticketId: ticket.id, orgId, clientName: 'Cliente Camino', clientPhone: caminoPhone, orgName: 'org' },
      { expiresIn: '7d' },
    );
    const create = await app.inject({
      method: 'POST', url: '/api/v1/public/submit',
      payload: { token: caminoToken, device_token: 'device-camino', phone_last4: '2288', address: 'Calle Camino 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    const caminoOrderId = create.json().data.orderId;
    await app.prisma.order.update({ where: { id: caminoOrderId }, data: { status: 'camino' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token: caminoToken, device_token: 'device-camino', phone_last4: '2288', merge_order_id: caminoOrderId,
        address: 'Calle Camino 1',
        items: [{ product_name: 'Mango', quantity_label: '1 kg' }, { product_name: 'Piña', quantity_label: '1 unidad' }],
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ORDER_NOT_EDITABLE');
    expect(res.json().error).toContain('en camino');

    // No duplicate was created - this ticket still has exactly the one order.
    const formOrders = await app.prisma.order.findMany({ where: { ticket_id: ticket.id } });
    expect(formOrders).toHaveLength(1);
    expect(formOrders[0].id).toBe(caminoOrderId);
  });

  it('a pedido an encargado typed up manually (source !== "form") can never be merged into via the client form, even while it\'s otherwise in an editable status', async () => {
    const staffPhone = '573001112260';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: staffPhone, customer_name: 'Cliente Pedido Encargado' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const staffOrderToken = (app.jwt.sign as any)(
      { type: 'form_link', ticketId: ticket.id, orgId },
      { expiresIn: '7d' },
    );
    // Created the way an encargado would - directly via POST /orders, not the form.
    const staffOrder = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '900', customer_name: 'Cliente Pedido Encargado',
        customer_phone: staffPhone, address: 'Calle Encargado 1', payment_method: 'cash',
        registered_by: adminId, fecha: new Date(), source: 'encargado', status: 'nuevo',
        items: { create: [{ product_name: 'Mango', price: 3000, sort_order: 0 }] },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token: staffOrderToken, device_token: 'device-staff-order', phone_last4: '2260',
        merge_order_id: staffOrder.id, address: 'Calle Encargado 1',
        items: [{ product_name: 'Mango', quantity_label: '1 kg' }],
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ORDER_NOT_EDITABLE');

    // Untouched - still exactly the one item staff put on it, at staff's price.
    const after = await app.prisma.order.findUniqueOrThrow({ where: { id: staffOrder.id }, include: { items: true } });
    expect(after.items).toHaveLength(1);
    expect(Number(after.items[0].price)).toBe(3000);
  });

  it('GET /form-info marks a pedido an encargado typed up manually as not editable, even while it\'s in an editable status - the client can only view it', async () => {
    const staffPhone2 = '573001112261';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: staffPhone2, customer_name: 'Cliente Ver Pedido Encargado' } });
    await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '901', customer_name: 'Cliente Ver Pedido Encargado',
        customer_phone: staffPhone2, address: 'Calle Encargado 2', payment_method: 'cash',
        registered_by: adminId, fecha: new Date(), source: 'encargado', status: 'nuevo',
        items: { create: [{ product_name: 'Mango', price: 3000, sort_order: 0 }] },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viewToken = (app.jwt.sign as any)({ type: 'form_link', ticketId: ticket.id, orgId }, { expiresIn: '7d' });

    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${viewToken}&device_token=device-view&phone_last4=2261` });
    expect(res.statusCode).toBe(200);
    const orders = res.json().data.orders as any[];
    expect(orders).toHaveLength(1);
    expect(orders[0].editable).toBe(false);
    expect(orders[0].items[0].price).toBe(3000);
  });

  it('POST /submit with a merge_order_id that is no longer open (closed in the meantime) is rejected with 409, not silently duplicated', async () => {
    await app.prisma.order.update({
      where: { id: firstOrderId },
      data: { status: 'cerrado', paid: true, locked: true, paid_by: adminId, paid_at: new Date() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token, device_token: DEVICE, phone_last4: PHONE4, merge_order_id: firstOrderId, address: 'Calle Cerrado 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ORDER_NOT_EDITABLE');
  });

  it('GET /form-info no longer lists the closed order at all - nothing left for the client to see or do with it', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}&phone_last4=${PHONE4}` });
    const orders = res.json().data.orders as any[];
    expect(orders.find(o => o.id === firstOrderId)).toBeUndefined();
  });

  it('GET /form-info still lists a "camino" order, read-only', async () => {
    const caminoPhone2 = '573001112266';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: caminoPhone2, customer_name: 'Cliente Camino 2' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caminoToken2 = (app.jwt.sign as any)(
      { type: 'form_link', ticketId: ticket.id, orgId, clientName: 'Cliente Camino 2', clientPhone: caminoPhone2, orgName: 'org' },
      { expiresIn: '7d' },
    );
    const create = await app.inject({
      method: 'POST', url: '/api/v1/public/submit',
      payload: { token: caminoToken2, device_token: 'device-camino-2', phone_last4: '2266', address: 'Calle Camino 2', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    const orderId = create.json().data.orderId;
    await app.prisma.order.update({ where: { id: orderId }, data: { status: 'camino' } });

    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${caminoToken2}&device_token=device-camino-2&phone_last4=2266` });
    const orders = res.json().data.orders as any[];
    const found = orders.find(o => o.id === orderId);
    expect(found).toBeDefined();
    expect(found.editable).toBe(false);
    expect(found.status).toBe('camino');
  });

  it('GET /inbox/:ticketId/form-link embeds who sent it and expires by end of the current Colombia day, not 7 days out', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/inbox/${ticketId}/form-link`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const url = res.json().data.url as string;
    const sentToken = new URL(url).searchParams.get('t')!;

    const decoded = app.jwt.decode(sentToken) as any;
    expect(decoded.sentByUserId).toBe(adminId);
    // clientName/clientPhone/orgName/sentByName used to be embedded here too - now
    // dropped to keep the token (and the WhatsApp link built from it) shorter; every
    // route that needs them reads the current value off the ticket/org instead.
    expect(decoded.clientName).toBeUndefined();
    expect(decoded.sentByName).toBeUndefined();
    // Bounded well under the old 7-day expiry, and never more than ~24h out.
    const secondsUntilExpiry = decoded.exp - Math.floor(Date.now() / 1000);
    expect(secondsUntilExpiry).toBeGreaterThan(0);
    expect(secondsUntilExpiry).toBeLessThanOrEqual(24 * 3600);
  });

  it('an order created through a real /form-link token is attributed to (registered_by) the staff member who sent it, and the history note names them', async () => {
    const linkRes = await app.inject({
      method: 'GET',
      url: `/api/v1/inbox/${ticketId}/form-link`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const sentToken = new URL(linkRes.json().data.url).searchParams.get('t')!;

    const submitRes = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token: sentToken, device_token: 'device-002', phone_last4: PHONE4, address: 'Calle Atribucion 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    expect(submitRes.statusCode).toBe(201);
    const newOrderId = submitRes.json().data.orderId;

    const order = await app.prisma.order.findUniqueOrThrow({
      where: { id: newOrderId },
      include: { history: true },
    });
    expect(order.registered_by).toBe(adminId);
    const createEntry = order.history.find(h => h.action_type === 'create');
    expect(createEntry?.notes).toContain(adminName);
    expect(createEntry?.actor_id).toBe(adminId);
  });

  describe('form-link revocation', () => {
    const revokedPhone = '573001112299';
    let revokedTicketId: string;
    let revokedToken: string;

    beforeAll(async () => {
      const ticket = await app.prisma.ticket.create({
        data: { org_id: orgId, phone: revokedPhone, customer_name: 'Cliente Revocado' },
      });
      revokedTicketId = ticket.id;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      revokedToken = (app.jwt.sign as any)(
        { type: 'form_link', ticketId: revokedTicketId, orgId, clientName: 'Cliente Revocado', clientPhone: revokedPhone, orgName: 'org' },
        { expiresIn: '7d' },
      );
    });

    it('POST /inbox/:ticketId/form-link/revoke requires auth', async () => {
      const res = await app.inject({ method: 'POST', url: `/api/v1/inbox/${revokedTicketId}/form-link/revoke`, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it('after revoking, the previously-issued token is rejected on every public endpoint (fails closed)', async () => {
      const revoke = await app.inject({
        method: 'POST',
        url: `/api/v1/inbox/${revokedTicketId}/form-link/revoke`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { reason: 'Enviado al número equivocado' },
      });
      expect(revoke.statusCode).toBe(200);

      const formInfo = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${revokedToken}&device_token=${DEVICE}&phone_last4=2299` });
      expect(formInfo.statusCode).toBe(401);
      expect(formInfo.json().code).toBe('INVALID_TOKEN');

      const products = await app.inject({ method: 'GET', url: `/api/v1/public/products?t=${revokedToken}&device_token=${DEVICE}&phone_last4=2299` });
      expect(products.statusCode).toBe(401);

      const submit = await app.inject({
        method: 'POST',
        url: '/api/v1/public/submit',
        payload: { token: revokedToken, device_token: DEVICE, phone_last4: '2299', address: 'Calle Revocado 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
      });
      expect(submit.statusCode).toBe(401);
      expect(submit.json().code).toBe('INVALID_TOKEN');
    });

    it('generating a fresh form-link clears the earlier revocation, so the new link works', async () => {
      const linkRes = await app.inject({
        method: 'GET',
        url: `/api/v1/inbox/${revokedTicketId}/form-link`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(linkRes.statusCode).toBe(200);
      const freshToken = new URL(linkRes.json().data.url).searchParams.get('t')!;

      const formInfo = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${freshToken}&device_token=${DEVICE}&phone_last4=2299` });
      expect(formInfo.statusCode).toBe(200);
    });

    it('sending a fresh form-link automatically supersedes (kills) every earlier still-unexpired link for the same ticket, no manual "Bloquear link" needed', async () => {
      const phone = '573001112255';
      const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Reenvio' } });

      const first = await app.inject({
        method: 'GET', url: `/api/v1/inbox/${ticket.id}/form-link`, headers: { authorization: `Bearer ${adminToken}` },
      });
      const firstToken = new URL(first.json().data.url).searchParams.get('t')!;

      const firstWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${firstToken}&device_token=resend-device&phone_last4=2255` });
      expect(firstWorks.statusCode).toBe(200);

      // The supersede check compares `iat` at whole-second resolution - wait past the
      // second boundary so the second link genuinely gets a later `iat` than the
      // first, otherwise two links minted in the same clock second would (correctly)
      // both remain valid, which isn't the scenario this test is exercising.
      await new Promise(r => setTimeout(r, 1100));

      // Staff sends a second link for the same ticket (e.g. a reminder) - the first
      // one must die automatically, with no separate revoke call.
      const second = await app.inject({
        method: 'GET', url: `/api/v1/inbox/${ticket.id}/form-link`, headers: { authorization: `Bearer ${adminToken}` },
      });
      const secondToken = new URL(second.json().data.url).searchParams.get('t')!;
      expect(secondToken).not.toBe(firstToken);

      const firstNowBlocked = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${firstToken}&device_token=resend-device&phone_last4=2255` });
      expect(firstNowBlocked.statusCode).toBe(401);
      expect(firstNowBlocked.json().code).toBe('INVALID_TOKEN');

      const secondWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${secondToken}&device_token=resend-device-2&phone_last4=2255` });
      expect(secondWorks.statusCode).toBe(200);
    });
  });

  // Covers the "bloquear link bloquea TODOS los links de ese chat" requirement -
  // several links sent over time for the same ticket all embed the same ticketId,
  // and revocation is keyed purely by ticketId, so one block call must invalidate
  // every one of them at once, not just whichever was issued last.
  describe('blocking a link blocks every link ever issued for that ticket, not just the latest', () => {
    const multiPhone = '573001112277';
    let multiTicketId: string;
    let oldToken: string;
    let newToken: string;

    beforeAll(async () => {
      const ticket = await app.prisma.ticket.create({
        data: { org_id: orgId, phone: multiPhone, customer_name: 'Cliente Multi Link' },
      });
      multiTicketId = ticket.id;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sign = (extra: Record<string, unknown> = {}) => (app.jwt.sign as any)(
        { type: 'form_link', ticketId: multiTicketId, orgId, clientName: 'Cliente Multi Link', clientPhone: multiPhone, orgName: 'org', ...extra },
        { expiresIn: '7d' },
      );
      oldToken = sign();
      // A later link, issued as if staff sent a second "Formulario" message afterward
      // (e.g. reminding the client) - same ticket, different JWT.
      newToken = sign();
    });

    it('both an old and a newer link for the same ticket are rejected after a single block call', async () => {
      // Same device_token for both - the device lock is scoped to the TICKET (public.ts's
      // FormLinkSession), not to any one specific link/JWT, so this is the same customer's
      // same phone using two different links sent for the same conversation over time.
      const device = 'multi-device';
      const oldWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${oldToken}&device_token=${device}&phone_last4=2277` });
      expect(oldWorks.statusCode).toBe(200);
      const newWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${newToken}&device_token=${device}&phone_last4=2277` });
      expect(newWorks.statusCode).toBe(200);

      const block = await app.inject({
        method: 'POST',
        url: `/api/v1/inbox/${multiTicketId}/form-link/revoke`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });
      expect(block.statusCode).toBe(200);

      const oldBlocked = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${oldToken}&device_token=${device}&phone_last4=2277` });
      expect(oldBlocked.statusCode).toBe(401);
      const newBlocked = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${newToken}&device_token=${device}&phone_last4=2277` });
      expect(newBlocked.statusCode).toBe(401);
    });
  });

  // A ticket is now one row per phone FOREVER (schema.prisma), not per day - so the
  // per-link new-order cap (MAX_FORM_ORDERS_PER_TICKET=3, public.ts) must be scoped
  // to TODAY, not the ticket's whole lifetime, or a long-time customer eventually
  // places their 4th-ever form order and is permanently locked out of the link.
  it('the per-link new-order cap only counts TODAY\'s form orders - old-day orders never count against it, and a fresh day resets it', async () => {
    const capPhone = '573001112244';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: capPhone, customer_name: 'Cliente Limite Diario' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const capToken = (app.jwt.sign as any)(
      { type: 'form_link', ticketId: ticket.id, orgId, clientName: 'Cliente Limite Diario', clientPhone: capPhone, orgName: 'org' },
      { expiresIn: '7d' },
    );
    const admin = await app.prisma.user.findFirstOrThrow({ where: { org_id: orgId, role: 'admin' } });

    // 5 old form orders from a past day - well over the cap of 3, but none of them
    // should count since they're not from today.
    for (let i = 0; i < 5; i++) {
      await app.prisma.order.create({
        data: {
          org_id: orgId, ticket_id: ticket.id, num: String(i + 1).padStart(3, '0'),
          customer_name: 'Cliente Limite Diario', address: 'Calle vieja', payment_method: 'cash',
          registered_by: admin.id, fecha: new Date('2026-01-01'), source: 'form',
        },
      });
    }

    const device = 'device-limite-diario';
    // 3 new orders TODAY should all succeed (the cap, but for today).
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/public/submit',
        payload: { token: capToken, device_token: device, phone_last4: '2244', address: 'Calle Limite 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
      });
      expect(res.statusCode).toBe(201);
    }
    // The 4th today hits the cap.
    const blocked = await app.inject({
      method: 'POST', url: '/api/v1/public/submit',
      payload: { token: capToken, device_token: device, phone_last4: '2244', address: 'Calle Limite 1', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('FORM_LIMIT_REACHED');
  });

  describe('POST /inbox/form-links/block-all - org-wide kill switch', () => {
    it('requires admin - encargado forbidden, no auth rejected', async () => {
      const ENCARGADO_PASS = 'BlockAllEncargado1!';
      const encargado = await createTestUser(app.prisma, orgId, 'encargado', ENCARGADO_PASS, {
        email: `blockall-encargado-${Date.now()}@example.com`,
      });
      const encargadoToken = await login(app, encargado.email, ENCARGADO_PASS);

      const forbidden = await app.inject({
        method: 'POST',
        url: '/api/v1/inbox/form-links/block-all',
        headers: { authorization: `Bearer ${encargadoToken}` },
      });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().code).toBe('FORBIDDEN');

      const noAuth = await app.inject({ method: 'POST', url: '/api/v1/inbox/form-links/block-all' });
      expect(noAuth.statusCode).toBe(401);
    });

    it('blocks every outstanding link across every ticket in the org at once, and a link issued afterward still works', async () => {
      const phoneA = '573001112211';
      const phoneB = '573001112222';
      const ticketA = await app.prisma.ticket.create({ data: { org_id: orgId, phone: phoneA, customer_name: 'Cliente Block A' } });
      const ticketB = await app.prisma.ticket.create({ data: { org_id: orgId, phone: phoneB, customer_name: 'Cliente Block B' } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sign = (ticketId: string, orgName: string, clientName: string, clientPhone: string) => (app.jwt.sign as any)(
        { type: 'form_link', ticketId, orgId, clientName, clientPhone, orgName },
        { expiresIn: '7d' },
      );
      const tokenA = sign(ticketA.id, 'org', 'Cliente Block A', phoneA);
      const tokenB = sign(ticketB.id, 'org', 'Cliente Block B', phoneB);

      const aWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${tokenA}&device_token=block-a&phone_last4=2211` });
      expect(aWorks.statusCode).toBe(200);
      const bWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${tokenB}&device_token=block-b&phone_last4=2222` });
      expect(bWorks.statusCode).toBe(200);

      // Past the second boundary so the block timestamp is genuinely later than
      // either token's `iat` (whole-second comparison, same reasoning as the
      // supersede test above).
      await new Promise(r => setTimeout(r, 1100));

      const block = await app.inject({
        method: 'POST',
        url: '/api/v1/inbox/form-links/block-all',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(block.statusCode).toBe(200);

      const aBlocked = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${tokenA}&device_token=block-a&phone_last4=2211` });
      expect(aBlocked.statusCode).toBe(401);
      const bBlocked = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${tokenB}&device_token=block-b&phone_last4=2222` });
      expect(bBlocked.statusCode).toBe(401);

      await new Promise(r => setTimeout(r, 1100));
      const freshToken = sign(ticketA.id, 'org', 'Cliente Block A', phoneA);
      // Same device_token as before - ticketA's FormLinkSession is still claimed by
      // "block-a" (only inbox.ts's real GET /form-link clears it on a fresh send,
      // which this test bypasses by signing the JWT directly); a different
      // device_token here would 401 on the device-lock check, not proving anything
      // about the org-block feature this test is actually about.
      const freshWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${freshToken}&device_token=block-a&phone_last4=2211` });
      expect(freshWorks.statusCode).toBe(200);
    });
  });
});

describe('link abuse lockout - repeated wrong PIN guesses', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminId: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', 'LockoutAdmin1!');
    adminId = admin.id;
    adminToken = await login(app, admin.email, 'LockoutAdmin1!');
  });

  afterAll(async () => {
    await app.close();
  });

  function sign(ticketId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (app.jwt.sign as any)({ type: 'form_link', ticketId, orgId }, { expiresIn: '7d' });
  }

  it('10 wrong phone_last4 guesses against the same link kill it - even the correct digits stop working afterward', async () => {
    const phone = '573001119900';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Lockout Link' } });
    const token = sign(ticket.id);

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=lockout-link&phone_last4=0000` });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('PHONE_MISMATCH');
    }

    // 11th try, this time with the RIGHT digits - the link itself is already dead.
    const afterLimit = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=lockout-link&phone_last4=9900` });
    expect(afterLimit.statusCode).toBe(403);
    expect(afterLimit.json().code).toBe('LINK_ATTEMPTS_EXCEEDED');

    // GET /link-status - checked BEFORE the digit-entry screen even shows - must
    // surface this SAME specific reason, not the generic "Link inválido o expirado"
    // (that was the bug: the PDF's equivalent /status route already showed the
    // specific reason, this one didn't).
    const status = await app.inject({ method: 'GET', url: `/api/v1/public/link-status?t=${token}` });
    expect(status.statusCode).toBe(403);
    expect(status.json().code).toBe('LINK_ATTEMPTS_EXCEEDED');
  });

  it('a freshly-issued link resets the per-link count, so it works again even after the old one got exhausted', async () => {
    const phone = '573001119901';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Lockout Reset' } });
    const staleToken = sign(ticket.id);

    for (let i = 0; i < 10; i++) {
      await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${staleToken}&device_token=lockout-reset&phone_last4=0000` });
    }
    const dead = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${staleToken}&device_token=lockout-reset&phone_last4=9901` });
    expect(dead.statusCode).toBe(403);
    expect(dead.json().code).toBe('LINK_ATTEMPTS_EXCEEDED');

    const linkRes = await app.inject({ method: 'GET', url: `/api/v1/inbox/${ticket.id}/form-link`, headers: { authorization: `Bearer ${adminToken}` } });
    const freshToken = new URL(linkRes.json().data.url).searchParams.get('t')!;
    const works = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${freshToken}&device_token=lockout-reset&phone_last4=9901` });
    expect(works.statusCode).toBe(200);
  });

  it('30 cumulative wrong guesses across re-issued links blocks the WHOLE ticket for 24h, even a link issued after the block started', async () => {
    const phone = '573001119902';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Lockout Ticket' } });

    // Burn through 3 links' worth of wrong guesses (10 each = 30 total) - each
    // fresh link resets ITS OWN per-link count, but the ticket-wide cumulative
    // count (what actually matters here) is never reset by issuing a new link.
    for (let link = 0; link < 3; link++) {
      const linkRes = await app.inject({ method: 'GET', url: `/api/v1/inbox/${ticket.id}/form-link`, headers: { authorization: `Bearer ${adminToken}` } });
      const t = new URL(linkRes.json().data.url).searchParams.get('t')!;
      for (let i = 0; i < 10; i++) {
        await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${t}&device_token=lockout-ticket-${link}&phone_last4=0000` });
      }
    }

    // A brand-new link, issued AFTER the block was triggered, is still blocked -
    // it's the ticket that's locked out, not any one token.
    const linkRes = await app.inject({ method: 'GET', url: `/api/v1/inbox/${ticket.id}/form-link`, headers: { authorization: `Bearer ${adminToken}` } });
    const freshToken = new URL(linkRes.json().data.url).searchParams.get('t')!;
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${freshToken}&device_token=lockout-ticket-final&phone_last4=9902` });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('TICKET_BLOCKED');

    // Same check via /link-status, the pre-digit-entry precheck a fresh page load
    // actually hits first - must show TICKET_BLOCKED there too, not a generic error.
    const status = await app.inject({ method: 'GET', url: `/api/v1/public/link-status?t=${freshToken}` });
    expect(status.statusCode).toBe(403);
    expect(status.json().code).toBe('TICKET_BLOCKED');
  });

  it('10 wrong guesses on the FORM link also block that ticket\'s already-outstanding factura link, not just the form link - the soft block is shared, not per-token', async () => {
    const phone = '573001119903';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Cross Lockout Form' } });

    // Factura sent BEFORE the wrong guesses below - sending a NEW one afterward
    // would itself clear the soft block (it's the "give another chance" action),
    // which would hide the exact bug this test guards against.
    const order = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '920', customer_name: 'Cliente Cross Lockout Form',
        customer_phone: phone, address: 'Calle Cross Form 1',
        payment_method: 'cash', registered_by: adminId, fecha: new Date(),
      },
    });
    const tinyPdfBase64 = Buffer.from('%PDF-1.4 fake content for test').toString('base64');
    const upload = await app.inject({
      method: 'POST', url: '/api/v1/files/invoice', headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '920', order_id: order.id },
    });
    const filename = new URL(upload.json().url).searchParams.get('f')!;

    const token = sign(ticket.id);
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=cross-lockout-form&phone_last4=0000` });
    }

    // The factura, never touched by any of the wrong guesses above, is dead too.
    const res = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}?phone_last4=9903` });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('LINK_ATTEMPTS_EXCEEDED');
  });
});
