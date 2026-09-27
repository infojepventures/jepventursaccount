/**
 * Over-the-air updates only reach builds with the same runtime version, which is the app `version` in
 * app.json (runtimeVersion policy "appVersion"). A native change (new native module, permission, SDK upgrade)
 * must bump that version and ship a new APK; then an admin updates Firestore `appConfig/android` so older
 * builds are told to download it:
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
