import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { doc, getDoc } from 'firebase/firestore';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, Text } from 'react-native';
import { db } from '../lib/firebase';
import { Button } from '../ui/Button';
import { Section } from '../ui/Section';
import { colors } from '../ui/theme';
import { checkForUpdates } from './checkForUpdates';

function versionLabel(): string {
  const base = `Version ${Application.nativeApplicationVersion ?? '?'} (build ${Application.nativeBuildVersion ?? '?'})`;
  if (!Updates.isEnabled) return `${base} · development`;
  if (Updates.isEmbeddedLaunch || !Updates.createdAt) return `${base} · as installed`;
  const at = Updates.createdAt;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${base} · updated ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** Profile → App: shows the running version and checks for an over-the-air update or a required new APK. */
export function AppVersionSection() {
  const [checking, setChecking] = useState(false);

  const onCheck = async () => {
    setChecking(true);
    try {
      const result = await checkForUpdates({
        otaEnabled: Updates.isEnabled,
        checkOta: () => Updates.checkForUpdateAsync(),
        fetchOta: () => Updates.fetchUpdateAsync(),
        currentVersionCode: Application.nativeBuildVersion,
        loadNativeConfig: async () => (await getDoc(doc(db, 'appConfig', 'android'))).data(),
      });
      if (result.kind === 'native') {
        Alert.alert('New version available', result.update.message ?? 'Download and install the new version of JEP Claims.', [
          { text: 'Later', style: 'cancel' },
          { text: 'Download', onPress: () => void Linking.openURL(result.update.apkUrl) },
        ]);
      } else if (result.kind === 'otaReady') {
        Alert.alert('Update downloaded', 'Restart now to use the latest version?', [
          { text: 'Later', style: 'cancel' },
          { text: 'Restart', onPress: () => void Updates.reloadAsync().catch(() => {}) },
        ]);
      } else if (result.kind === 'latest') {
        Alert.alert('Up to date', 'You are using the latest version of JEP Claims.');
      } else {
        Alert.alert('Could not check for updates', 'Check your internet connection and try again.');
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <Section title="App">
      <Text style={styles.version}>{versionLabel()}</Text>
      <Button title="Check for updates" variant="secondary" icon="refresh-outline" loading={checking} onPress={() => void onCheck()} />
    </Section>
  );
}

const styles = StyleSheet.create({
  version: { color: colors.muted, fontSize: 13 },
});
