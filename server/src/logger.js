import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'am-market-api', environment: config.env },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers.x-csrf-token',
      'req.headers.idempotency-key',
      'req.headers.x-am-fulfillment-signature',
      'res.headers["set-cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.token',
      '*.csrfToken',
      '*.apiKey',
      '*.resend.apiKey',
      'config.db.password',
      'config.smtp.password',
      'config.email.resend.apiKey',
      'config.fulfillment.secret'
    ],
    censor: '[REDACTED]'
  }
});
