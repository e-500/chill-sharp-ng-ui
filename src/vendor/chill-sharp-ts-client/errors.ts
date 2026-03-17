export class ChillSharpClientError extends Error {
  readonly statusCode?: number;
  readonly responseText?: string;

  constructor(message: string, statusCode?: number, responseText?: string, cause?: unknown) {
    super(message);
    this.name = 'ChillSharpClientError';
    this.statusCode = statusCode;
    this.responseText = responseText;

    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}
