/** Canonical error envelope (plan Section 4.1). Every service returns this shape. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    details: Record<string, unknown>;
  };
}

/** An error carrying an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details: Record<string, unknown>;

  constructor(code: string, message: string, status = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function errorEnvelope(
  code: string,
  message: string,
  requestId: string,
  details: Record<string, unknown> = {},
): ErrorEnvelope {
  return { error: { code, message, requestId, details } };
}
