import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, createTestOrg, createTestUser } from './helpers.js';

const ADMIN_PASS = 'FilesTestAdmin1!';

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.accessToken as string;
}

// Builds a filename in the exact shape POST /files/invoice generates
// (Factura-YYYYMMDD-HHMMSS-org-num-id.pdf), stamped `hoursAgo` hours in the past —
// mirrors the -5h Bogota shift baked in at upload time (routes/files.ts).
function stampedFilename(hoursAgo: number): string {
  const bogotaMs = Date.now() - 5 * 3600000 - hoursAgo * 3600000;
  const stamp = new Date(bogotaMs).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
  return `Factura-${stamp}-testorg-001-abc123.pdf`;
}

describe('files routes (invoice PDF)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    const org = await createTestOrg(app.prisma);
    const admin = await createTestUser(app.prisma, org.id, 'admin', ADMIN_PASS);
    adminToken = await login(app, admin.email, ADMIN_PASS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /invoice stores the PDF and returns a URL that GET actually serves', async () => {
    const tinyPdfBase64 = Buffer.from('%PDF-1.4 fake content for test').toString('base64');
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/files/invoice',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { data: tinyPdfBase64, num: '001' },
    });
    expect(upload.statusCode).toBe(201);
    const url = upload.json().url as string;
    const filename = new URL(url).pathname.split('/').pop()!;

    const fetchRes = await app.inject({ method: 'GET', url: `/api/v1/files/${filename}` });
    expect(fetchRes.statusCode).toBe(200);
    expect(fetchRes.headers['content-type']).toBe('application/pdf');
  });

  it('a filename stamped >24h ago is rejected as expired, even if the file exists', async () => {
    const oldFilename = stampedFilename(25);
    const res = await app.inject({ method: 'GET', url: `/api/v1/files/${oldFilename}` });
    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe('INVOICE_EXPIRED');
  });

  it('a filename stamped just under 24h ago is NOT rejected as expired (falls through to a normal not-found, since no file was actually uploaded for it)', async () => {
    const recentFilename = stampedFilename(23);
    const res = await app.inject({ method: 'GET', url: `/api/v1/files/${recentFilename}` });
    expect(res.statusCode).not.toBe(410);
    expect(res.statusCode).toBe(404);
  });
});
