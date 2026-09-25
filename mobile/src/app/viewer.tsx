import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import { api } from '../lib/apiInstance';
import { colors, space } from '../ui/theme';

export default function ViewerScreen() {
  const { claimId, fileId, mimeType, name } = useLocalSearchParams<{ claimId: string; fileId: string; mimeType: string; name: string }>();
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.authHeaders().then(setHeaders).catch(() => setError('Please sign in again.'));
  }, []);

  const uri = api.fileUrl(claimId, fileId);
  const tooLarge = 'Could not open this file. If it is very large, open it from the Google Drive folder instead.';

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: name ?? 'Attachment' }} />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : !headers ? (
        <ActivityIndicator style={{ marginTop: space(10) }} color={colors.primary} />
      ) : mimeType === 'application/pdf' ? (
        <Pdf
          source={{ uri, headers, cache: false }}
          style={styles.fill}
          trustAllCerts={false}
          onError={() => setError(tooLarge)}
          renderActivityIndicator={() => <ActivityIndicator color={colors.primary} />}
        />
      ) : (
        <Image source={{ uri, headers }} style={styles.fill} contentFit="contain" onError={() => setError(tooLarge)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, backgroundColor: '#000' },
  error: { color: '#fff', padding: space(6), textAlign: 'center' },
});
