import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AnyAttachment } from '../claims/types';
import { api } from '../lib/apiInstance';
import { colors, radius, space } from '../ui/theme';

function useAuthHeaders() {
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    api.authHeaders().then(setHeaders).catch(() => setHeaders(null));
  }, []);
  return headers;
}

export function AttachmentList({
  claimId,
  items,
  onRemove,
}: {
  claimId?: string;
  items: AnyAttachment[];
  onRemove?: (key: string) => void;
}) {
  const router = useRouter();
  const headers = useAuthHeaders();

  return (
    <View style={styles.grid}>
      {items.map((a) => {
        const isImage = a.mimeType !== 'application/pdf';
        const remoteUri = a.kind === 'remote' && claimId ? api.fileUrl(claimId, a.driveFileId) : null;
        const open = () => {
          if (a.kind === 'remote' && claimId) {
            // /viewer route is added in a later task; cast until it exists.
            router.push({
              pathname: '/viewer',
              params: { claimId, fileId: a.driveFileId, mimeType: a.mimeType, name: a.name },
            } as never);
          }
        };
        return (
          <Pressable key={a.key} style={styles.tile} onPress={open}>
            {isImage && a.kind === 'local' ? (
              <Image source={{ uri: a.uri }} style={styles.thumb} contentFit="cover" />
            ) : isImage && remoteUri && headers ? (
              <Image source={{ uri: remoteUri, headers }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, styles.pdf]}>
                <Ionicons name="document-text-outline" size={28} color={colors.muted} />
              </View>
            )}
            <Text numberOfLines={1} style={styles.name}>{a.name}</Text>
            {a.kind === 'local' && a.progress !== undefined && a.progress < 1 ? (
              <View style={styles.bar}><View style={[styles.fill, { width: `${Math.round(a.progress * 100)}%` }]} /></View>
            ) : null}
            {a.kind === 'local' && a.error ? <Text style={styles.error}>Upload failed</Text> : null}
            {a.kind === 'local' && a.uploadedId ? <Ionicons name="checkmark-circle" size={16} color={colors.success} style={styles.ok} /> : null}
            {onRemove ? (
              <Pressable hitSlop={10} style={styles.remove} onPress={() => onRemove(a.key)} accessibilityLabel={`Remove ${a.name}`}>
                <Ionicons name="close-circle" size={22} color={colors.text} />
              </Pressable>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3) },
  tile: { width: 96, gap: space(1) },
  thumb: { width: 96, height: 96, borderRadius: radius, backgroundColor: colors.border },
  pdf: { alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 11, color: colors.muted },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.primary },
  error: { fontSize: 11, color: colors.danger },
  ok: { position: 'absolute', left: 4, top: 4 },
  remove: { position: 'absolute', right: -6, top: -6, backgroundColor: colors.card, borderRadius: 11 },
});
