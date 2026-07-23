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

  it('sending a fresh factura for the same ticket auto-supersedes every earlier one, no manual block needed', async () => {
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
});
