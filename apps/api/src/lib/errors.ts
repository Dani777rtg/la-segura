export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message)
export const unauthorized = (message = 'Debes iniciar sesión') => new AppError(401, 'unauthorized', message)
export const forbidden = (code: string, message: string) => new AppError(403, code, message)
export const conflict = (code: string, message: string) => new AppError(409, code, message)
export const tooMany = (message: string, retryAfterSec: number) =>
  new AppError(429, 'rate_limited', message, { retryAfterSec })
