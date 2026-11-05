'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { setAccessTokenProvider, api } from '@/lib/api';
import { clearStudyToken } from '@/lib/agent-study';

/** Shape of a resolved BonFire user. */
export interface AuthUser {
  /**
   * BonFire user `_id` (Mongo hex). Lined up with `server.ownerId`,
   * `serverMember.principalId`, and message authorId everywhere on the backend.
   *
   * On first login this falls back to the Privy DID until the backend
   * /v1/auth/privy/verify call resolves and supplies the Mongo id.
   */
  id: string;
  /** Privy decentralised identifier (always present). */
  privyDid: string;
  username: string;
  email: string;
  /** Privy embedded-wallet address, if one has been created for this user. */
  walletAddress: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export type AuthStatus = 'unknown' | 'authenticated' | 'guest';

export interface AuthState {
  user: AuthUser | null;
  /** @deprecated Use isAuthenticated. Kept for backward compatibility. */
  token: string | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => Promise<void>;
  /** Returns the current Privy access token or null if unauthenticated. */
  getAccessToken: () => Promise<string | null>;
  /** @deprecated No-op — email/password register is replaced by Privy. Kept so legacy callers compile. */
  register: (input: {
    email: string;
    username: string;
    password: string;
    displayName: string;
  }) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Builds an AuthUser from Privy user claims. */
function buildUser(privyUser: NonNullable<ReturnType<typeof usePrivy>['user']>): AuthUser {
  const emailAddress = privyUser.email?.address ?? '';

  const username = emailAddress ? emailAddress.split('@')[0] : privyUser.id;
  const displayName = username;

  const wallet = privyUser.wallet?.address ?? null;

  return {
    // Default to the Privy DID until the backend's /privy/verify returns the
    // Mongo _id. ServerSidebar etc. compare against this — once swapped to
    // the Mongo id, owner checks against `server.ownerId` start passing.
    id: privyUser.id,
    privyDid: privyUser.id,
    email: emailAddress,
    username,
    displayName,
    walletAddress: wallet,
    avatarUrl: null,
  };
}

/** Backend privy verify response — augments the Privy claims with our Mongo id. */
interface BackendVerifyResponse {
  user: {
    id: string;
    privyDid: string;
    username: string;
    displayName: string;
    walletAddress: string | null;
    avatarUrl?: string | null;
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();

  // Wire the Privy token provider into the api module so every api() call
  // automatically attaches the correct Authorization header without needing
  // to read localStorage.
  useEffect(() => {
    setAccessTokenProvider(async () => {
      if (!authenticated) return null;
      try {
        return await getAccessToken();
      } catch {
        return null;
      }
    });
  }, [authenticated, getAccessToken]);

  const baseUser = authenticated && user ? buildUser(user) : null;

  const isLoading = !ready;
  const isAuthenticated = ready && authenticated;
  const status: AuthStatus = !ready ? 'unknown' : authenticated ? 'authenticated' : 'guest';

  // ── Backend identity sync ────────────────────────────────────────────────
  // POST /v1/auth/privy/verify exchanges the Privy access token for our
  // canonical Mongo user record. We swap `id` (Privy DID → Mongo hex) so
  // owner / membership / audit-log checks line up with backend ObjectIds,
  // and we adopt the backend's username/displayName so the UI shows a
  // humane name instead of "didprivy…" when Privy has no email claim.
  const [backendProfile, setBackendProfile] = useState<{
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !baseUser) {
      setBackendProfile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const resp = await api<BackendVerifyResponse>('POST', '/v1/auth/privy/verify', { token });
        if (!cancelled && resp?.user?.id) {
          setBackendProfile({
            id: resp.user.id,
            username: resp.user.username,
            displayName: resp.user.displayName,
            avatarUrl: resp.user.avatarUrl ?? null,
          });
        }
      } catch {
        // Soft-fail — the audit channel will stay hidden until next attempt.
      }
    })();
    return () => { cancelled = true; };
    // Re-run when the Privy session gains an email so /privy/verify can $set it in Mongo.
  }, [isAuthenticated, baseUser?.privyDid, baseUser?.email]);

  const resolvedUser: AuthUser | null = baseUser
    ? {
        ...baseUser,
        id: backendProfile?.id ?? baseUser.id,
        username: backendProfile?.username ?? baseUser.username,
        displayName: backendProfile?.displayName ?? baseUser.displayName,
        avatarUrl: backendProfile?.avatarUrl ?? baseUser.avatarUrl,
      }
    : null;

  const value: AuthState = {
    user: resolvedUser,
    // token kept for any legacy read but always null — consumers should call getAccessToken()
    token: null,
    status,
    isAuthenticated,
    isLoading,
    login,
    logout: async () => { clearStudyToken(); await logout(); },
    getAccessToken: async () => {
      if (!authenticated) return null;
      try {
        return await getAccessToken();
      } catch {
        return null;
      }
    },
    register: async () => {
      // No-op: email/password registration is replaced by Privy.
      // Calling login() opens the Privy modal which handles sign-up too.
      login();
    },
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
