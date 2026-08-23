export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new ApiError(400, code, message, details);
export const unauthorized = (message = 'Authentication is required.') => new ApiError(401, 'AUTH_REQUIRED', message);
export const forbidden = (code = 'FORBIDDEN', message = 'This action is not allowed.') => new ApiError(403, code, message);
export const notFound = (code = 'NOT_FOUND', message = 'The requested resource was not found.') => new ApiError(404, code, message);
export const conflict = (code, message, details) => new ApiError(409, code, message, details);
export const unavailable = (code, message, details) => new ApiError(503, code, message, details);
