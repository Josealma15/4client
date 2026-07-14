import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

const ADMIN_PASS = 'PublicFormAdmin1!';
const DEVICE = 'device-token-001';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

describe('public form routes', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminId: string;
  let adminName: string;
  let adminToken: string;
  let ticketId: string;
  let token: string;
  const phone = '573001112200';

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
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.orders).toEqual([]);
  });

  let firstOrderId: string;

  it('POST /submit with no merge_order_id creates a new order (address/payment optional), items not flagged as client-added', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token, device_token: DEVICE, items: [{ product_name: 'Mango', quantity_label: '2 kg' }] },
    });
    expect(res.statusCode).toBe(201);
    firstOrderId = res.json().data.orderId;

    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId }, include: { items: true } });
    expect(order.address).toBe('Pendiente de confirmar');
    expect(order.payment_method).toBe('sin_asignar');
    expect(order.client_modified).toBe(false);
    // The client's OWN first submission is the original order, not a later edit —
    // never flagged red even though the client is who created it.
    expect(order.items.every(i => i.added_by_client === false)).toBe(true);
  });

  it('GET /form-info now lists that order, editable (status nuevo), with its item', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}` });
    const orders = res.json().data.orders;
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(firstOrderId);
    expect(orders[0].editable).toBe(true);
    expect(orders[0].status).toBe('nuevo');
    expect(orders[0].items).toEqual([{ id: expect.any(String), product_name: 'Mango', quantity_label: '2 kg' }]);
  });

  it('a different device_token for the same ticket is rejected on every public endpoint', async () => {
    const formInfo = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=some-other-device` });
    expect(formInfo.statusCode).toBe(401);
    expect(formInfo.json().code).toBe('INVALID_TOKEN');

    const products = await app.inject({ method: 'GET', url: `/api/v1/public/products?t=${token}&device_token=some-other-device` });
    expect(products.statusCode).toBe(401);

    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token, device_token: 'some-other-device', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    expect(submit.statusCode).toBe(401);

    // The original device is unaffected — still works fine.
    const stillOk = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}` });
    expect(stillOk.statusCode).toBe(200);
  });

  it('POST /submit with merge_order_id replaces the order\'s items with the full submitted list (not append-only), flags only the new/changed line, and sets client_modified', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token, device_token: DEVICE,
        merge_order_id: firstOrderId,
        address: 'Calle 123 #45-67',
        // payment_method intentionally omitted — should NOT clear the existing value
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
    expect(order.address).toBe('Calle 123 #45-67'); // overwritten — a new value was sent
    expect(order.payment_method).toBe('sin_asignar'); // untouched — nothing new was sent
    expect(order.client_modified).toBe(true);

    const mango = order.items.find(i => i.product_name === 'Mango')!;
    const pina = order.items.find(i => i.product_name === 'Piña')!;
    expect(mango.added_by_client).toBe(false); // unchanged from the original submission
    expect(pina.added_by_client).toBe(true); // brand new line added via this edit

    // Merging must never count against the per-link new-order cap.
    const formOrderCount = await app.prisma.order.count({ where: { ticket_id: ticketId, source: 'form' } });
    expect(formOrderCount).toBe(1);
  });

  it('staff saving the order clears client_modified but the per-item added_by_client flag stays permanently — never reset', async () => {
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
    expect(order.client_modified).toBe(false); // bell cleared by the save
    const pina = order.items.find(i => i.product_name === 'Piña')!;
    expect(pina.added_by_client).toBe(true); // provenance survives the staff save untouched
  });

  it('resubmitting the exact same items/address/payment is a no-op — does not flip client_modified or touch items', async () => {
    const before = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId }, include: { items: true } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: {
        token, device_token: DEVICE,
        merge_order_id: firstOrderId,
        address: before.address,
        items: before.items.map(i => ({ product_name: i.product_name, quantity_label: i.quantity_label })),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.unchanged).toBe(true);

    const after = await app.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId } });
    expect(after.client_modified).toBe(false);
  });

  it('POST /submit with a merge_order_id whose order is "camino" (out for delivery) is rejected as editable and falls back to creating a new order — only nuevo/preparando/listo qualify', async () => {
    // Dedicated ticket — isolates this from the shared ticketId's per-link order cap
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
      payload: { token: caminoToken, device_token: 'device-camino', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    const caminoOrderId = create.json().data.orderId;
    await app.prisma.order.update({ where: { id: caminoOrderId }, data: { status: 'camino' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token: caminoToken, device_token: 'device-camino', merge_order_id: caminoOrderId, items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.merged).toBeUndefined();
    expect(res.json().data.orderId).not.toBe(caminoOrderId);
  });

  it('POST /submit with a merge_order_id that is no longer open (closed in the meantime) falls back to creating a new order instead of blocking the client', async () => {
    await app.prisma.order.update({
      where: { id: firstOrderId },
      data: { status: 'cerrado', paid: true, locked: true, paid_by: adminId, paid_at: new Date() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/submit',
      payload: { token, device_token: DEVICE, merge_order_id: firstOrderId, items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.merged).toBeUndefined();
    expect(res.json().data.orderId).not.toBe(firstOrderId);
  });

  it('GET /form-info now shows the closed order as non-editable alongside the new one', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${token}&device_token=${DEVICE}` });
    const orders = res.json().data.orders as any[];
    const closedOne = orders.find(o => o.id === firstOrderId);
    expect(closedOne.editable).toBe(false);
    expect(closedOne.status).toBe('cerrado');
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
    expect(decoded.sentByName).toBe(adminName);
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
      payload: { token: sentToken, device_token: 'device-002', items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
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

      const formInfo = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${revokedToken}&device_token=${DEVICE}` });
      expect(formInfo.statusCode).toBe(401);
      expect(formInfo.json().code).toBe('INVALID_TOKEN');

      const products = await app.inject({ method: 'GET', url: `/api/v1/public/products?t=${revokedToken}&device_token=${DEVICE}` });
      expect(products.statusCode).toBe(401);

      const submit = await app.inject({
        method: 'POST',
        url: '/api/v1/public/submit',
        payload: { token: revokedToken, device_token: DEVICE, items: [{ product_name: 'Mango', quantity_label: '1 kg' }] },
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

      const formInfo = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${freshToken}&device_token=${DEVICE}` });
      expect(formInfo.statusCode).toBe(200);
    });
  });

  // Covers the "bloquear link bloquea TODOS los links de ese chat" requirement —
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
      // (e.g. reminding the client) — same ticket, different JWT.
      newToken = sign();
    });

    it('both an old and a newer link for the same ticket are rejected after a single block call', async () => {
      // Same device_token for both — the device lock is scoped to the TICKET (public.ts's
      // FormLinkSession), not to any one specific link/JWT, so this is the same customer's
      // same phone using two different links sent for the same conversation over time.
      const device = 'multi-device';
      const oldWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${oldToken}&device_token=${device}` });
      expect(oldWorks.statusCode).toBe(200);
      const newWorks = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${newToken}&device_token=${device}` });
      expect(newWorks.statusCode).toBe(200);

      const block = await app.inject({
        method: 'POST',
        url: `/api/v1/inbox/${multiTicketId}/form-link/revoke`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });
      expect(block.statusCode).toBe(200);

      const oldBlocked = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${oldToken}&device_token=${device}` });
      expect(oldBlocked.statusCode).toBe(401);
      const newBlocked = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${newToken}&device_token=${device}` });
      expect(newBlocked.statusCode).toBe(401);
    });
  });
});
