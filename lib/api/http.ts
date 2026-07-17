import { NextResponse } from 'next/server';
import { ZodSchema } from 'zod';

export function ok<T>(data: T) {
  return NextResponse.json(
    { ok: true, data },
    {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    }
  );
}

export function fail(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: message },
    {
      status,
      headers: {
        'Cache-Control': 'private, no-store'
      }
    }
  );
}

export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  const body = await request.json();
  return schema.parse(body);
}
