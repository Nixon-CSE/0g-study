'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';

/**
 * Login page — replaced with Privy's pre-built modal flow.
 *
 * Calling login() opens Privy's modal (email magic link + Google + wallet).
 * Once authenticated, the user is redirected to /workspace.
 */
export default function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  // Redirect already-authenticated users straight to the workspace.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/workspace');
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <div
      className="h-full flex items-center justify-center px-6"
      style={{ background: 'var(--bf-tertiary)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-8"
        style={{ background: 'var(--bf-secondary)' }}
      >
        <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold text-[var(--foreground)]">Welcome to 0G Study</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bf-gray)' }}>
            Sign in to study with your pod of agents
          </p>
        </div>

        <button
          onClick={login}
          disabled={isLoading}
          className="w-full rounded-lg py-2.5 font-semibold text-sm text-[var(--on-ink)] transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: 'var(--bf-fire)' }}
        >
          {isLoading ? 'Loading…' : 'Sign in with Privy'}
        </button>

        <p className="text-center text-xs mt-6" style={{ color: 'var(--bf-symbol)' }}>
          Supports email magic link, Google, and wallet sign-in.
        </p>
      </div>
    </div>
  );
}
