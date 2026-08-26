import { ZodError } from 'zod';
import { ApiError } from './errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested endpoint was not found.' } });
}

export function errorHandler(error, req, res, _next) {
  if (res.headersSent) return;

  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'The request body must contain valid JSON.'
      }
    });
  }

  if (error?.type === 'entity.too.large') {
    return res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request body is too large.'
      }
    });
  }

  if (error instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Please correct the highlighted fields.',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      }
    });
  }

  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details })
      }
    });
  }

  req.log?.error({ err: error }, 'Unhandled request error');
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.'
    }
  });
}
