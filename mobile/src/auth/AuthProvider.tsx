import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithEmailAndPassword, signOut as fbSignOut,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isProfileComplete, type UserDoc } from '@jep/shared';
import { ApiClientError, friendlyMessage } from '../lib/api';
import { api } from '../lib/apiInstance';
import { auth, db } from '../lib/firebase';
import type { AuthStatus } from './routeFor';

export type AppUser = UserDoc & { uid: string };

/** These mean the account itself is not usable; anything else is treated as transient. */
const SESSION_FATAL_CODES = new Set(['NOT_INVITED', 'INACTIVE', 'UNAUTHENTICATED']);

interface AuthValue {
  status: AuthStatus;
  user: AppUser | null;
  error: string | null;
  isAdmin: boolean;
  profileComplete: boolean;
  signInWithGoogle(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  retrySession(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

async function signOutEverywhere() {
  await GoogleSignin.signOut().catch(() => undefined);
  await fbSignOut(auth);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AppUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);
  const unsubUserRef = useRef<(() => void) | undefined>(undefined);

  // Shared by the auth-state listener and retrySession, so a retry invalidates any in-flight run.
  const startSessionFlow = useCallback(async (fu: { uid: string }) => {
    unsubUserRef.current?.();
    unsubUserRef.current = undefined;
    const my = ++genRef.current;
    try {
      await api.session(); // creates the user from an invite on first Google sign-in
    } catch (e) {
      if (my !== genRef.current) return;
      setError(friendlyMessage(e));
      if (e instanceof ApiClientError && SESSION_FATAL_CODES.has(e.code)) {
        await signOutEverywhere();
      } else {
        // Transient failure (network, server error, …): keep the session and let the user retry.
        setStatus('error');
      }
      return;
    }
    if (my !== genRef.current) return;
    unsubUserRef.current = onSnapshot(
      doc(db, 'users', fu.uid),
      (snap) => {
        if (my !== genRef.current) return;
        if (!snap.exists()) return;
        const u = snap.data() as UserDoc;
        if (!u.active) {
          setError('This account has been deactivated. Please contact an admin.');
          void signOutEverywhere();
          return;
        }
        setError(null);
        setUser({ uid: fu.uid, ...u });
        setStatus('signedIn');
      },
      (err) => {
        if (my !== genRef.current) return;
        setError(err.message);
      },
    );
  }, []);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (fu) => {
      if (!fu) {
        unsubUserRef.current?.();
        unsubUserRef.current = undefined;
        genRef.current++;
        setUser(null);
        setStatus('signedOut');
        return;
      }
      void startSessionFlow(fu);
    });
    return () => {
      unsubAuth();
      unsubUserRef.current?.();
    };
  }, [startSessionFlow]);

  const retrySession = useCallback(async () => {
    const fu = auth.currentUser;
    if (!fu) return;
    setError(null);
    setStatus('loading');
    await startSessionFlow(fu);
  }, [startSessionFlow]);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) return; // user cancelled
    const idToken = res.data.idToken;
    if (!idToken) throw new Error('Google sign-in did not return an ID token. Check the Web client ID.');
    await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setError(null);
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      error,
      isAdmin: user?.role === 'admin',
      profileComplete: user ? isProfileComplete(user) : false,
      signInWithGoogle,
      signInWithEmail,
      signOut: signOutEverywhere,
      retrySession,
    }),
    [status, user, error, signInWithGoogle, signInWithEmail, retrySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
