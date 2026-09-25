export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export function routeFor(
  s: { status: AuthStatus; profileComplete: boolean },
  firstSegment: string | undefined,
): '/login' | '/profile-setup' | '/' | null {
  if (s.status === 'loading') return null;
  const inLogin = firstSegment === 'login';
  const inSetup = firstSegment === 'profile-setup';
  if (s.status === 'signedOut') return inLogin ? null : '/login';
  if (!s.profileComplete) return inSetup ? null : '/profile-setup';
  if (inLogin || inSetup) return '/';
  return null;
}
