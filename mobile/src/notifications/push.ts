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

let lastToken: string | null = null;

export function lastRegisteredToken(): string | null {
  return lastToken;
}

export function registerForPush(api: Pick<Api, 'registerPushToken'>): Promise<() => void> {
  const platform: 'android' | 'ios' = Platform.OS === 'ios' ? 'ios' : 'android';

  const register = async (token: string | null) => {
    if (!token) return;
    try {
      await api.registerPushToken({ token, platform });
      lastToken = token;
    } catch (e) {
      console.error('[push] registerPushToken failed', e);
    }
  };

  return (async () => {
    try {
      await ensureAndroidChannel();
      const token = await getDevicePushToken();
      await register(token);
    } catch (e) {
      console.error('[push] registerForPush failed', e);
    }
    const sub = Notifications.addPushTokenListener((t) => {
      void register(typeof t.data === 'string' ? t.data : null);
    });
    return () => sub.remove();
  })();
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
