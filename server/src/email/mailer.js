import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

export function createMailService() {
  if (!config.smtp.host) {
    return {
      configured: false,
      async sendPasswordReset() {
        logger.error('Password-reset email was requested, but SMTP is not configured.');
        return false;
      }
    };
  }

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
    async verify() {
      return transport.verify();
    },
    async sendPasswordReset({ to, displayName, token }) {
      const resetUrl = new URL(config.auth.resetUrl);
      resetUrl.hash = `token=${encodeURIComponent(token)}`;
      const safeName = escapeHtml(displayName || 'customer');
      const safeUrl = escapeHtml(resetUrl.toString());
      await transport.sendMail({
        from: config.smtp.from,
        to,
        subject: 'Reset your AM MARKET password',
        text: `Hello ${displayName || 'customer'},\n\nOpen this secure link to reset your AM MARKET password. It expires soon and can be used once:\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
        html: `<p>Hello ${safeName},</p><p>Open this secure, one-time link to reset your AM MARKET password:</p><p><a href="${safeUrl}">Reset password</a></p><p>If you did not request this, ignore this email.</p>`
      });
      return true;
    }
  };
}
