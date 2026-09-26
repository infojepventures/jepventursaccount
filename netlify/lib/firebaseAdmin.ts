import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { env } from './env';

export function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID ?? 'demo-jep' });
  }
  return initializeApp({
    credential: cert({
      projectId: env('FIREBASE_PROJECT_ID'),
      clientEmail: env('GOOGLE_SA_EMAIL'),
      privateKey: env('GOOGLE_SA_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
  });
}
