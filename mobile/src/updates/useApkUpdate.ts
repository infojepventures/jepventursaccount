import { useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { ApkInstallError, downloadAndInstallApk } from './installApk';

/** In-app APK update with download progress (null when idle); falls back to the browser on failure. */
export function useApkUpdate() {
  const [progress, setProgress] = useState<number | null>(null);
  const busy = useRef(false);

  const install = async (apkUrl: string) => {
    if (busy.current) return;
    busy.current = true;
    setProgress(0);
    try {
      await downloadAndInstallApk(apkUrl, setProgress);
    } catch (e) {
      const message = e instanceof ApkInstallError ? e.message : 'Could not install the update.';
      Alert.alert('Update not installed', message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open in browser', onPress: () => void Linking.openURL(apkUrl) },
      ]);
    } finally {
      busy.current = false;
      setProgress(null);
    }
  };

  return { install, progress };
}

export const progressLabel = (p: number) => `Downloading ${Math.round(p * 100)}%`;
