'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const demoUsers = [
  { id: 'u-admin', label: 'Admin SPAN' },
  { id: 'u-marcin', label: 'Marcin (employee)' },
  { id: 'u-mateusz', label: 'Mateusz (employee)' }
];
const enableDemoAuth = process.env.NEXT_PUBLIC_ENABLE_DEMO_AUTH === 'true';

export function LoginClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const supabase = createSupabaseBrowserClient();

  async function loginGoogle() {
    if (!supabase) {
      setError('Brak konfiguracji Supabase. Skorzystaj z trybu demo.');
      return;
    }
    setLoading(true);
    setError('');
    const redirectTo = `${window.location.origin}/auth/callback?next=/planner`;
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo
      }
    });
    if (authError) {
      setError(authError.message);
      setLoading(false);
    }
  }

  async function useDemo(userId: string) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (!response.ok) throw new Error('Nie udało się ustawić sesji demo.');
      router.push('/planner');
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Błąd logowania demo.';
      setError(message);
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <img className="login-logo" src="/assets/span-logo.svg" alt="SPAN" />
        <h1>Logowanie do SPAN</h1>
        <p>Google login + tryb demo do szybkiego startu wdrożenia.</p>

        <button onClick={loginGoogle} disabled={loading} className="login-btn">
          {loading ? 'Ładowanie…' : 'Zaloguj Google'}
        </button>

        {enableDemoAuth && (
          <>
            <div className="login-divider">lub demo</div>
            <div className="demo-list">
              {demoUsers.map((user) => (
                <button key={user.id} className="demo-btn" disabled={loading} onClick={() => void useDemo(user.id)}>
                  {user.label}
                </button>
              ))}
            </div>
          </>
        )}

        {!!error && <div className="error-strip">{error}</div>}
      </div>
    </div>
  );
}
