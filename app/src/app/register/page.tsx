'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';

/**
 * Register page — replaced with Privy's unified sign-up / sign-in flow.
 *
 * Privy's modal handles both new and returning users via email magic link,
 * Google OAuth, or an existing wallet. No separate register form is needed.
 */
export default function RegisterPage() {
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
      className="h-full flex items-center justify-center px-6 py-10 overflow-auto"
      style={{ background: 'var(--bf-tertiary)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-8"
        style={{ background: 'var(--bf-secondary)' }}
      >
        <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold text-[var(--foreground)]">Create account</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bf-gray)' }}>
            Join 0G Study and keep your streak going
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

        <p className="text-center text-xs mt-4" style={{ color: 'var(--bf-symbol)' }}>
          New users are automatically provisioned an account and embedded wallet.
        </p>

        <p className="text-center text-sm mt-6" style={{ color: 'var(--bf-gray)' }}>
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-[var(--foreground)] hover:underline">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
