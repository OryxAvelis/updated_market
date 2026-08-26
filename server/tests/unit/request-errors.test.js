import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

describe('JSON request boundary', () => {
  it('returns a client-safe 400 response for malformed JSON', async () => {
    const response = await request(createApp({ database: {} }))
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'INVALID_JSON',
        message: 'The request body must contain valid JSON.'
      }
    });
  });

  it('returns 413 before processing JSON beyond the configured limit', async () => {
    const response = await request(createApp({ database: {} }))
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(33 * 1024) }));

    expect(response.status).toBe(413);
    expect(response.body.error).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'The request body is too large.'
    });
  });
});
