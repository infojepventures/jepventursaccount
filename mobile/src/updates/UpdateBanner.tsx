import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider';
import { db } from '../lib/firebase';
import { colors, radius, space } from '../ui/theme';
import { nativeUpdateNeeded, type NativeUpdate } from './nativeUpdate';

const FOREGROUND_CHECK_MS = 10 * 60 * 1000;

/**
 * Over-the-air updates (EAS Update) download in the background on launch and, at most every 10 minutes, when
 * the app returns to the foreground; once one is ready this offers a restart (it also applies on the next
 * launch). When a new APK is required instead (Firestore `appConfig/android`), it offers the download link.
 */
export function UpdateBanner() {
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { isUpdatePending } = Updates.useUpdates();
  const [nativeUpdate, setNativeUpdate] = useState<NativeUpdate | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const lastCheck = useRef(Date.now());

  useEffect(() => {
    if (!Updates.isEnabled) return; // development builds load JS from Metro instead
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || Date.now() - lastCheck.current < FOREGROUND_CHECK_MS) return;
      lastCheck.current = Date.now();
      Updates.checkForUpdateAsync()
        .then((r) => (r.isAvailable ? Updates.fetchUpdateAsync() : undefined))
        .catch(() => {}); // offline etc.: try again next time
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (auth.status !== 'signedIn' || Platform.OS !== 'android') return;
    getDoc(doc(db, 'appConfig', 'android'))
      .then((snap) => setNativeUpdate(nativeUpdateNeeded(Application.nativeBuildVersion, snap.data())))
      .catch(() => {});
  }, [auth.status]);

  if (dismissed) return null;

  if (nativeUpdate) {
    return (
      <View style={[styles.banner, { top: insets.top + space(2) }]} accessibilityRole="alert">
        <Ionicons name="download-outline" size={20} color={colors.primaryText} />
        <View style={styles.body}>
          <Text style={styles.title}>A new version of JEP Claims is available</Text>
          <Text style={styles.text}>{nativeUpdate.message ?? 'Download and install it to keep using the latest features.'}</Text>
        </View>
        <Pressable onPress={() => void Linking.openURL(nativeUpdate.apkUrl)} style={styles.action} accessibilityRole="button">
          <Text style={styles.actionText}>Download</Text>
        </Pressable>
        <Pressable onPress={() => setDismissed(true)} hitSlop={10} accessibilityLabel="Later">
          <Ionicons name="close" size={18} color={colors.primaryText} />
        </Pressable>
      </View>
    );
  }

  if (isUpdatePending) {
    return (
      <View style={[styles.banner, { top: insets.top + space(2) }]} accessibilityRole="alert">
        <Ionicons name="sparkles-outline" size={20} color={colors.primaryText} />
        <View style={styles.body}>
          <Text style={styles.title}>Update ready</Text>
          <Text style={styles.text}>Restart to use the latest version.</Text>
        </View>
        <Pressable onPress={() => void Updates.reloadAsync().catch(() => {})} style={styles.action} accessibilityRole="button">
          <Text style={styles.actionText}>Restart</Text>
        </Pressable>
        <Pressable onPress={() => setDismissed(true)} hitSlop={10} accessibilityLabel="Later">
          <Ionicons name="close" size={18} color={colors.primaryText} />
        </Pressable>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: space(3),
    right: space(3),
    zIndex: 100,
    elevation: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(3),
    borderRadius: radius,
    backgroundColor: colors.primary,
  },
  body: { flex: 1, gap: 2 },
  title: { color: colors.primaryText, fontWeight: '700', fontSize: 14 },
  text: { color: colors.primaryText, opacity: 0.8, fontSize: 12 },
  action: { backgroundColor: colors.card, borderRadius: radius, paddingHorizontal: space(3), paddingVertical: space(2) },
  actionText: { color: colors.text, fontWeight: '700', fontSize: 13 },
});
