import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithEmailAndPassword, signOut as fbSignOut,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isProfileComplete, type UserDoc } from '@jep/shared';
import { friendlyMessage } from '../lib/api';
import { api } from '../lib/apiInstance';
import { auth, db } from '../lib/firebase';
import type { AuthStatus } from './routeFor';

export type AppUser = UserDoc & { uid: string };

interface AuthValue {
  status: AuthStatus;
  user: AppUser | null;
  error: string | null;
  isAdmin: boolean;
  profileComplete: boolean;
  signInWithGoogle(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
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

  useEffect(() => {
    let unsubUser: (() => void) | undefined;
    let gen = 0;
    const unsubAuth = onAuthStateChanged(auth, async (fu) => {
      unsubUser?.();
      unsubUser = undefined;
      const my = ++gen;
      let signingOut = false;
      if (!fu) {
        setUser(null);
        setStatus('signedOut');
        return;
      }
      try {
        await api.session(); // creates the user from an invite on first Google sign-in
      } catch (e) {
        if (my !== gen) return;
        setError(friendlyMessage(e));
        if (!signingOut) {
          signingOut = true;
          await signOutEverywhere();
        }
        return;
      }
      if (my !== gen) return;
      unsubUser = onSnapshot(
        doc(db, 'users', fu.uid),
        (snap) => {
          if (my !== gen) return;
          if (!snap.exists()) return;
          const u = snap.data() as UserDoc;
          if (!u.active) {
            setError('This account has been deactivated. Please contact an admin.');
            if (!signingOut) {
              signingOut = true;
              void signOutEverywhere();
            }
            return;
          }
          setError(null);
          setUser({ uid: fu.uid, ...u });
          setStatus('signedIn');
        },
        (err) => {
          if (my !== gen) return;
          setError(err.message);
        },
      );
    });
    return () => {
      unsubAuth();
      unsubUser?.();
    };
  }, []);

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
    }),
    [status, user, error, signInWithGoogle, signInWithEmail],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
