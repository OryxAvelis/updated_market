import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function resetMessage({ displayName, token, resetUrl = config.auth.resetUrl }) {
  const url = new URL(resetUrl);
  url.hash = `token=${encodeURIComponent(token)}`;
  const name = String(displayName || 'customer')
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ')
    .trim() || 'customer';
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(url.toString());
  return {
    subject: 'Reset your AM MARKET password',
    text: `Hello ${name},\n\nOpen this secure link to reset your AM MARKET password. It expires soon and can be used once:\n${url}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Hello ${safeName},</p><p>Open this secure, one-time link to reset your AM MARKET password:</p><p><a href="${safeUrl}">Reset password</a></p><p>If you did not request this, ignore this email.</p>`
  };
}

function deliveryError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function createResendMailService({
  apiKey,
  from,
  timeoutMs = 8000,
  resetUrl = config.auth.resetUrl,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!apiKey || !from) throw new TypeError('Resend API credentials and sender are required.');

  return {
    configured: true,
    provider: 'resend',
    async verify() {
      return true;
    },
    async sendPasswordReset({ to, displayName, token }) {
      const message = resetMessage({ displayName, token, resetUrl });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response;
        try {
          response = await fetchImpl(RESEND_EMAILS_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'User-Agent': 'am-market-api/1.0'
            },
            body: JSON.stringify({ from, to: [to], ...message }),
            signal: controller.signal
          });
        } catch {
          if (controller.signal.aborted) {
            throw deliveryError('EMAIL_PROVIDER_TIMEOUT', 'Password-reset email delivery timed out.');
          }
          throw deliveryError('EMAIL_PROVIDER_UNAVAILABLE', 'Password-reset email provider is unavailable.');
        }

        if (!response?.ok) {
          throw deliveryError(
            'EMAIL_PROVIDER_REJECTED',
            `Password-reset email provider rejected the request with status ${Number(response?.status) || 0}.`
          );
        }

        let result;
        try {
          result = await response.json();
        } catch {
          if (controller.signal.aborted) {
            throw deliveryError('EMAIL_PROVIDER_TIMEOUT', 'Password-reset email delivery timed out.');
          }
          throw deliveryError('EMAIL_PROVIDER_INVALID_RESPONSE', 'Password-reset email provider returned an invalid response.');
        }
        if (typeof result?.id !== 'string' || !result.id.trim()) {
          throw deliveryError('EMAIL_PROVIDER_INVALID_RESPONSE', 'Password-reset email provider did not confirm delivery.');
        }
        return true;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function createSmtpMailService() {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    ...(config.smtp.user ? {
      auth: { user: config.smtp.user, pass: config.smtp.password }
    } : {})
  });

  return {
    configured: true,
    provider: 'smtp',
    async verify() {
      return transport.verify();
    },
    async sendPasswordReset({ to, displayName, token }) {
      const message = resetMessage({ displayName, token });
      await transport.sendMail({ from: config.smtp.from, to, ...message });
      return true;
    }
  };
}

export function createMailService({ fetchImpl = globalThis.fetch } = {}) {
  if (config.email.provider === 'resend') {
    return createResendMailService({
      apiKey: config.email.resend.apiKey,
      from: config.email.resend.from,
      timeoutMs: config.email.httpTimeoutMs,
      fetchImpl
    });
  }
  if (config.email.provider === 'smtp') return createSmtpMailService();

  return {
    configured: false,
    provider: 'none',
    async sendPasswordReset() {
      logger.error('Password-reset email was requested, but no email provider is configured.');
      return false;
    }
  };
}
