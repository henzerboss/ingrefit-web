import { NextResponse } from 'next/server';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    const retryAfter = error.details.retryAfterSeconds;
    return NextResponse.json(
      { code: error.code, message: error.message, ...error.details },
      {
        status: error.status,
        headers: typeof retryAfter === 'number' ? { 'Retry-After': String(retryAfter) } : undefined,
      },
    );
  }

  console.error('[ingrefit] Unhandled API error', error);
  return NextResponse.json(
    { code: 'INTERNAL_ERROR', message: 'The product could not be analyzed.' },
    { status: 500 },
  );
}
