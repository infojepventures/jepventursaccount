// EXPO_PUBLIC_* values are inlined at build time and are public by design.
const read = (v: string | undefined) => v ?? '';

export const config = {
  apiBaseUrl: read(process.env.EXPO_PUBLIC_API_BASE_URL).replace(/\/$/, ''),
  googleWebClientId: read(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
  firebase: {
    apiKey: read(process.env.EXPO_PUBLIC_FIREBASE_API_KEY),
    authDomain: read(process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: read(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID),
    appId: read(process.env.EXPO_PUBLIC_FIREBASE_APP_ID),
    messagingSenderId: read(process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
    storageBucket: read(process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET),
  },
};
