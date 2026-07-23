import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

const ADMIN_PASS = 'FilesTestAdmin1!';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

describe('files routes (invoice PDF)', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminId: string;
  let adminToken: string;
  let orderId: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    orgId = org.id;
    const admin = await createTestUser(app.prisma, orgId, 'admin', ADMIN_PASS);
    adminId = admin.id;
    adminToken = await login(app, admin.email, ADMIN_PASS);

    const order = await app.prisma.order.create({
      data: {
        org_id: orgId, num: '001', customer_name: 'Cliente Factura',
        customer_phone: '573001114400', address: 'Calle Factura 1',
        payment_method: 'cash', registered_by: adminId, fecha: new Date(),
      },
    });
    orderId = order.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const tinyPdfBase64 = Buffer.from('%PDF-1.4 fake content for test').toString('base64');

  it('POST /invoice stores the PDF and returns a URL pointing at the frontend /factura page, not the raw API', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/files/invoice',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '001', order_id: orderId },
    });
    expect(upload.statusCode).toBe(201);
    const url = upload.json().url as string;
    expect(url).toContain('/factura?f=');
  });

  it('GET requires phone_last4 - wrong digits are rejected distinctly, the real ones serve the PDF', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/files/invoice',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '002', order_id: orderId },
    });
    const filename = new URL(upload.json().url).searchParams.get('f')!;

    const noDigits = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}` });
    expect(noDigits.statusCode).toBe(400);

    const wrong = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}?phone_last4=9999` });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe('PHONE_MISMATCH');

    const right = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}?phone_last4=4400` });
    expect(right.statusCode).toBe(200);
    expect(right.headers['content-type']).toBe('application/pdf');
  });

  it('a filename with no matching invoice_links row (bogus, or predates this protection) is a plain 404, not a crash', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/files/Factura-20260101-000000-testorg-999-deadbeef.pdf?phone_last4=4400' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /:filename/status answers "is this link alive" with no phone_last4 at all - dies the same way once revoked, catches it before the visitor sees the digit-entry screen', async () => {
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001118800', customer_name: 'Cliente Status Factura' } });
    const orderWithTicket = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '008', customer_name: 'Cliente Status Factura',
        customer_phone: '573001118800', address: 'Calle Status 1',
        payment_method: 'cash', registered_by: adminId, fecha: new Date(),
      },
    });
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/files/invoice',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '008', order_id: orderWithTicket.id },
    });
    const filename = new URL(upload.json().url).searchParams.get('f')!;

    const alive = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}/status` });
    expect(alive.statusCode).toBe(200);
    expect(alive.json().data.valid).toBe(true);

    await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/${ticket.id}/form-link/revoke`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });

    const dead = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}/status` });
    expect(dead.statusCode).toBe(410);
    expect(dead.json().code).toBe('INVOICE_EXPIRED');
  });

  it('sending a fresh factura for the same ORDER auto-supersedes every earlier one for it, no manual block needed', async () => {
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001119900', customer_name: 'Cliente Supersede' } });
    const orderWithTicket = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '009', customer_name: 'Cliente Supersede',
        customer_phone: '573001119900', address: 'Calle Supersede 1',
        payment_method: 'cash', registered_by: adminId, fecha: new Date(),
      },
    });

    const first = await app.inject({
      method: 'POST', url: '/api/v1/files/invoice', headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '009', order_id: orderWithTicket.id },
    });
    const firstFilename = new URL(first.json().url).searchParams.get('f')!;

    const second = await app.inject({
      method: 'POST', url: '/api/v1/files/invoice', headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '009', order_id: orderWithTicket.id },
    });
    const secondFilename = new URL(second.json().url).searchParams.get('f')!;

    const third = await app.inject({
      method: 'POST', url: '/api/v1/files/invoice', headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '009', order_id: orderWithTicket.id },
    });
    const thirdFilename = new URL(third.json().url).searchParams.get('f')!;

    const firstDead = await app.inject({ method: 'GET', url: `/api/v1/files/${firstFilename}/status` });
    expect(firstDead.statusCode).toBe(410);
    const secondDead = await app.inject({ method: 'GET', url: `/api/v1/files/${secondFilename}/status` });
    expect(secondDead.statusCode).toBe(410);
    const thirdAlive = await app.inject({ method: 'GET', url: `/api/v1/files/${thirdFilename}/status` });
    expect(thirdAlive.statusCode).toBe(200);
  });

  it('resending a factura for one order does NOT touch a different order\'s still-accurate factura, even in the same conversation', async () => {
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone: '573001119901', customer_name: 'Cliente Dos Pedidos' } });
    const orderA = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '010', customer_name: 'Cliente Dos Pedidos',
        customer_phone: '573001119901', address: 'Calle A', payment_method: 'cash', registered_by: adminId, fecha: new Date(),
      },
    });
    const orderB = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '011', customer_name: 'Cliente Dos Pedidos',
        customer_phone: '573001119901', address: 'Calle B', payment_method: 'cash', registered_by: adminId, fecha: new Date(),
      },
    });

    const invoiceA1 = await app.inject({
      method: 'POST', url: '/api/v1/files/invoice', headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '010', order_id: orderA.id },
    });
    const invoiceB = await app.inject({
      method: 'POST', url: '/api/v1/files/invoice', headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '011', order_id: orderB.id },
    });
    const filenameB = new URL(invoiceB.json().url).searchParams.get('f')!;

    // Resend order A's factura - must supersede A's own previous one, not B's.
    await app.inject({
      method: 'POST', url: '/api/v1/files/invoice', headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '010', order_id: orderA.id },
    });

    const filenameA1 = new URL(invoiceA1.json().url).searchParams.get('f')!;
    const a1Dead = await app.inject({ method: 'GET', url: `/api/v1/files/${filenameA1}/status` });
    expect(a1Dead.statusCode).toBe(410);
    const bStillAlive = await app.inject({ method: 'GET', url: `/api/v1/files/${filenameB}/status` });
    expect(bStillAlive.statusCode).toBe(200);
  });

  it('editing an order (PATCH /orders/:id) invalidates its own outstanding factura - a stale PDF must not keep looking current', async () => {
    const order = await app.prisma.order.create({
      data: {
        org_id: orgId, num: '012', customer_name: 'Cliente Edicion',
        customer_phone: '573001119902', address: 'Calle Original', payment_method: 'cash', registered_by: adminId, fecha: new Date(),
        items: { create: [{ product_name: 'Mango', price: 3000, sort_order: 0 }] },
      },
    });
    const upload = await app.inject({
      method: 'POST', url: '/api/v1/files/invoice', headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '012', order_id: order.id },
    });
    const filename = new URL(upload.json().url).searchParams.get('f')!;

    const beforeEdit = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}/status` });
    expect(beforeEdit.statusCode).toBe(200);

    const edit = await app.inject({
      method: 'PATCH', url: `/api/v1/orders/${order.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { address: 'Calle Nueva Editada' },
    });
    expect(edit.statusCode).toBe(200);

    const afterEdit = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}/status` });
    expect(afterEdit.statusCode).toBe(410);
    expect(afterEdit.json().code).toBe('INVOICE_EXPIRED');
  });

  it('a link nobody opens within 10 minutes of being issued dies on its own, even though it\'s well under the 24h absolute cap', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/files/invoice',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '003', order_id: orderId },
    });
    const filename = new URL(upload.json().url).searchParams.get('f')!;
    // Back-date creation past the 10-minute unopened window, well within 24h.
    await app.prisma.invoiceLink.update({
      where: { filename },
      data: { created_at: new Date(Date.now() - 11 * 60 * 1000) },
    });

    const res = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}?phone_last4=4400` });
    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe('INVOICE_EXPIRED');
  });

  it('a link opened in time keeps working past the 10-minute mark - only ever-unopened links die from that rule', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/files/invoice',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '004', order_id: orderId },
    });
    const filename = new URL(upload.json().url).searchParams.get('f')!;

    // Opened right away, same as a customer who taps the link promptly.
    const firstOpen = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}?phone_last4=4400` });
    expect(firstOpen.statusCode).toBe(200);

    // Backdate creation past 10 minutes - opened_at is already set, so the
    // unopened-dies rule must not fire even though `created_at` looks stale now.
    await app.prisma.invoiceLink.update({
      where: { filename },
      data: { created_at: new Date(Date.now() - 11 * 60 * 1000) },
    });
    const secondOpen = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}?phone_last4=4400` });
    expect(secondOpen.statusCode).toBe(200);
  });

  it('expires at 24h absolute, even if it was opened in time', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/files/invoice',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '005', order_id: orderId },
    });
    const filename = new URL(upload.json().url).searchParams.get('f')!;
    await app.prisma.invoiceLink.update({
      where: { filename },
      data: { created_at: new Date(Date.now() - 25 * 3600 * 1000), opened_at: new Date(Date.now() - 25 * 3600 * 1000) },
    });

    const res = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}?phone_last4=4400` });
    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe('INVOICE_EXPIRED');
  });

  it('POST /invoice for an order belonging to a different org is rejected', async () => {
    const otherOrg = await createTestOrg(app.prisma);
    const otherAdmin = await createTestUser(app.prisma, otherOrg.id, 'admin', 'OtherOrgAdmin1!');
    const otherOrder = await app.prisma.order.create({
      data: {
        org_id: otherOrg.id, num: '001', customer_name: 'Otro Cliente',
        customer_phone: '573009998888', address: 'Otra Calle',
        payment_method: 'cash', registered_by: otherAdmin.id, fecha: new Date(),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files/invoice',
      headers: { authorization: `Bearer ${adminToken}` }, // this org's admin, not otherOrg's
      payload: { data: tinyPdfBase64, num: '001', order_id: otherOrder.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it('"Bloquear link" on a ticket also kills any factura already sent to that same conversation', async () => {
    const ticket = await app.prisma.ticket.create({
      data: { org_id: orgId, phone: '573001115500', customer_name: 'Cliente Con Ticket' },
    });
    const orderWithTicket = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '006', customer_name: 'Cliente Con Ticket',
        customer_phone: '573001115500', address: 'Calle Ticket 1',
        payment_method: 'cash', registered_by: adminId, fecha: new Date(),
      },
    });

    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/files/invoice',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '006', order_id: orderWithTicket.id },
    });
    const filename = new URL(upload.json().url).searchParams.get('f')!;

    const beforeRevoke = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}?phone_last4=5500` });
    expect(beforeRevoke.statusCode).toBe(200);

    const revoke = await app.inject({
      method: 'POST',
      url: `/api/v1/inbox/${ticket.id}/form-link/revoke`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    expect(revoke.statusCode).toBe(200);

    const afterRevoke = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}?phone_last4=5500` });
    expect(afterRevoke.statusCode).toBe(410);
    expect(afterRevoke.json().code).toBe('INVOICE_EXPIRED');
  });

  it('the org-wide "Bloquear todos los links" also kills every outstanding factura, and a fresh one issued afterward still works', async () => {
    const ticket = await app.prisma.ticket.create({
      data: { org_id: orgId, phone: '573001116600', customer_name: 'Cliente Block All' },
    });
    const orderForBlockAll = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '007', customer_name: 'Cliente Block All',
        customer_phone: '573001116600', address: 'Calle Block All 1',
        payment_method: 'cash', registered_by: adminId, fecha: new Date(),
      },
    });

    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/files/invoice',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '007', order_id: orderForBlockAll.id },
    });
    const filename = new URL(upload.json().url).searchParams.get('f')!;

    // Past the second boundary so the block timestamp is genuinely later than this
    // link's created_at (same reasoning as public.test.ts's supersede tests).
    await new Promise((r) => setTimeout(r, 1100));

    const blockAll = await app.inject({
      method: 'POST',
      url: '/api/v1/inbox/form-links/block-all',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(blockAll.statusCode).toBe(200);

    const blocked = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}?phone_last4=6600` });
    expect(blocked.statusCode).toBe(410);
    expect(blocked.json().code).toBe('INVOICE_EXPIRED');

    await new Promise((r) => setTimeout(r, 1100));
    const freshUpload = await app.inject({
      method: 'POST',
      url: '/api/v1/files/invoice',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '007', order_id: orderForBlockAll.id },
    });
    const freshFilename = new URL(freshUpload.json().url).searchParams.get('f')!;
    const freshWorks = await app.inject({ method: 'GET', url: `/api/v1/files/${freshFilename}?phone_last4=6600` });
    expect(freshWorks.statusCode).toBe(200);
  });

  it('10 wrong phone_last4 guesses against a factura link kill it - even the correct digits stop working afterward', async () => {
    // Needs a ticket - the wrong-guess count is shared per-ticket (linkSecurity.ts),
    // and an order with no ticket_id has nothing to share it with (see
    // loadLiveInvoiceLink), so it would never trip this limit at all.
    const phone = '573001119911';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Lockout Factura' } });
    const order = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '900', customer_name: 'Cliente Lockout Factura',
        customer_phone: phone, address: 'Calle Lockout 1',
        payment_method: 'cash', registered_by: adminId, fecha: new Date(),
      },
    });
    const upload = await app.inject({
      method: 'POST', url: '/api/v1/files/invoice', headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '900', order_id: order.id },
    });
    const filename = new URL(upload.json().url).searchParams.get('f')!;

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}?phone_last4=0000` });
      expect(res.statusCode).toBe(401);
    }
    const afterLimit = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}?phone_last4=9911` });
    expect(afterLimit.statusCode).toBe(403);
    expect(afterLimit.json().code).toBe('LINK_ATTEMPTS_EXCEEDED');
  });

  it('10 wrong guesses on a factura link also block that ticket\'s FORM link, not just the factura - the soft block is shared, not per-token', async () => {
    const phone = '573001119912';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Cross Lockout' } });
    const order = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '910', customer_name: 'Cliente Cross Lockout',
        customer_phone: phone, address: 'Calle Cross 1',
        payment_method: 'cash', registered_by: adminId, fecha: new Date(),
      },
    });
    const upload = await app.inject({
      method: 'POST', url: '/api/v1/files/invoice', headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '910', order_id: order.id },
    });
    const filename = new URL(upload.json().url).searchParams.get('f')!;

    for (let i = 0; i < 10; i++) {
      await app.inject({ method: 'GET', url: `/api/v1/files/${filename}?phone_last4=0000` });
    }

    // A form link for the SAME ticket, never touched by any of the above, is dead too.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formToken = (app.jwt.sign as any)({ type: 'form_link', ticketId: ticket.id, orgId }, { expiresIn: '7d' });
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${formToken}&device_token=cross-lockout&phone_last4=9912` });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('LINK_ATTEMPTS_EXCEEDED');
  });

  it('wrong guesses on a factura link count toward the ticket-wide cumulative lockout shared with its form link', async () => {
    const phone = '573001119910';
    const ticket = await app.prisma.ticket.create({ data: { org_id: orgId, phone, customer_name: 'Cliente Combo Lockout' } });
    const order = await app.prisma.order.create({
      data: {
        org_id: orgId, ticket_id: ticket.id, num: '901', customer_name: 'Cliente Combo Lockout',
        customer_phone: phone, address: 'Calle Combo 1',
        payment_method: 'cash', registered_by: adminId, fecha: new Date(),
      },
    });

    const upload = await app.inject({
      method: 'POST', url: '/api/v1/files/invoice', headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '901', order_id: order.id },
    });
    let currentFilename = new URL(upload.json().url).searchParams.get('f')!;

    // 30 wrong guesses on ONE factura would kill it at 10 already, so this spreads
    // them across 3 freshly-resent facturas (each gets its own 10-guess budget) to
    // reach the ticket-wide cumulative total without tripping the per-link limit.
    for (let batch = 0; batch < 3; batch++) {
      for (let i = 0; i < 10; i++) {
        await app.inject({ method: 'GET', url: `/api/v1/files/${currentFilename}?phone_last4=0000` });
      }
      if (batch < 2) {
        const resend = await app.inject({
          method: 'POST', url: '/api/v1/files/invoice', headers: { authorization: `Bearer ${adminToken}` },
          payload: { data: tinyPdfBase64, num: '901', order_id: order.id },
        });
        currentFilename = new URL(resend.json().url).searchParams.get('f')!;
      }
    }

    // The ticket is now blocked - a freshly-issued FORM link for the same ticket
    // is dead too, even though none of the wrong guesses above ever touched it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formToken = (app.jwt.sign as any)({ type: 'form_link', ticketId: ticket.id, orgId }, { expiresIn: '7d' });
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/form-info?t=${formToken}&device_token=combo-lockout&phone_last4=9910` });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('TICKET_BLOCKED');
  });
});
