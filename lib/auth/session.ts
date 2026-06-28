import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const DEMO_COOKIE = 'span_demo_user';
const FALLBACK_USER_ID = 'u-admin';
const demoAuthEnabled = process.env.NEXT_PUBLIC_ENABLE_DEMO_AUTH === 'true';

export function hasSupabaseAuthConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export async function resolveCurrentUserId(request?: NextRequest): Promise<string> {
  const headerUser = request?.headers.get('x-span-user-id');
  if (headerUser) return headerUser;

  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (userId) return userId;
  }

  if (demoAuthEnabled) {
    if (request) {
      const demoCookie = request.cookies.get(DEMO_COOKIE)?.value;
      if (demoCookie) return demoCookie;
    } else {
      const cookieStore = await cookies();
      const demoCookie = cookieStore.get(DEMO_COOKIE)?.value;
      if (demoCookie) return demoCookie;
    }
  }

  if (hasSupabaseAuthConfigured()) {
    throw new Error('Brak aktywnej sesji użytkownika.');
  }

  return FALLBACK_USER_ID;
}

export const authCookieName = DEMO_COOKIE;
