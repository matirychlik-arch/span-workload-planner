import { NextResponse } from 'next/server';
import { authCookieName } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    await supabase.auth.signOut();
  }

  const response = NextResponse.json({ ok: true, data: null });
  response.cookies.set(authCookieName, '', {
    path: '/',
    maxAge: 0
  });
  return response;
}
