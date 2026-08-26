export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const assertFound = <T>(value: T | null | undefined, message = 'Resource not found'): T => {
  if (value == null) throw new AppError(404, 'NOT_FOUND', message);
  return value;
};
