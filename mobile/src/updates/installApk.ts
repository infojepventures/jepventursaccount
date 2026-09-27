import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

const APK_MIME = 'application/vnd.android.package-archive';
/** Intent.FLAG_GRANT_READ_URI_PERMISSION */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** Thrown for any failure; `message` is user-facing. */
export class ApkInstallError extends Error {}

/**
 * In-app update to a new APK: downloads it into the app's cache (reporting 0..1 progress) and hands it to
 * Android's package installer, which asks the user to confirm. The first time, Android also asks to allow
 * JEP Claims to install apps (REQUEST_INSTALL_PACKAGES). The app keeps its data and sign-in.
 */
export async function downloadAndInstallApk(url: string, onProgress: (fraction: number) => void): Promise<void> {
  const dir = `${FileSystem.cacheDirectory ?? ''}apk/`;
  await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => undefined);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const target = `${dir}jep-claims.apk`;

  const download = FileSystem.createDownloadResumable(url, target, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) onProgress(Math.min(1, p.totalBytesWritten / p.totalBytesExpectedToWrite));
  });
  let result: Awaited<ReturnType<typeof download.downloadAsync>>;
  try {
    result = await download.downloadAsync();
  } catch {
    throw new ApkInstallError('Could not download the update. Check your internet connection and try again.');
  }
  if (!result || result.status !== 200) {
    throw new ApkInstallError(`Could not download the update (${result?.status ?? 'no response'}). Please try again.`);
  }
  onProgress(1);

  try {
    const contentUri = await FileSystem.getContentUriAsync(result.uri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: APK_MIME,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  } catch {
    throw new ApkInstallError('Could not open the installer. You can download the update in your browser instead.');
  }
}
