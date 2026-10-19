export class ReadError extends Error {
  constructor(code, message, { retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ReadError';
    this.code = code;
    this.retryable = retryable;
    this.exitCode = code === 'USAGE' ? 2 : 1;
  }
}

export function readError(error) {
  if (error instanceof ReadError) return error;
  if (error?.cause instanceof ReadError) return error.cause;
  return new ReadError('FETCH_FAILED', 'Page retrieval failed', { retryable: true, cause: error });
}
