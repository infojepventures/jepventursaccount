import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import { shareClaimFile } from '../files/shareFile';
import { api } from '../lib/apiInstance';
import { friendlyMessage } from '../lib/api';
import { colors, space } from '../ui/theme';

export default function ViewerScreen() {
  const { claimId, fileId, mimeType, name } = useLocalSearchParams<{ claimId: string; fileId: string; mimeType: string; name: string }>();
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const retried = useRef(false);

  const loadHeaders = useCallback(() => {
    api.authHeaders().then(setHeaders).catch(() => setError('Please sign in again.'));
  }, []);

  useEffect(() => {
    loadHeaders();
  }, [loadHeaders]);

  const uri = api.fileUrl(claimId, fileId);
  const tooLarge = 'Could not open this file. If it is very large, open it from the Google Drive folder instead.';

  const onLoadError = useCallback(() => {
    // The headers may just be stale (e.g. an expired ID token); retry once with fresh ones before giving up.
    if (!retried.current) {
      retried.current = true;
      loadHeaders();
      return;
    }
    setError(tooLarge);
  }, [loadHeaders, tooLarge]);

  const onShare = useCallback((target: 'whatsapp' | 'any') => {
    if (sharing) return;
    setSharing(true);
    shareClaimFile({ claimId, fileId, name, mimeType, target })
      .catch((e) => Alert.alert('Could not share', friendlyMessage(e)))
      .finally(() => setSharing(false));
  }, [claimId, fileId, mimeType, name, sharing]);

  const onSharePress = useCallback(() => {
    Alert.alert('Share', undefined, [
      { text: 'WhatsApp', onPress: () => onShare('whatsapp') },
      { text: 'Other apps…', onPress: () => onShare('any') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [onShare]);

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: name ?? 'Attachment',
          headerRight: () =>
            sharing ? (
              <ActivityIndicator color={colors.primary} style={styles.headerBtn} />
            ) : (
              <Pressable hitSlop={10} style={styles.headerBtn} onPress={onSharePress} accessibilityLabel="Share">
                <Ionicons name="share-outline" size={22} color={colors.text} />
              </Pressable>
            ),
        }}
      />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : !headers ? (
        <ActivityIndicator style={{ marginTop: space(10) }} color={colors.primary} />
      ) : mimeType === 'application/pdf' ? (
        <Pdf
          source={{ uri, headers, cache: false }}
          style={styles.fill}
          trustAllCerts={false}
          onError={onLoadError}
          renderActivityIndicator={() => <ActivityIndicator color={colors.primary} />}
        />
      ) : (
        <Image source={{ uri, headers }} style={styles.fill} contentFit="contain" onError={onLoadError} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, backgroundColor: '#000' },
  error: { color: '#fff', padding: space(6), textAlign: 'center' },
  headerBtn: { paddingHorizontal: space(3) },
});
