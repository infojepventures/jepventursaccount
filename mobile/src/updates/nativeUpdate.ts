/**
 * Firestore `appConfig/android`, edited by an admin in the Firebase console when a new APK is needed
 * (native changes that an over-the-air update can't deliver):
 *   { latestVersionCode: number, apkUrl: "https://…apk", message?: string }
 */
export interface NativeUpdate {
  apkUrl: string;
  message: string | null;
}

/** Returns what to show when this build (Android versionCode) is older than the latest APK, else null. */
export function nativeUpdateNeeded(currentVersionCode: string | null, config: unknown): NativeUpdate | null {
  const current = Number(currentVersionCode);
  if (!currentVersionCode || !Number.isInteger(current)) return null;
  if (!config || typeof config !== 'object') return null;
  const { latestVersionCode, apkUrl, message } = config as Record<string, unknown>;
  if (typeof latestVersionCode !== 'number' || !Number.isInteger(latestVersionCode)) return null;
  if (typeof apkUrl !== 'string' || !/^https:\/\/\S+$/.test(apkUrl)) return null;
  if (current >= latestVersionCode) return null;
  return { apkUrl, message: typeof message === 'string' && message.trim() ? message.trim() : null };
}
