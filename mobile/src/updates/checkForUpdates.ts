import { nativeUpdateNeeded, type NativeUpdate } from './nativeUpdate';

export type UpdateCheckResult =
  | { kind: 'native'; update: NativeUpdate }
  | { kind: 'otaReady' }
  | { kind: 'latest' }
  | { kind: 'error' };

export interface UpdateCheckDeps {
  /** False in development builds, which load JS from Metro. */
  otaEnabled: boolean;
  checkOta: () => Promise<{ isAvailable: boolean }>;
  fetchOta: () => Promise<unknown>;
  /** Android versionCode of this build. */
  currentVersionCode: string | null;
  /** Firestore `appConfig/android`. */
  loadNativeConfig: () => Promise<unknown>;
}

/**
 * "Check for updates": a required new APK wins (an over-the-air update can't reach an old native build);
 * otherwise download any over-the-air update so it is ready to apply.
 */
export async function checkForUpdates(d: UpdateCheckDeps): Promise<UpdateCheckResult> {
  const config = await d.loadNativeConfig().catch(() => undefined);
  const update = nativeUpdateNeeded(d.currentVersionCode, config);
  if (update) return { kind: 'native', update };

  if (!d.otaEnabled) return { kind: 'latest' };
  try {
    const { isAvailable } = await d.checkOta();
    if (!isAvailable) return { kind: 'latest' };
    await d.fetchOta();
    return { kind: 'otaReady' };
  } catch {
    return { kind: 'error' };
  }
}
