import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authCookieName } from '@/lib/auth/session';

const querySchema = z.object({
  userId: z.string().min(1)
});

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_ENABLE_DEMO_AUTH !== 'true') {
    return NextResponse.json({ ok: false, error: 'Tryb demo jest wyłączony.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = querySchema.parse(body);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(authCookieName, parsed.userId, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30
    });
    return response;
  } catch {
    return NextResponse.json({ ok: false, error: 'Nieprawidłowe dane.' }, { status: 400 });
  }
}
