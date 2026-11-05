// Re-export useAuth from AuthProvider so consumers can import from either location.
export { useAuth } from '@/components/auth/AuthProvider';
export type { AuthState, AuthUser, AuthStatus } from '@/components/auth/AuthProvider';
