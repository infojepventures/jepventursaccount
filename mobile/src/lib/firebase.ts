import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import { collection, doc, initializeFirestore } from 'firebase/firestore';
import { config } from '../config';

export const firebaseApp = getApps().length ? getApp() : initializeApp(config.firebase);

// getReactNativePersistence exists in firebase/auth's React Native build but is missing from its TS types.
const { getReactNativePersistence } = FirebaseAuth as unknown as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => FirebaseAuth.Persistence;
};
export const auth = FirebaseAuth.initializeAuth(firebaseApp, { persistence: getReactNativePersistence(AsyncStorage) });
export const db = initializeFirestore(firebaseApp, { experimentalAutoDetectLongPolling: true });

GoogleSignin.configure({ webClientId: config.googleWebClientId });

/** A Firestore auto-ID generated locally (no write), used as the claim id before submission. */
export function newClaimId(): string {
  return doc(collection(db, 'claims')).id;
}
