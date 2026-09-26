jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

type TokenListener = (t: { data: unknown }) => void;

let mockTokenListeners: TokenListener[] = [];
let mockPermissionStatus = 'granted';
let mockDeviceToken = 'device-token-1';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: mockPermissionStatus })),
  requestPermissionsAsync: jest.fn(async () => ({ status: mockPermissionStatus })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: mockDeviceToken })),
  addPushTokenListener: jest.fn((cb: TokenListener) => {
    mockTokenListeners.push(cb);
    return {
      remove: jest.fn(() => {
        mockTokenListeners = mockTokenListeners.filter((l) => l !== cb);
      }),
    };
  }),
  useLastNotificationResponse: () => undefined,
  AndroidImportance: { MAX: 5 },
}));

import * as push from './push';

/** A registerPushToken mock whose promise stays pending until `resolve()` is
 * called, and whose `called` promise resolves as soon as it is invoked —
 * this lets tests synchronize on "registration reached the network call"
 * without depending on a fixed number of microtask ticks. */
function pendingRegisterPushToken() {
  let resolve!: () => void;
  let notifyCalled!: () => void;
  const called = new Promise<void>((res) => {
    notifyCalled = res;
  });
  const fn = jest.fn((..._args: unknown[]) => {
    notifyCalled();
    return new Promise<{ ok: true }>((res) => {
      resolve = () => res({ ok: true });
    });
  });
  return { fn, called, resolve: () => resolve() };
}

describe('push token registration', () => {
  beforeEach(async () => {
    mockTokenListeners = [];
    mockPermissionStatus = 'granted';
    mockDeviceToken = 'device-token-1';
    // Drain any state left by a previous test (cancels its generation and
    // clears the last known token).
    await push.tokenForUnregister(0);
  });

  it('records the token as soon as it is obtained, before the network call resolves', async () => {
    const { fn: registerPushToken, called, resolve } = pendingRegisterPushToken();

    const unsubPromise = push.registerForPush({ registerPushToken });
    await called;

    expect(registerPushToken).toHaveBeenCalledWith({ token: 'device-token-1', platform: 'ios' });
    expect(push.lastRegisteredToken()).toBe('device-token-1');

    // Clean up: let the pending network call resolve so registerForPush finishes.
    resolve();
    const unsub = await unsubPromise;
    unsub();
  });

  it('signOut during an in-flight registration still yields the token for unregister', async () => {
    const { fn: registerPushToken, called, resolve } = pendingRegisterPushToken();

    const unsubPromise = push.registerForPush({ registerPushToken });

    // Sign-out races the still-in-flight registration.
    const tokenForUnregisterPromise = push.tokenForUnregister(2000);

    await called;
    resolve();

    const token = await tokenForUnregisterPromise;
    expect(token).toBe('device-token-1');
    expect(push.lastRegisteredToken()).toBeNull();

    const unsub = await unsubPromise;
    unsub();
  });

  it('prevents a late token-refresh from re-registering after sign-out', async () => {
    const { fn: registerPushToken, called, resolve } = pendingRegisterPushToken();

    const unsubPromise = push.registerForPush({ registerPushToken });
    await called;
    resolve();
    const unsub = await unsubPromise;

    // Sign out: cancels the generation and consumes the token.
    await push.tokenForUnregister();
    expect(registerPushToken).toHaveBeenCalledTimes(1);

    // A token refresh arriving after sign-out must not trigger re-registration.
    mockTokenListeners.forEach((l) => l({ data: 'device-token-2' }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(registerPushToken).toHaveBeenCalledTimes(1);

    unsub();
  });

  it('registerForPush never rejects even if the underlying API call throws', async () => {
    const registerPushToken = jest.fn(async () => {
      throw new Error('network down');
    });

    await expect(push.registerForPush({ registerPushToken })).resolves.toEqual(expect.any(Function));
  });
});
