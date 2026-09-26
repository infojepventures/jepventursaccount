import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { Api } from '../lib/api';

// Show notifications while the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('claims', {
    name: 'Claims',
    importance: Notifications.AndroidImportance.MAX,
  });
}

export async function getDevicePushToken(): Promise<string | null> {
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return null;
    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token.data === 'string' ? token.data : null;
  } catch (e) {
    console.error('[push] getDevicePushToken failed', e);
    return null;
  }
}

// The most recent token we know about, set as soon as it's obtained from the
// device (before the network register call resolves), so a sign-out that
// races an in-flight registration can still unregister it.
let lastToken: string | null = null;

// Tracks whatever registration work is currently in flight (device-token
// acquisition through the network `registerPushToken` call), so that a
// sign-out can wait for it to settle before deciding there is nothing to
// unregister. Set synchronously (no `await` in between) whenever new
// registration work starts, so there is no window where work is running but
// untracked.
let inFlight: Promise<void> | null = null;

// Bumped whenever in-flight/future registration work should become a no-op
// (e.g. on sign-out). Each registration attempt captures the generation it
// started with and checks it before calling the API.
let generation = 0;

function trackInFlight(work: Promise<void>): void {
  inFlight = work;
  void work.finally(() => {
    if (inFlight === work) inFlight = null;
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function lastRegisteredToken(): string | null {
  return lastToken;
}

/**
 * Returns the token that should be unregistered on sign-out, waiting for any
 * in-flight registration (bounded by `timeoutMs`) so a registration that is
 * still in progress doesn't slip past sign-out unregistered. Also cancels
 * the current generation so registration work that completes after this
 * call does not re-register the token for the (now signed-out) user.
 */
export async function tokenForUnregister(timeoutMs = 3000): Promise<string | null> {
  generation++;
  if (inFlight) {
    await Promise.race([inFlight, delay(timeoutMs)]).catch(() => undefined);
  }
  const token = lastToken;
  lastToken = null;
  return token;
}

export function registerForPush(api: Pick<Api, 'registerPushToken'>): Promise<() => void> {
  const platform: 'android' | 'ios' = Platform.OS === 'ios' ? 'ios' : 'android';
  const myGeneration = generation;

  const registerToken = async (token: string | null): Promise<void> => {
    if (!token) return;
    lastToken = token;
    // Once a registration attempt has actually started (this call), let it run to
    // completion even if sign-out happens mid-flight — `tokenForUnregister` awaits
    // this work and unregisters the token afterward. The generation check instead
    // guards *starting new* attempts (see the token-refresh listener below), so a
    // refresh that arrives after sign-out never calls the API at all.
    try {
      await api.registerPushToken({ token, platform });
    } catch (e) {
      console.error('[push] registerPushToken failed', e);
    }
  };

  const initial = (async () => {
    await ensureAndroidChannel();
    const token = await getDevicePushToken();
    await registerToken(token);
  })();
  trackInFlight(initial.catch((e) => console.error('[push] registerForPush failed', e)));

  return initial
    .catch((e) => console.error('[push] registerForPush failed', e))
    .then(() => {
      let sub: { remove(): void } | undefined;
      try {
        sub = Notifications.addPushTokenListener((t) => {
          if (myGeneration !== generation) return;
          const token = typeof t.data === 'string' ? t.data : null;
          if (!token) return;
          trackInFlight(
            registerToken(token).catch((e) => console.error('[push] token refresh registration failed', e)),
          );
        });
      } catch (e) {
        console.error('[push] addPushTokenListener failed', e);
      }
      return () => sub?.remove();
    })
    .catch((e) => {
      console.error('[push] registerForPush failed', e);
      return () => undefined;
    });
}

export function useNotificationTapNavigation(): void {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (!response) return;
    const claimId = response.notification.request.content.data?.claimId;
    if (typeof claimId === 'string') {
      router.push({ pathname: '/claim/[id]', params: { id: claimId } });
    }
  }, [response, router]);
}
