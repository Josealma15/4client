import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from './helpers.js';

// Only the GET verification handshake is covered here. The POST message-ingestion
// path requires real Meta HMAC signing and org WPP credentials, which is a heavier
// fixture — intentionally out of scope / lower priority per the audit roadmap.
describe('webhook verification handshake', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET verify handshake with correct hub.verify_token -> 200 returns the challenge string', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhook?hub.mode=subscribe&hub.verify_token=test_verify_token_123&hub.challenge=challenge-abc-123',
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe('challenge-abc-123');
  });

  it('GET verify handshake with wrong token -> 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-abc-123',
    });

    expect(res.statusCode).toBe(403);
  });
});
