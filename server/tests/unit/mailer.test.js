import { describe, expect, it, vi } from 'vitest';
import { createResendMailService } from '../../src/email/mailer.js';

const apiKey = 're_unit_test_key_1234567890';
const from = 'AM MARKET <reset@market.example>';
const resetUrl = 'https://market.example/reset-password.html';

function service(fetchImpl, timeoutMs = 1000) {
  return createResendMailService({ apiKey, from, resetUrl, timeoutMs, fetchImpl });
}

describe('Resend HTTPS password-reset delivery', () => {
  it('sends the one-time link through the pinned HTTPS endpoint without exposing HTML input', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'email-delivery-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    await expect(service(fetchImpl).sendPasswordReset({
      to: 'customer@example.com',
      displayName: '<Customer & Friend>',
      token: 'secret reset token'
    })).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'am-market-api/1.0'
      }
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      from,
      to: ['customer@example.com'],
      subject: 'Reset your AM MARKET password'
    });
    expect(body.text).toContain('https://market.example/reset-password.html#token=secret%20reset%20token');
    expect(body.html).toContain('&lt;Customer &amp; Friend&gt;');
    expect(body.html).not.toContain('<Customer & Friend>');
  });

  it('removes control characters from the customer salutation', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'email-delivery-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    await service(fetchImpl).sendPasswordReset({
      to: 'customer@example.com',
      displayName: 'Customer\r\nInjected line',
      token: 'secret-token'
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.text).toContain('Hello Customer Injected line,');
    expect(body.text).not.toContain('Customer\r\nInjected line');
    expect(body.html).not.toContain('Customer\r\nInjected line');
  });

  it.each([
    ['a rejected request', async () => new Response('{}', { status: 429 }), 'EMAIL_PROVIDER_REJECTED'],
    ['an invalid success body', async () => new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }), 'EMAIL_PROVIDER_INVALID_RESPONSE'],
    ['a network failure', async () => { throw new Error('network details'); }, 'EMAIL_PROVIDER_UNAVAILABLE']
  ])('fails closed on %s', async (_label, fetchImpl, code) => {
    let failure;
    try {
      await service(fetchImpl).sendPasswordReset({
        to: 'customer@example.com',
        displayName: 'Customer',
        token: 'secret-token'
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code });
    expect(`${failure?.message}\n${failure?.stack}`).not.toContain(apiKey);
  });

  it('aborts a stalled provider request at the configured timeout', async () => {
    const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });

    await expect(service(fetchImpl, 10).sendPasswordReset({
      to: 'customer@example.com',
      displayName: 'Customer',
      token: 'secret-token'
    })).rejects.toMatchObject({ code: 'EMAIL_PROVIDER_TIMEOUT' });
  });
});
